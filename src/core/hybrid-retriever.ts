import { EvidenceReferenceMap } from "./evidence-references";
import { yieldToUi } from "./cooperative";
import { selectRelevantEvidenceChunksAsync } from "./evidence-chunk-selector";
import { LinkGraph } from "./link-graph";
import { DEFAULT_RETRIEVAL_OPTIONS, WikiRetriever } from "./retriever";
import { WikiSearchIndex } from "./search-index";
import { SourceCatalogIndex } from "./source-catalog";
import type {
  NoteMetadata,
  RetrievalOptions,
  RetrievalResult,
  RetrievedChunk
} from "./types";

export interface EvidenceNote {
  metadata: NoteMetadata;
  markdown: string;
}

export type EvidenceLoader = (paths: string[]) => Promise<EvidenceNote[]>;
export type RetrievalProgress = (message: string) => void;

const BREADTH_QUERY = /(?:所有|全部|全量|完整|汇总|列出|清单|有哪些|每个|各个)|(?:^|\s)(?:all|every|list|enumerate|inventory|catalog)(?:\s|$)/iu;

export function hasBreadthIntent(query: string): boolean {
  return BREADTH_QUERY.test(query.normalize("NFKC"));
}

class BoundedEvidenceIndex {
  readonly index = new WikiSearchIndex();
  readonly retriever: WikiRetriever;

  private readonly loaded = new Map<string, { characters: number; queryKey: string | null }>();
  private totalCharacters = 0;

  constructor(
    graph: LinkGraph,
    private readonly maxFiles = 24,
    private readonly maxCharacters = 2_500_000,
    private readonly largeFileCharacters = 100_000
  ) {
    this.retriever = new WikiRetriever(this.index, graph);
  }

  canReuse(path: string, query: string): boolean {
    const entry = this.loaded.get(path);
    const reusable = entry !== undefined && (entry.queryKey === null || entry.queryKey === this.queryKey(query));
    if (reusable && entry) {
      this.loaded.delete(path);
      this.loaded.set(path, entry);
    }
    return reusable;
  }

  async add(note: EvidenceNote, query: string): Promise<void> {
    await this.removeAsync(note.metadata.path);
    const isLarge = note.markdown.length > this.largeFileCharacters;
    const chunks = isLarge
      ? await selectRelevantEvidenceChunksAsync(note.metadata.path, note.markdown, query)
      : null;
    const size = chunks
      ? chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
      : note.markdown.length;
    while (
      this.loaded.size > 0 &&
      (this.loaded.size >= this.maxFiles || this.totalCharacters + size > this.maxCharacters)
    ) {
      const oldest = this.loaded.keys().next().value;
      if (!oldest) {
        break;
      }
      await this.removeAsync(oldest);
    }
    if (chunks) {
      await this.index.replaceChunksAsync(note.metadata, chunks);
    } else {
      await this.index.replaceNoteAsync(note.metadata, note.markdown);
    }
    this.loaded.set(note.metadata.path, {
      characters: size,
      queryKey: isLarge ? this.queryKey(query) : null
    });
    this.totalCharacters += size;
  }

  remove(path: string): void {
    const entry = this.loaded.get(path);
    if (entry === undefined) {
      return;
    }
    this.index.removePath(path);
    this.loaded.delete(path);
    this.totalCharacters -= entry.characters;
  }

  private async removeAsync(path: string): Promise<void> {
    const entry = this.loaded.get(path);
    if (entry === undefined) {
      return;
    }
    await this.index.removePathAsync(path);
    this.loaded.delete(path);
    this.totalCharacters -= entry.characters;
  }

  clear(): void {
    this.index.clear();
    this.loaded.clear();
    this.totalCharacters = 0;
  }

  private queryKey(query: string): string {
    return [...new Set(query.normalize("NFKC").toLocaleLowerCase().split(/\s+/u).filter(Boolean))]
      .sort()
      .join(" ");
  }
}

function uniquePaths(groups: Iterable<string>[], limit: number): string[] {
  if (limit <= 0) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      output.push(path);
      if (output.length >= limit) {
        return output;
      }
    }
  }
  return output;
}

function enforceFinalBudget(
  chunks: RetrievedChunk[],
  maxCharacters: number,
  maxPages: number
): RetrievedChunk[] {
  const output: RetrievedChunk[] = [];
  const paths = new Set<string>();
  let characters = 0;
  for (const chunk of chunks) {
    if (!paths.has(chunk.path) && paths.size >= maxPages) {
      continue;
    }
    if (output.length > 0 && characters + chunk.text.length > maxCharacters) {
      continue;
    }
    output.push(chunk);
    paths.add(chunk.path);
    characters += chunk.text.length;
  }
  return output;
}

export class HybridWikiRetriever {
  private readonly primaryRetriever: WikiRetriever;
  private readonly evidenceCache: BoundedEvidenceIndex;

  constructor(
    primaryIndex: WikiSearchIndex,
    private readonly graph: LinkGraph,
    private readonly sourceCatalog: SourceCatalogIndex,
    private readonly evidenceReferences: EvidenceReferenceMap,
    private readonly loadEvidence: EvidenceLoader
  ) {
    this.primaryRetriever = new WikiRetriever(primaryIndex, graph);
    this.evidenceCache = new BoundedEvidenceIndex(graph);
  }

