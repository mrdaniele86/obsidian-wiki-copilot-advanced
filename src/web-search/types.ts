export type WebSearchMode = "disabled" | "current-provider" | "dedicated-gemini";

export interface WebSearchSettings {
  mode: WebSearchMode;
  geminiModel: string;
}
