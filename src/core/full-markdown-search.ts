import { chunkMarkdown } from "./markdown-chunker";
import {
  lexicalRescueTokens,
  matchesTechnicalIdentifierFamily
} from "./retrieval-query";
import {
  maxRetrievalQueriesForMode,
  normalizeRetrievalQueries,
  preservesExplicitQueryAnchors
} from "./retrieval-plan";
import { technicalIdentifierTokens } from "./tokenizer";
import { roleToEvidenceTier } from "./types";
import type { KnowledgeRole, NoteMetadata, RetrievedChunk } from "./types";

interface PreparedQuery {
  phrase: string;
  terms: Array<{ value: string; weight: number }>;
  totalWeight: number;
}

interface TextRelevance {
  score: number;
  strong: boolean;
}

const ROLE_MULTIPLIER: Readonly<Record<KnowledgeRole, number>> = {
  schema: 0,
  index: 0.7,
  topic: 1.04,
  concept: 1.03,
  summary: 1.02,
  wiki: 1,
  "stable-source": 1.04,
  "pending-source": 1.04,
  other: 0.88
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function termWeight(term: string): number {
  if (technicalIdentifierTokens(term).length > 0) {
    return 2.6;
  }
  if (/^[a-z\d_./#+:-]+$/iu.test(term)) {
    return Math.min(2.2, Math.max(1, Array.from(term).length / 4));
  }
  return Math.min(1.8, Math.max(1, Array.from(term).length / 2));
}

function prepareQuery(query: string): PreparedQuery | null {
  const phrase = normalizeText(query);
  const terms = lexicalRescueTokens(query).map((term) => ({
    value: normalizeText(term),
    weight: termWeight(term)
  }));
  if (!phrase || terms.length === 0) {
    return null;
  }
  return {
    phrase,
    terms,
    totalWeight: terms.reduce((sum, term) => sum + term.weight, 0)
  };
}

function relevanceForQuery(
  metadata: string,
  body: string,
  query: PreparedQuery
): TextRelevance {
  let matchedTerms = 0;
  let matchedWeight = 0;
  let metadataWeight = 0;
  for (const term of query.terms) {
    const metadataMatch = metadata.includes(term.value);
    const bodyMatch = body.includes(term.value);
    if (!metadataMatch && !bodyMatch) {
      continue;
    }
    matchedTerms += 1;
    matchedWeight += term.weight;
    if (metadataMatch) {
      metadataWeight += term.weight;
    }
  }

  const coverage = query.totalWeight > 0 ? matchedWeight / query.totalWeight : 0;
  const metadataCoverage = query.totalWeight > 0 ? metadataWeight / query.totalWeight : 0;
  const exactPhrase = metadata.includes(query.phrase) || body.includes(query.phrase);
  const strong = exactPhrase ||
    matchedTerms === query.terms.length ||
    (matchedTerms >= 2 && coverage >= 0.5) ||
    (query.terms.length === 1 && matchedTerms === 1);
  return {
    strong,
    score: coverage + metadataCoverage * 0.55 + (exactPhrase ? 0.9 : 0) +
      Math.min(0.3, matchedTerms * 0.06)
  };
}

function searchableMetadata(metadata: NoteMetadata, title = "", heading = ""): string {
  return [
    metadata.path,
    metadata.basename,
    title,
    heading,
    ...metadata.aliases,
    ...metadata.tags
  ].filter(Boolean).join("\n");
}

/**
 * Query-time lexical matcher used by precise mode. Every Markdown body is checked
 * against the model-planned phrases, while explicit identifiers from the user's
 * question remain a deterministic boundary.
 */
export class FullMarkdownSearchMatcher {
  private readonly queries: PreparedQuery[];
  private readonly identifiers: string[];

  constructor(
    private readonly originalQuery: string,
    queries: readonly string[]
  ) {
    this.queries = normalizeRetrievalQueries(
      originalQuery,
      queries,
      maxRetrievalQueriesForMode("precise")
    )
      .map(prepareQuery)
      .filter((query): query is PreparedQuery => query !== null);
    this.identifiers = technicalIdentifierTokens(originalQuery);
  }

  scoreFile(metadataText: string, markdown: string): number | null {
    return this.scoreText(metadataText, markdown);
  }

  chunksForNote(
    metadata: NoteMetadata,
    markdown: string,
    fileScore: number,
    limit = 2
  ): RetrievedChunk[] {
    const ranked: RetrievedChunk[] = [];
    for (const chunk of chunkMarkdown(metadata.path, markdown)) {
      const metadataText = searchableMetadata(metadata, chunk.title, chunk.heading);
      const relevance = this.scoreText(metadataText, chunk.text);
      if (relevance === null) {
        continue;
      }
      const document = {
        ...chunk,
        aliases: metadata.aliases.join(" "),
        tags: metadata.tags.join(" "),
        role: metadata.role,
        evidenceTier: roleToEvidenceTier(metadata.role),
        score: (relevance + fileScore * 0.3) * ROLE_MULTIPLIER[metadata.role],
        lexicalScore: relevance,
        origin: "lexical" as const
      };
      if (
        this.identifiers.length > 0 &&
        !matchesTechnicalIdentifierFamily(this.identifiers, document)
      ) {
        continue;
      }
      ranked.push(document);
    }
    return ranked
      .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
      .slice(0, Math.max(1, limit));
  }

  private scoreText(metadataText: string, bodyText: string): number | null {
    if (this.queries.length === 0) {
      return null;
    }
    const combined = `${metadataText}\n${bodyText}`;
    if (!preservesExplicitQueryAnchors(this.originalQuery, combined)) {
      return null;
    }
    const metadata = normalizeText(metadataText);
    const body = normalizeText(bodyText);
    let bestScore = 0;
    let strongMatches = 0;
    for (const query of this.queries) {
      const relevance = relevanceForQuery(metadata, body, query);
      if (!relevance.strong) {
        continue;
      }
      strongMatches += 1;
      bestScore = Math.max(bestScore, relevance.score);
    }
    return strongMatches === 0
      ? null
      : bestScore + Math.min(1.5, strongMatches * 0.28);
  }
}

export function preciseRoleMultiplier(role: KnowledgeRole): number {
  return ROLE_MULTIPLIER[role];
}
