export type ConversationRole = "user" | "assistant";

import type { SourceReference } from "../core/types";
import type { WebSearchResult } from "../web-search/types";
import type { PendingClarification } from "./pending-clarification";

export interface UserConversationTurn {
  role: "user";
  content: string;
}

export interface AssistantConversationTurn {
  role: "assistant";
  content: string;
  sources?: SourceReference[];
  knowledgeBaseHit?: boolean;
  webSearch?: WebSearchResult;
  pendingClarification?: PendingClarification;
}

export type ConversationTurn = UserConversationTurn | AssistantConversationTurn;

export function assistantRenderState(turn: AssistantConversationTurn): {
  sources: SourceReference[];
  knowledgeBaseHit: boolean;
  webSearch?: WebSearchResult;
  pendingClarification?: PendingClarification;
} {
  return {
    sources: turn.sources ?? [],
    knowledgeBaseHit: turn.knowledgeBaseHit ?? true,
    webSearch: turn.webSearch,
    pendingClarification: turn.pendingClarification
  };
}

export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  turns: ConversationTurn[];
}

export interface StoredConversation {
  path: string;
  conversation: Conversation;
}
