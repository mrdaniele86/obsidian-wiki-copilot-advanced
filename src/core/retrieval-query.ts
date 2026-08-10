import { technicalIdentifierTokens, tokenizeForSearch } from "./tokenizer";
import type { ChatTurn, RetrievalResult, RetrievedChunk } from "./types";

const EXPLICIT_FOLLOW_UP = /^(?:(?:这个|这些|它们?|上述|前面|刚才|之前|继续|接着|再说|那个|那些|那|那么|还有|另外|对应|同样|其中|其它|其他)|(?:this|that|those|it|they|continue|what about|and)\b)/iu;
const ELLIPTICAL_FOLLOW_UP = /^[^，。！？?]{1,8}呢[？?]?$/u;
const QUERY_CONTROL_TOKENS = new Set([
  "所有", "全部", "全量", "完整", "汇总", "列出", "清单", "哪些", "有哪", "每个", "各个",
  "all", "every", "list", "enumerate", "inventory", "catalog",
  "请", "一下", "关于", "相关", "资料", "信息", "数据", "内容",
  "的", "是", "什么", "多少", "如何", "怎么"
]);

const MAX_LEXICAL_RESCUE_TOKENS = 12;
const BREADTH_QUERY = /(?:所有|全部|全量|完整|汇总|列出|清单|有哪些|每个|各个)|(?:^|\s)(?:all|every|list|enumerate|inventory|catalog)(?:\s|$)/iu;

interface TechnicalIdentifierContent {
  path: string;
  title: string;
  heading: string;
  aliases: string;
  tags: string;
  text: string;
  role?: string;
}

export function hasBreadthIntent(query: string): boolean {
  return BREADTH_QUERY.test(query.normalize("NFKC"));
}

/**
 * Produces a small deterministic term set for query-time index repair. The persistent
 * MiniSearch index remains the normal path; these terms are only used to locate notes
 * directly when a device-local cache returns no useful result.
 */
export function lexicalRescueTokens(query: string): string[] {
  const identifiers = new Set(technicalIdentifierTokens(query));
  return [...new Set(tokenizeForSearch(query)
    .map((token) => token.toLocaleLowerCase())
    .filter((token) => token.length >= 2 && !QUERY_CONTROL_TOKENS.has(token)))]
    .sort((left, right) =>
      Number(identifiers.has(right)) - Number(identifiers.has(left)) ||
      right.length - left.length ||
      left.localeCompare(right))
    .slice(0, MAX_LEXICAL_RESCUE_TOKENS);
}

export function lexicalSubstringScore(text: string, terms: readonly string[]): number {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) {
      score += Math.max(1, Array.from(term).length);
    }
  }
  return score;
}

export function technicalQuerySubjectTokens(query: string): string[] {
  const identifiers = technicalIdentifierTokens(query)
    .sort((left, right) => right.length - left.length);
  let subject = query.normalize("NFKC").toLocaleLowerCase();
  for (const identifier of identifiers) {
    subject = subject.split(identifier).join(" ");
  }
  return [...new Set(tokenizeForSearch(subject)
    .map((token) => token.toLocaleLowerCase())
    .filter((token) => !QUERY_CONTROL_TOKENS.has(token)))];
}

export function isExplicitFollowUpQuestion(question: string): boolean {
  const normalized = question.trim();
  return EXPLICIT_FOLLOW_UP.test(normalized) || ELLIPTICAL_FOLLOW_UP.test(normalized);
}

/**
 * Short questions are not automatically follow-ups. A query containing an explicit identifier
 * must not inherit unrelated identifiers from the previous turn.
 */
export function retrievalQueryForQuestion(question: string, history: readonly ChatTurn[]): string {
  const current = question.trim();
  const previous = [...history].reverse().find((turn) => turn.role === "user")?.content.trim();
  if (
    !previous ||
    !isExplicitFollowUpQuestion(current) ||
    technicalIdentifierTokens(current).length > 0
  ) {
    return current;
  }
  return `${previous}\n${current}`;
}

function chunkMetadataIdentifierTokens(chunk: TechnicalIdentifierContent): Set<string> {
  return new Set(technicalIdentifierTokens([
    chunk.path,
    chunk.title,
    chunk.heading,
    chunk.aliases,
    chunk.tags
  ].join(" ")));
}

function hasMetadataIdentifier(
  identifiers: ReadonlySet<string>,
  chunk: TechnicalIdentifierContent
): boolean {
  const metadataIdentifiers = chunkMetadataIdentifierTokens(chunk);
  return [...identifiers].some((identifier) => metadataIdentifiers.has(identifier));
}

