import { chunkMarkdown } from "./markdown-chunker";
import { CooperativeScheduler } from "./cooperative";
import { tokenizeForSearch } from "./tokenizer";
import type { MarkdownChunk } from "./types";

interface ScoredEvidenceChunk {
  chunk: MarkdownChunk;
  score: number;
}

function tokenWeight(token: string): number {
  const length = Array.from(token).length;
  if (/^[a-z0-9]/iu.test(token)) {
    return Math.min(4, Math.max(1, length / 3));
  }
  return Math.min(3, Math.max(1, length));
}

/**
 * Selects a small set of relevant sections from a very large source without
 * retaining a full inverted index for that source. The scan is query-specific
 * and intentionally lexical: Wiki pages provide the semantic routing layer.
 */
export function selectRelevantEvidenceChunks(
  path: string,
  markdown: string,
  query: string,
  limit = 12
): MarkdownChunk[] {
  const chunks = chunkMarkdown(path, markdown);
  const queryTokens = new Set(tokenizeForSearch(query));
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().trim();
  const scored = chunks.map((chunk) => scoreChunk(chunk, queryTokens, normalizedQuery));
  return selectTopChunks(chunks, scored, limit);
}

export async function selectRelevantEvidenceChunksAsync(
  path: string,
  markdown: string,
  query: string,
  limit = 12
): Promise<MarkdownChunk[]> {
  const chunks = chunkMarkdown(path, markdown);
  const queryTokens = new Set(tokenizeForSearch(query));
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().trim();
  const scored: ScoredEvidenceChunk[] = [];
  const scheduler = new CooperativeScheduler(8, 32);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk) {
      scored.push(scoreChunk(chunk, queryTokens, normalizedQuery));
    }
    await scheduler.checkpoint();
  }
  return selectTopChunks(chunks, scored, limit);
}

function scoreChunk(
  chunk: MarkdownChunk,
  queryTokens: ReadonlySet<string>,
  normalizedQuery: string
): ScoredEvidenceChunk {
    const headingTokens = new Set(tokenizeForSearch(`${chunk.title} ${chunk.heading}`));
    const bodyTokens = new Set(tokenizeForSearch(chunk.text));
    let score = 0;
    for (const token of queryTokens) {
      const weight = tokenWeight(token);
      if (headingTokens.has(token)) {
        score += weight * 5;
      }
      if (bodyTokens.has(token)) {
        score += weight;
      }
    }
    if (normalizedQuery && chunk.text.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery)) {
      score += 20;
    }
    return { chunk, score };
}

function selectTopChunks(
  chunks: MarkdownChunk[],
  scored: ScoredEvidenceChunk[],
  limit: number
): MarkdownChunk[] {
  const selected = scored
    .sort((left, right) => right.score - left.score || left.chunk.chunkIndex - right.chunk.chunkIndex)
    .slice(0, limit)
    .map(({ chunk }) => chunk);

  // Preserve an introduction as scope context when all lexical scores are weak.
  if (selected.length > 0 && scored[0]?.score === 0 && chunks[0] && !selected.includes(chunks[0])) {
    selected[selected.length - 1] = chunks[0];
  }
  return selected;
}