  async retrieve(
    query: string,
    options: Partial<RetrievalOptions> = {},
    onProgress?: RetrievalProgress
  ): Promise<RetrievalResult> {
    onProgress?.("正在检索 Wiki 知识层…");
    const requestedBudget = options.maxContextCharacters ?? DEFAULT_RETRIEVAL_OPTIONS.maxContextCharacters;
    const requestedPages = options.maxRetrievedPages ?? DEFAULT_RETRIEVAL_OPTIONS.maxRetrievedPages;
    const breadthIntent = hasBreadthIntent(query);
    const wikiBudget = Math.max(4_000, Math.floor(requestedBudget * (breadthIntent ? 0.5 : 0.68)));
    const primary = this.primaryRetriever.retrieve(query, {
      ...options,
      includePending: false,
      maxStableSourceResults: 0,
      maxPendingResults: 0,
      maxRetrievedPages: requestedPages,
      maxContextCharacters: wikiBudget
    });
    await yieldToUi();

    const includePending = options.includePending ?? false;
    const maxEvidenceFiles = options.maxEvidenceFiles ?? DEFAULT_RETRIEVAL_OPTIONS.maxEvidenceFiles;
    const usedPages = new Set(primary.chunks.map((chunk) => chunk.path)).size;
    const remainingPages = Math.max(0, requestedPages - usedPages);
    const evidenceCandidateLimit = Math.max(8, maxEvidenceFiles * 2);
    const anchorPaths = primary.chunks.map((chunk) => chunk.path);
    const referencedPaths = this.evidenceReferences.relatedTo(anchorPaths, evidenceCandidateLimit);
    const graphPaths = anchorPaths.flatMap((path) =>
      this.graph.neighbors(path, 8)
        .map((neighbor) => neighbor.path)
        .filter((neighbor) => {
          const role = this.sourceCatalog.roleForPath(neighbor);
          return role === "stable-source" || (includePending && role === "pending-source");
        })
    );
    const catalogHits = await this.sourceCatalog.searchAsync(query, includePending, evidenceCandidateLimit);
    const catalogPaths = catalogHits.map((hit) => hit.path);
    const catalogRanks = new Map(catalogHits.map((hit, index) => [hit.path, index]));
    const activePaths = options.activePath && this.sourceCatalog.hasPath(options.activePath)
      ? [options.activePath]
      : [];
    const evidenceLoadLimit = remainingPages <= 0
      ? 0
      : breadthIntent
        ? Math.min(evidenceCandidateLimit, maxEvidenceFiles + 4)
        : Math.min(maxEvidenceFiles, remainingPages);
    const evidencePaths = uniquePaths(
      breadthIntent
        ? [catalogPaths, referencedPaths, graphPaths, activePaths]
        : [activePaths, referencedPaths, graphPaths, catalogPaths],
      evidenceLoadLimit
    );
    const selectionQuery = [
      query,
      ...primary.chunks.slice(0, 4).flatMap((chunk) => [chunk.title, chunk.heading]).filter(Boolean)
    ].join(" ");
    const missingPaths = evidencePaths.filter((path) => !this.evidenceCache.canReuse(path, selectionQuery));
    if (missingPaths.length > 0) {
      onProgress?.(`正在回查 ${missingPaths.length} 份来源原文…`);
      await yieldToUi();
      for (const note of await this.loadEvidence(missingPaths)) {
        await this.evidenceCache.add(note, selectionQuery);
        await yieldToUi();
      }
    }

    onProgress?.("正在筛选可引用的证据片段…");
    await yieldToUi();
    const usedWikiCharacters = primary.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    const evidenceBudget = Math.max(2_400, requestedBudget - usedWikiCharacters);
    const finalStableLimit = Math.min(
      options.maxStableSourceResults ?? DEFAULT_RETRIEVAL_OPTIONS.maxStableSourceResults,
      remainingPages
    );
    const finalPendingLimit = Math.min(
      options.maxPendingResults ?? DEFAULT_RETRIEVAL_OPTIONS.maxPendingResults,
      remainingPages
    );
    const candidateResultLimit = breadthIntent
      ? Math.min(evidenceLoadLimit, remainingPages)
      : finalStableLimit;
    const evidence = this.evidenceCache.retriever.retrieve(query, {
      ...options,
      includeOtherNotes: false,
      maxIndexResults: 0,
      maxTopicConceptResults: 0,
      maxSummaryResults: 0,
      maxWikiResults: 0,
      maxStableSourceResults: candidateResultLimit,
      maxPendingResults: breadthIntent ? Math.min(evidenceCandidateLimit, remainingPages) : finalPendingLimit,
      maxRetrievedPages: remainingPages,
      maxContextCharacters: breadthIntent ? requestedBudget : evidenceBudget,
      graphExpansion: false
    });

    const finalEvidenceLimit = Math.min(
      remainingPages,
      finalStableLimit + (includePending ? finalPendingLimit : 0)
    );
    const evidenceChunks = breadthIntent
      ? [...evidence.chunks]
        .sort((left, right) => {
          const leftRank = catalogRanks.get(left.path) ?? Number.MAX_SAFE_INTEGER;
          const rightRank = catalogRanks.get(right.path) ?? Number.MAX_SAFE_INTEGER;
          return leftRank - rightRank || right.score - left.score || left.path.localeCompare(right.path);
        })
        .slice(0, finalEvidenceLimit)
      : evidence.chunks;

    const combined = enforceFinalBudget(
      [...primary.chunks, ...evidenceChunks],
      requestedBudget,
      requestedPages
    );
    return {
      query,
      chunks: combined,
      totalCandidates: primary.totalCandidates + evidence.totalCandidates,
      truncated: primary.truncated || evidence.truncated ||
        evidenceChunks.length < evidence.chunks.length ||
        combined.length < primary.chunks.length + evidenceChunks.length
    };
  }

  removeEvidencePath(path: string): void {
    this.evidenceCache.remove(path);
  }

  clearEvidenceCache(): void {
    this.evidenceCache.clear();
  }
}
