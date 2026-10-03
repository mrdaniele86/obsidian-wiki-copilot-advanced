import type { WebSearchResult, WebSource } from "./types";

export interface WebSearchRequest {
  question: string;
  model: string;
  apiKey: string;
}

export type WebSearchErrorCode =
  | "invalid-key"
  | "quota"
  | "network"
  | "malformed-response"
  | "no-answer"
  | "disabled"
  | "unsupported-current-provider"
  | "missing-api-key";

export class WebSearchError extends Error {
  constructor(readonly code: WebSearchErrorCode) {
    super(code);
    this.name = "WebSearchError";
  }
}

export type GeminiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface GeminiWebChunk {
  web?: { uri?: unknown; title?: unknown };
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: unknown }> };
  groundingMetadata?: { groundingChunks?: GeminiWebChunk[] };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

const MAX_SOURCES = 12;

function asGeminiResponse(value: unknown): GeminiResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function answerFrom(candidate: GeminiCandidate | undefined): string {
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
}

function sourcesFrom(candidate: GeminiCandidate | undefined): WebSource[] {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const sources: WebSource[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (typeof uri !== "string" || seen.has(uri)) continue;
    try {
      if (new URL(uri).protocol !== "https:") continue;
    } catch {
      continue;
    }
    const title = typeof chunk.web?.title === "string" ? chunk.web.title.trim() : "";
    seen.add(uri);
    sources.push({ title: title || uri, url: uri });
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

export class GeminiGroundingClient {
  constructor(private readonly fetcher: GeminiFetch = window.fetch.bind(window)) {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const apiKey = request.apiKey.trim();
    if (!apiKey) throw new WebSearchError("invalid-key");

    let response: Response;
    try {
      response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: request.question }] }],
            tools: [{ google_search: {} }]
          })
        }
      );
    } catch {
      throw new WebSearchError("network");
    }

    if (response.status === 401 || response.status === 403) throw new WebSearchError("invalid-key");
    if (response.status === 429) throw new WebSearchError("quota");
    if (!response.ok) throw new WebSearchError("network");

    let payload: GeminiResponse | null;
    try {
      payload = asGeminiResponse(await response.json());
    } catch {
      throw new WebSearchError("malformed-response");
    }
    if (!payload || !Array.isArray(payload.candidates)) {
      throw new WebSearchError("malformed-response");
    }

    const candidate = payload.candidates[0];
    const answer = answerFrom(candidate);
    if (!answer) throw new WebSearchError("no-answer");

    return {
      provider: "gemini",
      model: request.model,
      answer,
      sources: sourcesFrom(candidate)
    };
  }
}
