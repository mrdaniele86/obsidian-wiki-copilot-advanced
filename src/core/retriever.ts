import { LinkGraph } from "./link-graph";
import type { RawSearchHit, WikiSearchIndex } from "./search-index";
import { tokenizeForSearch } from "./tokenizer";
import { SYNTHESIS_ROLES } from "./types";
import type {
  KnowledgeRole,
  RetrievalOptions,
  RetrievalRange,
  RetrievalResult,
  RetrievedChunk,
  SearchDocument
} from "./types";

const ROLE_MULTIPLIER: Readonly<Record<KnowledgeRole, number>> = {
  schema: 0,
  index: 1.08,
  topic: 1.38,
  concept: 1.3,
  summary: 1.2,
  wiki: 1.14,
  "stable-source": 1,
  "pending-source": 0.72,
  other: 0.82
};

export const DEFAULT_RETRIEVAL_RANGE: RetrievalRange = "medium";

const RETRIEVAL_OPTIONS_BY_RANGE: Readonly<Record<RetrievalRange, RetrievalOptions>> = {
  low: {
    includePending: false,
    includeOtherNotes: false,
    maxIndexResults: 1,
    maxTopicConceptResults: 2,
    maxSummaryResults: 4,
    maxWikiResults: 2,
    maxStableSourceResults: 3,
    maxPendingResults: 2,
    maxRetrievedPages: 12,
    maxEvidenceFiles: 4,
    maxContextCharacters: 18_000,
    graphExpansion: true
  },
  medium: {
    includePending: false,
    includeOtherNotes: false,
    maxIndexResults: 1,
    maxTopicConceptResults: 4,
    maxSummaryResults: 8,
    maxWikiResults: 4,
    maxStableSourceResults: 7,
    maxPendingResults: 3,
    maxRetrievedPages: 24,
    maxEvidenceFiles: 8,
    maxContextCharacters: 30_000,
    graphExpansion: true
  },
  high: {
    includePending: false,
    includeOtherNotes: false,
    maxIndexResults: 2,
    maxTopicConceptResults: 6,
    maxSummaryResults: 12,
    maxWikiResults: 6,
    maxStableSourceResults: 10,
    maxPendingResults: 4,
    maxRetrievedPages: 36,
    maxEvidenceFiles: 12,
    maxContextCharacters: 48_000,
    graphExpansion: true
  }
};

export function isRetrievalRange(value: unknown): value is RetrievalRange {
  return value === "low" || value === "medium" || value === "high";
}

export function retrievalOptionsForRange(range: RetrievalRange): RetrievalOptions {
  return { ...RETRIEVAL_OPTIONS_BY_RANGE[range] };
}

export const DEFAULT_RETRIEVAL_OPTIONS: RetrievalOptions = retrievalOptionsForRange(DEFAULT_RETRIEVAL_RANGE);

function roleAllowed(role: KnowledgeRole, options: RetrievalOptions): boolean {
  if (role === "schema") {
    return false;
  }
  if (role === "pending-source") {
    return options.includePending;
  }
  if (role === "other") {
    return options.includeOtherNotes;
  }
  return true;
}

