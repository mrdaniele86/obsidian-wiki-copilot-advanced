import type { ConversationTurn, StoredConversation } from "./conversation-types";

export type ConversationSearchField = "title" | "user" | "assistant";

export interface ConversationSearchResult {
  stored: StoredConversation;
  score: number;
  excerpt: string;
  matchedField: ConversationSearchField;
}

interface NormalizedText {
  text: string;
  positions: number[];
}

interface FieldMatch {
  score: number;
  excerpt: string;
  matchedField: ConversationSearchField;
}

const excerptLength = 160;

export function searchConversations(
  conversations: StoredConversation[],
  query: string
): ConversationSearchResult[] {
  const normalizedQuery = normalize(query).text.trim();
  const results = conversations.map((stored) => {
    if (!normalizedQuery) {
      return {
        stored,
        score: 0,
        excerpt: stored.conversation.title,
        matchedField: "title" as const
      };
    }

    const matches = fieldsFor(stored).flatMap(({ content, matchedField }) => {
      const match = scoreField(content, normalizedQuery);
      return match === null ? [] : [{ ...match, matchedField }];
    });
    const best = matches.reduce<FieldMatch | null>((current, match) => {
      return current === null || match.score > current.score ? match : current;
    }, null);

    return best === null ? null : { stored, ...best };
  }).filter((result): result is ConversationSearchResult => result !== null);

  return results.sort((left, right) => right.score - left.score
    || updatedAt(right.stored) - updatedAt(left.stored));
}

function fieldsFor(stored: StoredConversation): Array<{
  content: string;
  matchedField: ConversationSearchField;
}> {
  return [
    { content: stored.conversation.title, matchedField: "title" },
    ...stored.conversation.turns.map((turn) => ({
      content: turn.content,
      matchedField: fieldForTurn(turn)
    }))
  ];
}

function fieldForTurn(turn: ConversationTurn): ConversationSearchField {
  return turn.role;
}

function scoreField(content: string, query: string): Omit<FieldMatch, "matchedField"> | null {
  const normalized = normalize(content);
  const positions = findSubsequence(normalized.text, query);
  if (positions === null) return null;

  let score = query.length * 10;
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    if (position === undefined) continue;
    if (position === 0 || normalized.text[position - 1] === " ") score += 6;
    if (index > 0 && positions[index - 1] === position - 1) score += 8;
  }

  const start = normalized.positions[positions[0] ?? 0] ?? 0;
  const end = normalized.positions[positions[positions.length - 1] ?? 0] ?? content.length;
  const matchPositions = positions.map((position) => normalized.positions[position] ?? 0);
  return { score, excerpt: excerpt(content, start, end, matchPositions) };
}

function normalize(value: string): NormalizedText {
  let text = "";
  const positions: number[] = [];
  let previousWasSpace = true;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) continue;
    const folded = character.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
    for (const letter of folded) {
      if (/^[\p{L}\p{N}]$/u.test(letter)) {
        text += letter;
        positions.push(index);
        previousWasSpace = false;
      } else if (!previousWasSpace) {
        text += " ";
        positions.push(index);
        previousWasSpace = true;
      }
    }
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    positions.pop();
  }
  return { text, positions };
}

function findSubsequence(content: string, query: string): number[] | null {
  const positions: number[] = [];
  let next = 0;
  for (const character of query) {
    const position = content.indexOf(character, next);
    if (position < 0) return null;
    positions.push(position);
    next = position + 1;
  }
  return positions;
}

function excerpt(content: string, start: number, end: number, matchPositions: number[]): string {
  if (content.length <= excerptLength) return content;

  if (end - start + 1 <= excerptLength) {
    const context = Math.floor((excerptLength - (end - start + 1)) / 2);
    const excerptStart = Math.max(0, start - context);
    const excerptEnd = Math.min(content.length, end + context + 1);
    return `${excerptStart > 0 ? "…" : ""}${content.slice(excerptStart, excerptEnd)}${excerptEnd < content.length ? "…" : ""}`;
  }

  const separators = Math.max(0, matchPositions.length - 1);
  const windowLength = Math.max(1, Math.floor((excerptLength - separators) / matchPositions.length));
  const context = Math.floor((windowLength - 1) / 2);
  return matchPositions.map((position) => content.slice(
    Math.max(0, position - context),
    Math.min(content.length, position + context + 1)
  )).join("…");
}

function updatedAt(stored: StoredConversation): number {
  return Date.parse(stored.conversation.updatedAt) || 0;
}
