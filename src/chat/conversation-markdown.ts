import type { AssistantConversationTurn, Conversation, ConversationRole, ConversationTurn } from "./conversation-types";
import type { PendingClarification } from "./pending-clarification";

const CONVERSATION_TYPE = "wiki-copilot-conversation";
const MAX_WEB_SEARCH_MODEL_CHARACTERS = 200;
const MAX_WEB_SEARCH_ANSWER_CHARACTERS = 20_000;
const MAX_WEB_SEARCH_SOURCES = 12;
const MAX_WEB_SEARCH_SOURCE_TITLE_CHARACTERS = 500;
const MAX_WEB_SEARCH_SOURCE_URL_CHARACTERS = 2_048;
const MAX_CLARIFICATION_FIELD_CHARACTERS = 2_000;
const MAX_CITATION_WARNING_CHARACTERS = 2_000;

function frontmatterValue(value: string): string {
  return JSON.stringify(value);
}

function readFrontmatter(markdown: string): Record<string, string> | null {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(markdown.replace(/\r\n?/gu, "\n"));
  if (!match) return null;
  const values: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const key = line.slice(0, separator).trim();
    try {
      const value: unknown = JSON.parse(line.slice(separator + 1).trim());
      if (typeof value !== "string") return null;
      values[key] = value;
    } catch {
      return null;
    }
  }
  return values;
}

function encodeText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function decodeText(value: string): string | null {
  try {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return null;
  }
}

function assistantState(turn: ConversationTurn): string {
  if (turn.role !== "assistant" || (turn.sources === undefined && turn.knowledgeBaseHit === undefined && turn.webSearch === undefined && turn.pendingClarification === undefined && turn.citationWarning === undefined)) return "";
  return encodeText(JSON.stringify({ sources: turn.sources, knowledgeBaseHit: turn.knowledgeBaseHit, webSearch: turn.webSearch, pendingClarification: turn.pendingClarification, citationWarning: turn.citationWarning }));
}

function isWebSearchResult(value: unknown, legacyQuestion?: string): value is NonNullable<AssistantConversationTurn["webSearch"]> {
  if (!value || typeof value !== "object") return false;
  const { provider, question, model, answer, sources } = value as Record<string, unknown>;
  const validQuestion = question === undefined
    ? isBoundedNonEmptyString(legacyQuestion, MAX_WEB_SEARCH_ANSWER_CHARACTERS)
    : isBoundedNonEmptyString(question, MAX_WEB_SEARCH_ANSWER_CHARACTERS);
  return provider === "gemini" && validQuestion && isBoundedNonEmptyString(model, MAX_WEB_SEARCH_MODEL_CHARACTERS) && isBoundedNonEmptyString(answer, MAX_WEB_SEARCH_ANSWER_CHARACTERS) && Array.isArray(sources) && sources.length > 0 && sources.length <= MAX_WEB_SEARCH_SOURCES && sources.every((source) => {
    if (!source || typeof source !== "object") return false;
    const { title, url } = source as Record<string, unknown>;
    if (!isBoundedNonEmptyString(title, MAX_WEB_SEARCH_SOURCE_TITLE_CHARACTERS) || !isBoundedNonEmptyString(url, MAX_WEB_SEARCH_SOURCE_URL_CHARACTERS)) return false;
    try { return new URL(url).protocol === "https:"; } catch { return false; }
  });
}

function isBoundedNonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isClarificationText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value.trim()).length <= MAX_CLARIFICATION_FIELD_CHARACTERS;
}

function isPendingClarification(value: unknown): value is PendingClarification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Record<string, unknown>;
  const keys = Object.keys(pending);
  if (keys.length !== 7 || !keys.every((key) => key === "goal" || key === "question" || key === "missing" || key === "requiresSummary" || key === "originUserTurnIndex" || key === "originAssistantTurnIndex" || key === "userRepliesSinceRequest")) return false;
  return isClarificationText(pending.goal) && isClarificationText(pending.question) && isClarificationText(pending.missing) &&
    typeof pending.requiresSummary === "boolean" &&
    typeof pending.originUserTurnIndex === "number" && Number.isInteger(pending.originUserTurnIndex) && pending.originUserTurnIndex >= 0 &&
    typeof pending.originAssistantTurnIndex === "number" && Number.isInteger(pending.originAssistantTurnIndex) && pending.originAssistantTurnIndex >= 0 &&
    typeof pending.userRepliesSinceRequest === "number" && Number.isInteger(pending.userRepliesSinceRequest) && pending.userRepliesSinceRequest >= 0 && pending.userRepliesSinceRequest <= 2;
}

