export type WebSearchMode = "disabled" | "current-provider" | "dedicated-gemini";

export interface WebSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  provider: "gemini";
  model: string;
  answer: string;
  sources: WebSource[];
}

export interface WebSearchSettings {
  mode: WebSearchMode;
  geminiModel: string;
}
