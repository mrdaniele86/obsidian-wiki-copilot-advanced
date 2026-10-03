import {
  GeminiGroundingClient,
  WebSearchError,
  type WebSearchRequest
} from "./gemini-grounding";
import type { WebSearchResult, WebSearchSettings } from "./types";

export interface WebSearchCapability {
  available: boolean;
  reason?: "disabled" | "missing-api-key" | "unsupported-current-provider";
}

interface GroundingClient {
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}

export interface WebSearchServiceOptions {
  settings: WebSearchSettings;
  apiKey: string;
  client?: GroundingClient;
}

export class WebSearchService {
  constructor(private readonly options: WebSearchServiceOptions) {}

  capability(): WebSearchCapability {
    if (this.options.settings.mode === "disabled") {
      return { available: false, reason: "disabled" };
    }
    if (this.options.settings.mode === "current-provider") {
      return { available: false, reason: "unsupported-current-provider" };
    }
    return this.options.apiKey.trim()
      ? { available: true }
      : { available: false, reason: "missing-api-key" };
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const capability = this.capability();
    if (!capability.available) throw new WebSearchError(capability.reason ?? "network");

    const client = this.options.client ?? new GeminiGroundingClient();
    return client.search({
      question: request.question,
      model: this.options.settings.geminiModel,
      apiKey: this.options.apiKey.trim(),
      ...(request.history?.length ? { history: request.history } : {})
    });
  }
}
