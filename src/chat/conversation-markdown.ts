import type { Conversation, ConversationRole, ConversationTurn } from "./conversation-types";

const CONVERSATION_TYPE = "wiki-copilot-conversation";

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

function parseTurns(markdown: string): ConversationTurn[] | null {
  const bodyStart = markdown.indexOf("\n---\n") + 5;
  if (bodyStart < 5) return null;
  const body = markdown.slice(bodyStart);
  const sections = /^## (User|Assistant)\n\n<!-- wiki-copilot-content:([A-Za-z0-9+/]*={0,2}) -->\n?/gmu;
  const turns: ConversationTurn[] = [];
  let cursor = 0;
  for (const section of body.matchAll(sections)) {
    if (body.slice(cursor, section.index).replace(/\n/gu, "") !== "") return null;
    const content = decodeText(section[2]!);
    if (content === null) return null;
    const role: ConversationRole = section[1] === "User" ? "user" : "assistant";
    turns.push({ role, content });
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
  const turns = conversation.turns.map((turn) => [
    `## ${turn.role === "user" ? "User" : "Assistant"}`,
    `<!-- wiki-copilot-content:${encodeText(turn.content)} -->`
  ].join("\n\n"));
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
