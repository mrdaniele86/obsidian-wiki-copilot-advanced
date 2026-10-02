export type ConversationRole = "user" | "assistant";

export interface ConversationTurn {
  role: ConversationRole;
  content: string;
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
