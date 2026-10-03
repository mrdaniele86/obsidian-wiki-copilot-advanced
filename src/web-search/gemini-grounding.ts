import type { WebSearchHistoryTurn, WebSearchResult, WebSource } from "./types";

export interface WebSearchRequest {
  question: string;
  model: string;
  apiKey: string;
  history?: WebSearchHistoryTurn[];
  signal?: AbortSignal;
}

export type WebSearchErrorCode =
  | "invalid-key"
  | "quota"
  | "invalid-model"
  | "network"
  | "timeout"
  | "cancelled"
  | "malformed-response"
  | "no-answer"
  | "no-sources"
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

interface TimerHost {
  setTimeout(handler: () => void, timeout?: number): unknown;
  clearTimeout(id: unknown): void;
}

const MAX_SOURCES = 12;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function candidateFrom(value: unknown): JsonRecord {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !isRecord(value.candidates[0])) {
    throw new WebSearchError("malformed-response");
  }
  return value.candidates[0];
}

function answerFrom(candidate: JsonRecord): string {
  if (!isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    throw new WebSearchError("malformed-response");
  }
  const text = candidate.content.parts.map((part) => {
    if (!isRecord(part)) throw new WebSearchError("malformed-response");
    return typeof part.text === "string" ? part.text : "";
  }).join("").trim();
  if (!text) throw new WebSearchError("no-answer");
  return text;
}

function sourcesFrom(candidate: JsonRecord): WebSource[] {
  if (candidate.groundingMetadata === undefined) return [];
  if (!isRecord(candidate.groundingMetadata)) throw new WebSearchError("malformed-response");
  const chunks = candidate.groundingMetadata.groundingChunks;
  if (!Array.isArray(chunks)) throw new WebSearchError("malformed-response");

  const sources: WebSource[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!isRecord(chunk)) throw new WebSearchError("malformed-response");
    if (chunk.web === undefined) continue;
    if (!isRecord(chunk.web)) throw new WebSearchError("malformed-response");
    const uri = chunk.web.uri;
    if (typeof uri !== "string" || seen.has(uri)) continue;
    try {
      if (new URL(uri).protocol !== "https:") continue;
    } catch {
      continue;
    }
    const title = typeof chunk.web.title === "string" ? chunk.web.title.trim() : "";
    seen.add(uri);
    sources.push({ title: title || uri, url: uri });
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

export class GeminiGroundingClient {
  constructor(
    private readonly fetcher: GeminiFetch = window.fetch.bind(window),
    private readonly timeoutMilliseconds = 30_000,
    private readonly timerHost: TimerHost = window
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const apiKey = request.apiKey.trim();
    if (!apiKey) throw new WebSearchError("invalid-key");
    if (request.signal?.aborted) throw new WebSearchError("cancelled");

    const controller = new AbortController();
    let abortCause: "cancelled" | "timeout" | null = null;
    const cancelForCaller = (): void => {
      abortCause ??= "cancelled";
      controller.abort();
    };
    request.signal?.addEventListener("abort", cancelForCaller, { once: true });
    const timeout = this.timerHost.setTimeout(() => {
      abortCause ??= "timeout";
      controller.abort();
    }, this.timeoutMilliseconds);
    let response: Response;
    try {
      response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: request.history?.length
              ? [
                ...request.history.map((turn) => ({
                  role: turn.role === "assistant" ? "model" : "user",
                  parts: [{ text: turn.content }]
                })),
                { role: "user", parts: [{ text: request.question }] }
              ]
              : [{ parts: [{ text: request.question }] }],
            tools: [{ google_search: {} }]
          })
        }
      );
    } catch {
      throw new WebSearchError(abortCause ?? (controller.signal.aborted ? "timeout" : "network"));
    } finally {
      this.timerHost.clearTimeout(timeout);
      request.signal?.removeEventListener("abort", cancelForCaller);
    }

    if (abortCause === "cancelled") throw new WebSearchError("cancelled");

    if (response.status === 401 || response.status === 403) throw new WebSearchError("invalid-key");
    if (response.status === 429) throw new WebSearchError("quota");
    if (response.status === 400 || response.status === 404) throw new WebSearchError("invalid-model");
    if (!response.ok) throw new WebSearchError("network");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WebSearchError("malformed-response");
    }
    if (abortCause === "cancelled" || request.signal?.aborted) throw new WebSearchError("cancelled");
    const candidate = candidateFrom(payload);
    const answer = answerFrom(candidate);
    const sources = sourcesFrom(candidate);
    if (!sources.length) throw new WebSearchError("no-sources");

    return {
      provider: "gemini",
      question: request.question,
      model: request.model,
      answer,
      sources
    };
  }
}