function identifierShape(identifier: string): string | null {
  const match = /^([a-z]+)(\d+)[a-z]*$/iu.exec(identifier);
  return match?.[1] && match[2]
    ? `${Array.from(match[1]).length}:${Array.from(match[2]).length}`
    : null;
}

/**
 * Accepts an exact identifier in metadata, or in body text when metadata does not
 * identify a conflicting peer entity with the same identifier shape.
 */
export function matchesTechnicalIdentifierFamily(
  identifiers: readonly string[],
  chunk: TechnicalIdentifierContent
): boolean {
  const requested = new Set(identifiers.map((identifier) => identifier.toLocaleLowerCase()));
  if (requested.size === 0) {
    return true;
  }
  const metadataIdentifiers = chunkMetadataIdentifierTokens(chunk);
  if (hasMetadataIdentifier(requested, chunk)) {
    return true;
  }
  if (chunk.role === "index" || chunk.role === "schema") {
    return false;
  }
  const textIdentifiers = new Set(technicalIdentifierTokens(chunk.text));
  if (![...requested].some((identifier) => textIdentifiers.has(identifier))) {
    return false;
  }

  const requestedShapes = new Set(
    [...requested].map(identifierShape).filter((shape): shape is string => shape !== null)
  );
  return ![...metadataIdentifiers].some((identifier) => {
    if (requested.has(identifier)) {
      return false;
    }
    const shape = identifierShape(identifier);
    return shape !== null && requestedShapes.has(shape);
  });
}

export function hasTechnicalIdentifierAnchor(query: string, result: RetrievalResult): boolean {
  const identifiers = technicalIdentifierTokens(query);
  if (identifiers.length === 0) {
    return true;
  }
  const requested = new Set(identifiers);
  return result.chunks.some((chunk) => hasMetadataIdentifier(requested, chunk));
}

/**
 * Never let a conflicting identifier family reach the model after an exact lookup failed.
 * This final boundary is intentionally duplicated after hybrid retrieval and cache repair.
 */
export function discardUnanchoredTechnicalResult(
  query: string,
  result: RetrievalResult
): RetrievalResult {
  if (technicalIdentifierTokens(query).length === 0) {
    return result;
  }
  const chunks = keepTechnicalIdentifierFamily(query, result.chunks);
  return {
    ...result,
    chunks,
    truncated: result.truncated || chunks.length < result.chunks.length
  };
}

export function exactIdentifierMissingMessage(query: string): string | null {
  const identifiers = technicalIdentifierTokens(query);
  if (identifiers.length === 0) {
    return null;
  }
  const label = identifiers.map((identifier) => identifier.toLocaleUpperCase()).join("、");
  return [
    `当前设备尚未检索到与 **${label}** 精确匹配的知识库依据。`,
    "为避免混入其他实体、版本或条目的资料，本次不会用近似匹配内容替代回答。请确认相关文件已同步到当前设备，或手动重建知识索引后重试。"
  ].join("\n\n");
}

/**
 * Once exact identifier matches exist, keep the identifier as an invariant across the final
 * context so Wikilink expansion cannot reintroduce a conflicting identifier family.
 */
export function keepTechnicalIdentifierFamily(
  query: string,
  chunks: RetrievedChunk[]
): RetrievedChunk[] {
  const identifiers = technicalIdentifierTokens(query);
  if (identifiers.length === 0) {
    return chunks;
  }
  const anchored = chunks.filter((chunk) => matchesTechnicalIdentifierFamily(identifiers, chunk));
  if (anchored.length === 0) {
    return [];
  }

  const subjectTokens = technicalQuerySubjectTokens(query);
  if (subjectTokens.length === 0) {
    return anchored;
  }

  const ranked = anchored.map((chunk, index) => {
    const chunkTokens = new Set(tokenizeForSearch(`${chunk.heading} ${chunk.text}`)
      .map((token) => token.toLocaleLowerCase()));
    return {
      chunk,
      index,
      subjectMatches: subjectTokens.reduce(
        (count, token) => count + Number(chunkTokens.has(token)),
        0
      )
    };
  }).sort((left, right) =>
    right.subjectMatches - left.subjectMatches || left.index - right.index
  );
  // Retrieval has already selected query-related candidates. Preserve the entire
  // requested family and use subject matches only for ordering, so a short question
  // does not silently erase additional relevant variants or supporting context.
  return ranked.map(({ chunk }) => chunk);
}