function parseAssistantState(value: string, legacyQuestion?: string): Pick<AssistantConversationTurn, "sources" | "knowledgeBaseHit" | "webSearch" | "pendingClarification" | "citationWarning"> | null {
  const decoded = decodeText(value);
  if (decoded === null) return null;
  try {
    const state: unknown = JSON.parse(decoded);
    if (!state || typeof state !== "object") return null;
    const { sources, knowledgeBaseHit, webSearch, pendingClarification, citationWarning } = state as { sources?: unknown; knowledgeBaseHit?: unknown; webSearch?: unknown; pendingClarification?: unknown; citationWarning?: unknown };
    if (sources !== undefined && !Array.isArray(sources)) return null;
    if (knowledgeBaseHit !== undefined && typeof knowledgeBaseHit !== "boolean") return null;
    return { sources: sources as AssistantConversationTurn["sources"], knowledgeBaseHit, ...(isWebSearchResult(webSearch, legacyQuestion) ? { webSearch } : {}), ...(isPendingClarification(pendingClarification) ? { pendingClarification } : {}), ...(isBoundedNonEmptyString(citationWarning, MAX_CITATION_WARNING_CHARACTERS) ? { citationWarning } : {}) };
  } catch {
    return null;
  }
}

function parseTurns(markdown: string): ConversationTurn[] | null {
  const bodyStart = markdown.indexOf("\n---\n") + 5;
  if (bodyStart < 5) return null;
  const body = markdown.slice(bodyStart);
  const sections = /^## (User|Assistant)\n\n<!-- wiki-copilot-content:([A-Za-z0-9+/]*={0,2}) -->(?:\n<!-- wiki-copilot-state:([A-Za-z0-9+/]*={0,2}) -->)?\n?/gmu;
  const turns: ConversationTurn[] = [];
  let cursor = 0;
  for (const section of body.matchAll(sections)) {
    if (body.slice(cursor, section.index).replace(/\n/gu, "") !== "") return null;
    const content = decodeText(section[2]!);
    if (content === null) return null;
    const role: ConversationRole = section[1] === "User" ? "user" : "assistant";
    if (role === "assistant" && section[3]) {
      const previousTurn = turns.at(-1);
      const state = parseAssistantState(section[3], previousTurn?.role === "user" ? previousTurn.content : undefined);
      if (!state) return null;
      turns.push({ role, content, ...state });
    } else {
      turns.push({ role, content });
    }
    cursor = section.index + section[0].length;
  }
  return turns.length > 0 && body.slice(cursor).trim() === "" ? turns : null;
}

export function serializeConversation(conversation: Conversation): string {
  const frontmatter = [
    "---",
    `type: ${frontmatterValue(CONVERSATION_TYPE)}`,
    `id: ${frontmatterValue(conversation.id)}`,
    `createdAt: ${frontmatterValue(conversation.createdAt)}`,
    `updatedAt: ${frontmatterValue(conversation.updatedAt)}`,
    `title: ${frontmatterValue(conversation.title)}`,
    "---"
  ];
  const turns = conversation.turns.map((turn) => {
    const state = assistantState(turn);
    return `## ${turn.role === "user" ? "User" : "Assistant"}\n\n` +
      `<!-- wiki-copilot-content:${encodeText(turn.content)} -->` +
      (state ? `\n<!-- wiki-copilot-state:${state} -->` : "");
  });
  return [frontmatter.join("\n"), ...turns].join("\n\n") + "\n";
}

export function parseConversation(markdown: string): Conversation | null {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  const frontmatter = readFrontmatter(normalized);
  if (!frontmatter || frontmatter.type !== CONVERSATION_TYPE || !frontmatter.id || !frontmatter.createdAt || !frontmatter.updatedAt || !frontmatter.title) return null;
  const turns = parseTurns(normalized);
  if (!turns) return null;
  return { id: frontmatter.id, createdAt: frontmatter.createdAt, updatedAt: frontmatter.updatedAt, title: frontmatter.title, turns };
}

function timestampForFileName(timestamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(timestamp);
  return match ? `${match[1]}-${match[2]}${match[3]}${match[4]}` : "conversation";
}

function safeTitle(title: string): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^-|-$)/gu, "").slice(0, 60);
  return slug || "conversation";
}

function identifierHash(identifier: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(identifier)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function conversationFileName(conversation: Conversation): string {
  return `${timestampForFileName(conversation.createdAt)}-${safeTitle(conversation.title)}-id-${identifierHash(conversation.id)}.md`;
}
