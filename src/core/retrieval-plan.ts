import {
  lexicalRescueTokens,
  matchesTechnicalIdentifierFamily
} from "./retrieval-query";
import { containsCjk, technicalIdentifierTokens, tokenizeForSearch } from "./tokenizer";
import type { RetrievalResult, RetrievedChunk } from "./types";

const MAX_FAST_RETRIEVAL_QUERIES = 7;
const MAX_PRECISE_RETRIEVAL_QUERIES = 11;
const MAX_RETRIEVAL_QUERY_CHARACTERS = 180;
const ACRONYM = /\b[A-Z][A-Z\d_-]{2,}\b/gu;
const MIXED_LANGUAGE_LATIN_TOKEN = /[a-z][a-z\d_-]{1,}/giu;

export type RetrievalPlanningMode = "fast" | "precise";

export function maxRetrievalQueriesForMode(mode: RetrievalPlanningMode): number {
  return mode === "fast"
    ? MAX_FAST_RETRIEVAL_QUERIES
    : MAX_PRECISE_RETRIEVAL_QUERIES;
}

export interface QueryRelevance {
  score: number;
  strong: boolean;
  matchedTerms: number;
  totalTerms: number;
}

function normalizedQuery(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^(?:[-*]\s+|\d+[.)]\s+)/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_RETRIEVAL_QUERY_CHARACTERS);
}

function explicitAnchors(query: string): string[] {
  return [...new Set([
    ...technicalIdentifierTokens(query),
    ...[...query.normalize("NFKC").matchAll(ACRONYM)]
      .map((match) => (match[0] ?? "").toLocaleLowerCase())
      .filter(Boolean),
    ...(containsCjk(query)
      ? [...query.normalize("NFKC").matchAll(MIXED_LANGUAGE_LATIN_TOKEN)]
        .map((match) => (match[0] ?? "").toLocaleLowerCase())
        .filter(Boolean)
      : [])
  ])];
}

