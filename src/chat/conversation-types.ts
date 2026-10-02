export type ConversationRole = "user" | "assistant";

import type { SourceReference } from "../core/types";

export interface UserConversationTurn {
  role: "user";
  content: string;
}

export interface AssistantConversationTurn {
  role: "assistant";
  content: string;
  sources?: SourceReference[];
  knowledgeBaseHit?: boolean;
}

export type ConversationTurn = UserConversationTurn | AssistantConversationTurn;

export function assistantRenderState(turn: AssistantConversationTurn): {
  sources: SourceReference[];
  knowledgeBaseHit: boolean;
} {
  return {
    sources: turn.sources ?? [],
    knowledgeBaseHit: turn.knowledgeBaseHit ?? true
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
