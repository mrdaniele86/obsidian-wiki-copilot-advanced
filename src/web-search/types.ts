/**
 * `current-provider` is retained only to reject direct legacy runtime input.
 * Persisted settings are normalized to `disabled` during loading.
 */
export type WebSearchMode = "disabled" | "current-provider" | "dedicated-gemini";

export interface WebSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  provider: "gemini";
  /** Present on newly saved results; absent on conversations created before question persistence. */
  question?: string;
  model: string;
  answer: string;
  sources: WebSource[];
}

export interface WebSearchSettings {
  mode: WebSearchMode;
  geminiModel: string;
  includeRecentChatContext?: boolean;
}

export interface WebSearchHistoryTurn {
  role: "user" | "assistant";
  content: string;
}