function overlapScore(queryTokens: ReadonlySet<string>, document: SearchDocument): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const documentTokens = new Set(tokenizeForSearch(`${document.title} ${document.heading} ${document.text}`));
  let overlap = 0;
  for (const token of queryTokens) {
    if (documentTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.sqrt(queryTokens.size * Math.max(1, documentTokens.size));
}

function chooseGraphChunk(
  chunks: SearchDocument[],
  queryTokens: ReadonlySet<string>,
  lexicalById: ReadonlyMap<string, RetrievedChunk>
): SearchDocument | undefined {
  return [...chunks].sort((left, right) => {
    const lexicalDifference = (lexicalById.get(right.id)?.score ?? 0) - (lexicalById.get(left.id)?.score ?? 0);
    if (lexicalDifference !== 0) {
      return lexicalDifference;
    }
    const overlapDifference = overlapScore(queryTokens, right) - overlapScore(queryTokens, left);
    return overlapDifference || left.chunkIndex - right.chunkIndex;
  })[0];
}

function diversify(candidates: RetrievedChunk[], limit: number, perFile = 2): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  const pathCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const pathCount = pathCounts.get(candidate.path) ?? 0;
    if (pathCount >= perFile) {
      continue;
    }
    selected.push(candidate);
    pathCounts.set(candidate.path, pathCount + 1);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

function takeCategory(
  all: RetrievedChunk[],
  roles: ReadonlySet<KnowledgeRole>,
  limit: number,
  selectedIds: Set<string>,
  selectedPaths: Set<string>
): RetrievedChunk[] {
  const chosen = diversify(
    all.filter((candidate) =>
      roles.has(candidate.role) &&
      !selectedIds.has(candidate.id) &&
      !selectedPaths.has(candidate.path)),
    limit,
    1
  );
  for (const candidate of chosen) {
    selectedIds.add(candidate.id);
    selectedPaths.add(candidate.path);
  }
  return chosen;
}

export class WikiRetriever {
  constructor(
    private readonly searchIndex: WikiSearchIndex,
    private readonly linkGraph: LinkGraph
  ) {}

  retrieve(query: string, overrides: Partial<RetrievalOptions> = {}): RetrievalResult {
    const options: RetrievalOptions = { ...DEFAULT_RETRIEVAL_OPTIONS, ...overrides };
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { query: trimmedQuery, chunks: [], totalCandidates: 0, truncated: false };
    }

    const rawHits = this.searchIndex.search(trimmedQuery);
    const candidates = this.scoreLexicalHits(rawHits, options);
    if (options.graphExpansion) {
      this.addGraphCandidates(trimmedQuery, candidates, options);
    }
    candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

    const selectedIds = new Set<string>();
    const selectedPaths = new Set<string>();
    const selected: RetrievedChunk[] = [
      ...takeCategory(candidates, new Set(["index"]), options.maxIndexResults, selectedIds, selectedPaths),
      ...takeCategory(candidates, new Set(["topic", "concept"]), options.maxTopicConceptResults, selectedIds, selectedPaths),
      ...takeCategory(candidates, new Set(["summary"]), options.maxSummaryResults, selectedIds, selectedPaths),
      ...takeCategory(candidates, new Set(["wiki"]), options.maxWikiResults, selectedIds, selectedPaths),
      ...takeCategory(candidates, new Set(["stable-source"]), options.maxStableSourceResults, selectedIds, selectedPaths),
      ...takeCategory(candidates, new Set(["pending-source"]), options.maxPendingResults, selectedIds, selectedPaths)
    ];

    if (options.includeOtherNotes) {
      selected.push(...takeCategory(candidates, new Set(["other"]), 3, selectedIds, selectedPaths));
    }

    // Fill sparse profiles from any remaining allowed role without defeating the
    // per-role quotas in a fully structured LLM Wiki.
    const targetCount = Math.min(
      options.maxRetrievedPages,
      options.maxIndexResults +
        options.maxTopicConceptResults +
        options.maxSummaryResults +
        options.maxWikiResults +
        options.maxStableSourceResults +
        (options.includePending ? options.maxPendingResults : 0) +
        (options.includeOtherNotes ? 3 : 0)
    );
    if (selected.length < targetCount) {
      const remaining = diversify(
        candidates.filter((candidate) =>
          !selectedIds.has(candidate.id) &&
          !selectedPaths.has(candidate.path)),
        targetCount - selected.length,
        1
      );
      for (const candidate of remaining) {
        selectedIds.add(candidate.id);
        selectedPaths.add(candidate.path);
      }
      selected.push(...remaining);
    }

    const withinBudget: RetrievedChunk[] = [];
    let characters = 0;
    for (const candidate of selected) {
      if (withinBudget.length > 0 && characters + candidate.text.length > options.maxContextCharacters) {
        continue;
      }
      withinBudget.push(candidate);
      characters += candidate.text.length;
    }

    return {
      query: trimmedQuery,
      chunks: withinBudget,
      totalCandidates: candidates.length,
      truncated: withinBudget.length < selected.length
    };
  }

  private scoreLexicalHits(rawHits: RawSearchHit[], options: RetrievalOptions): RetrievedChunk[] {
    const maximum = rawHits[0]?.score ?? 1;
    return rawHits
      .filter(({ document }) => roleAllowed(document.role, options))
      .map(({ document, score }): RetrievedChunk => {
        const normalized = score / maximum;
        const activeBoost = options.activePath === document.path ? 1.16 : 1;
        return {
          ...document,
          score: normalized * ROLE_MULTIPLIER[document.role] * activeBoost,
          lexicalScore: normalized,
          origin: "lexical"
        };
      });
  }

  private addGraphCandidates(
    query: string,
    candidates: RetrievedChunk[],
    options: RetrievalOptions
  ): void {
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const queryTokens = new Set(tokenizeForSearch(query));
    const anchorPaths = new Set<string>();

    for (const anchor of candidates) {
      if (anchorPaths.has(anchor.path)) {
        continue;
      }
      anchorPaths.add(anchor.path);
      for (const neighbor of this.linkGraph.neighbors(anchor.path, 8)) {
        const chunks = this.searchIndex.getChunksForPath(neighbor.path);
        if (chunks.length === 0 || !roleAllowed(chunks[0]?.role ?? "other", options)) {
          continue;
        }
        const chunk = chooseGraphChunk(chunks, queryTokens, byId);
        if (!chunk) {
          continue;
        }
        const existing = byId.get(chunk.id);
        if (existing) {
          existing.score += Math.min(0.12, anchor.score * 0.08);
          continue;
        }
        const degreePenalty = Math.sqrt(Math.max(1, this.linkGraph.degree(neighbor.path)));
        const graphScore = anchor.score * 0.34 * Math.log2(neighbor.linkCount + 1) / degreePenalty;
        const graphCandidate: RetrievedChunk = {
          ...chunk,
          score: graphScore * ROLE_MULTIPLIER[chunk.role],
          lexicalScore: 0,
          origin: "wikilink",
          anchorPath: anchor.path
        };
        candidates.push(graphCandidate);
        byId.set(chunk.id, graphCandidate);
      }
      if (anchorPaths.size >= 8) {
        break;
      }
    }
  }
}

export function isSynthesisResult(chunk: RetrievedChunk): boolean {
  return SYNTHESIS_ROLES.has(chunk.role);
}