function preservesAnchors(query: string, anchors: readonly string[]): boolean {
  const normalized = query.toLocaleLowerCase().split(/[._/#+:\s-]+/u).join("");
  return anchors.every((anchor) => normalized.includes(
    anchor.toLocaleLowerCase().split(/[._/#+:\s-]+/u).join("")
  ));
}

export function preservesExplicitQueryAnchors(originalQuery: string, text: string): boolean {
  return preservesAnchors(text, explicitAnchors(originalQuery));
}

export function hasExplicitQueryAnchors(query: string): boolean {
  return explicitAnchors(query).length > 0;
}

export function normalizeRetrievalQueries(
  originalQuery: string,
  candidates: readonly string[],
  limit = MAX_PRECISE_RETRIEVAL_QUERIES
): string[] {
  const original = normalizedQuery(originalQuery);
  if (!original) {
    return [];
  }
  const anchors = explicitAnchors(original);
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [original, ...candidates]) {
    const normalized = normalizedQuery(candidate);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key) || !preservesAnchors(normalized, anchors)) {
      continue;
    }
    queries.push(normalized);
    seen.add(key);
    if (queries.length >= Math.max(1, limit)) {
      break;
    }
  }
  return queries;
}

function parsedQueries(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const queries = (value as { queries?: unknown }).queries;
  return Array.isArray(queries)
    ? queries.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseRetrievalQueries(
  originalQuery: string,
  response: string,
  mode: RetrievalPlanningMode = "precise"
): string[] {
  const trimmed = response
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  const candidates = [
    trimmed,
    firstObject >= 0 && lastObject > firstObject
      ? trimmed.slice(firstObject, lastObject + 1)
      : "",
    firstArray >= 0 && lastArray > firstArray
      ? trimmed.slice(firstArray, lastArray + 1)
      : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const queries = parsedQueries(JSON.parse(candidate) as unknown);
      if (queries.length > 0) {
        return normalizeRetrievalQueries(
          originalQuery,
          queries,
          maxRetrievalQueriesForMode(mode)
        );
      }
    } catch {
      // Try the next bounded JSON slice. Free-form planner output is not trusted.
    }
  }
  return normalizeRetrievalQueries(
    originalQuery,
    [],
    maxRetrievalQueriesForMode(mode)
  );
}

function termWeight(term: string): number {
  if (technicalIdentifierTokens(term).length > 0) {
    return 2.4;
  }
  if (/^[a-z\d_./#+:-]+$/iu.test(term)) {
    return Math.min(2, Math.max(1, Array.from(term).length / 4));
  }
  return Math.min(1.6, Math.max(1, Array.from(term).length / 2));
}

export function queryRelevance(text: string, query: string): QueryRelevance {
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase();
  const normalizedPhrase = query.normalize("NFKC").toLocaleLowerCase().trim();
  const tokens = new Set(tokenizeForSearch(text).map((token) => token.toLocaleLowerCase()));
  const terms = lexicalRescueTokens(query);
  if (terms.length === 0) {
    return { score: 0, strong: false, matchedTerms: 0, totalTerms: 0 };
  }

  let matchedTerms = 0;
  let matchedWeight = 0;
  let totalWeight = 0;
  for (const term of terms) {
    const weight = termWeight(term);
    totalWeight += weight;
    if (tokens.has(term) || normalizedText.includes(term)) {
      matchedTerms += 1;
      matchedWeight += weight;
    }
  }
  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const exactPhrase = normalizedPhrase.length >= 3 && normalizedText.includes(normalizedPhrase);
  const strong = exactPhrase ||
    matchedTerms === terms.length ||
    (matchedTerms >= 2 && coverage >= 0.5) ||
    (terms.length === 1 && matchedTerms === 1);
  return {
    score: coverage + (exactPhrase ? 0.8 : 0) + Math.min(0.3, matchedTerms * 0.06),
    strong,
    matchedTerms,
    totalTerms: terms.length
  };
}

export function bestQueryRelevance(text: string, queries: readonly string[]): QueryRelevance {
  let best: QueryRelevance = { score: 0, strong: false, matchedTerms: 0, totalTerms: 0 };
  for (const query of queries) {
    const current = queryRelevance(text, query);
    if (
      Number(current.strong) > Number(best.strong) ||
      (current.strong === best.strong && current.score > best.score)
    ) {
      best = current;
    }
  }
  return best;
}

function chunkSearchText(chunk: RetrievedChunk): string {
  return [
    chunk.path,
    chunk.title,
    chunk.heading,
    chunk.aliases,
    chunk.tags,
    chunk.text
  ].join("\n");
}

function chunkMetadataSearchText(chunk: RetrievedChunk): string {
  return [chunk.path, chunk.title, chunk.heading, chunk.aliases, chunk.tags].join("\n");
}

interface AggregatedChunk {
  chunk: RetrievedChunk;
  bestBaseScore: number;
  queryHits: number;
  firstOrder: number;
}

export function mergeRetrievalResults(
  originalQuery: string,
  queries: readonly string[],
  results: readonly RetrievalResult[],
  precise: boolean,
  maxPages: number,
  maxCharacters: number
): RetrievalResult {
  const normalizedQueries = normalizeRetrievalQueries(originalQuery, queries);
  const byId = new Map<string, AggregatedChunk>();
  let order = 0;
  for (const result of results) {
    const seenInResult = new Set<string>();
    for (const chunk of result.chunks) {
      const existing = byId.get(chunk.id);
      if (!existing) {
        byId.set(chunk.id, {
          chunk,
          bestBaseScore: chunk.score,
          queryHits: 1,
          firstOrder: order
        });
      } else {
        if (chunk.score > existing.bestBaseScore) {
          existing.chunk = chunk;
          existing.bestBaseScore = chunk.score;
        }
        if (!seenInResult.has(chunk.id)) {
          existing.queryHits += 1;
        }
      }
      seenInResult.add(chunk.id);
      order += 1;
    }
  }

  const identifiers = technicalIdentifierTokens(originalQuery);
  const hasExplicitAnchors = hasExplicitQueryAnchors(originalQuery);
  const scored = [...byId.values()]
    .map((entry) => {
      const text = chunkSearchText(entry.chunk);
      const relevance = bestQueryRelevance(text, normalizedQueries);
      const originalRelevance = queryRelevance(text, originalQuery);
      const identifierMatch = identifiers.length > 0 &&
        matchesTechnicalIdentifierFamily(identifiers, entry.chunk);
      const metadataAnchor = hasExplicitAnchors && preservesExplicitQueryAnchors(
        originalQuery,
        chunkMetadataSearchText(entry.chunk)
      );
      return {
        ...entry,
        relevance,
        identifierMatch,
        metadataAnchor,
        score: entry.bestBaseScore + relevance.score * 0.72 +
          originalRelevance.score * 0.18 + Math.min(0.24, entry.queryHits * 0.06) +
          (metadataAnchor ? 0.45 : 0)
      };
    })
    .filter((entry) => !precise || (
      (entry.relevance.strong || entry.identifierMatch) &&
      preservesExplicitQueryAnchors(originalQuery, chunkSearchText(entry.chunk))
    ));
  const hasDirectSourceAnchor = scored.some((entry) =>
    (entry.chunk.role === "stable-source" || entry.chunk.role === "pending-source") &&
    entry.metadataAnchor
  );
  const ranked = scored
    .filter((entry) => !precise || !hasDirectSourceAnchor ||
      (entry.chunk.role !== "stable-source" && entry.chunk.role !== "pending-source") ||
      entry.metadataAnchor)
    .sort((left, right) =>
      Number(right.metadataAnchor) - Number(left.metadataAnchor) ||
      Number(right.relevance.strong) - Number(left.relevance.strong) ||
      Number(right.identifierMatch) - Number(left.identifierMatch) ||
      right.score - left.score ||
      left.firstOrder - right.firstOrder ||
      left.chunk.path.localeCompare(right.chunk.path));

  const chunks: RetrievedChunk[] = [];
  const paths = new Set<string>();
  const chunksPerPath = new Map<string, number>();
  let characters = 0;
  for (const entry of ranked) {
    const chunk = { ...entry.chunk, score: entry.score };
    const pathCount = chunksPerPath.get(chunk.path) ?? 0;
    if (pathCount >= 2 || (!paths.has(chunk.path) && paths.size >= maxPages)) {
      continue;
    }
    if (chunks.length > 0 && characters + chunk.text.length > maxCharacters) {
      continue;
    }
    chunks.push(chunk);
    paths.add(chunk.path);
    chunksPerPath.set(chunk.path, pathCount + 1);
    characters += chunk.text.length;
  }

  return {
    query: originalQuery,
    chunks,
    totalCandidates: results.reduce((sum, result) => sum + result.totalCandidates, 0),
    truncated: results.some((result) => result.truncated) || chunks.length < ranked.length
  };
}
