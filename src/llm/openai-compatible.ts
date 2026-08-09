import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { BuiltContext } from "../core/context-builder";
import { providerRequiresApiKey } from "../model-presets";
import type { ModelSettings } from "../settings";
import {
  ChatCompletionStreamError,
  ChatCompletionStreamInterruptedError,
  readChatCompletionStream
} from "./chat-completion-stream";
import { completionRequestOptions } from "./completion-request";
import { buildSystemPrompt } from "./prompt";
import { RequestCancelledError, RequestTimeoutError } from "./request-timeout";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export type ActiveCompletionMode = "stream" | "non-stream";
export type ModelResponseMode = "auto" | "stream" | "non-stream";
export type CompletionActivity = "response-headers" | "stream-data";

export interface CompletionAnswerOptions {
  signal?: AbortSignal;
  responseMode?: ModelResponseMode;
  onDelta?: (delta: string) => void;
  onResponseMode?: (mode: ActiveCompletionMode, detail?: string) => void;
  onActivity?: (activity: CompletionActivity) => void;
}

export class StreamFallbackRequiredError extends Error {
  override readonly name = "StreamFallbackRequiredError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

class SafeNonStreamingFallbackError extends Error {
  override readonly name = "SafeNonStreamingFallbackError";
}

class ModelRequestError extends Error {
  override readonly name = "ModelRequestError";
}

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RequestUrlFunction = (request: RequestUrlParam | string) => Promise<RequestUrlResponse>;

interface TimerHost {
  setTimeout(handler: TimerHandler, timeout?: number): number;
  clearTimeout(id: number | undefined): void;
}

export interface OpenAICompatibleClientDependencies {
  fetcher?: FetchFunction | null;
  requester?: RequestUrlFunction;
  timerHost?: TimerHost;
}

interface PreparedCompletionRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function currentWindow(): Window {
  return window.activeWindow ?? window;
}

function completionUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/u, "");
  const url = new URL(trimmed);
  if (!/^https?:$/u.test(url.protocol)) {
    throw new Error("模型 endpoint 必须使用 http 或 https。 ");
  }
  if (!/\/chat\/completions$/u.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/chat/completions`;
  }
  return url.toString();
}

function responseText(content: ChatCompletionResponse["choices"]): string {
  const value = content?.[0]?.message?.content;
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((part) => part.text ?? "").join("\n").trim();
  }
  return "";
}

function parseJsonResponse(text: string): ChatCompletionResponse {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return {};
  }
}

function responseErrorDetail(text: string, status: number): string {
  const body = parseJsonResponse(text);
  return body.error?.message?.trim() || text.slice(0, 500).trim() || `HTTP ${status}`;
}

function historyForModel(history: ChatTurn[]): ChatTurn[] {
  return history.slice(-6).map((turn) => ({
    ...turn,
    content: turn.content.replace(/\[S\d+\]/gu, "[prior source]")
  }));
}

function streamUnsupported(status: number, detail: string): boolean {
  if (![400, 404, 405, 406, 415, 422, 501].includes(status)) {
    return false;
  }
  return /stream|server[- ]sent|event[- ]stream|sse|unsupported|not supported|不支持/iu.test(detail);
}

function finishWarning(text: string, finishReason: string | null): string {
  if (finishReason === "length") {
    return `${text}\n\n> [!warning] 回答达到模型长度上限，内容可能不完整。`;
  }
  if (finishReason === "content_filter") {
    return `${text}\n\n> [!warning] 回答受到模型内容过滤，内容可能不完整。`;
  }
  if (finishReason === "insufficient_system_resource") {
    throw new ChatCompletionStreamInterruptedError("模型因服务资源不足中断了回答。", text);
  }
  return text;
}

function waitForNonStreamingResponse<T>(
  request: Promise<T>,
  timeoutMilliseconds: number,
  signal: AbortSignal | undefined,
  timerHost: TimerHost
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      timerHost.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", cancel);
      callback();
    };
    const cancel = (): void => finish(() => reject(new RequestCancelledError()));
    const timeoutId = timerHost.setTimeout(
      () => finish(() => reject(new RequestTimeoutError(timeoutMilliseconds, "模型回答超时。 "))),
      timeoutMilliseconds
    );

    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    request.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(
        error instanceof Error ? error : new Error(String(error))
      ))
    );
  });
}

export class OpenAICompatibleClient {
  constructor(
    private readonly getApiKey: () => string | null,
    private readonly dependencies: OpenAICompatibleClientDependencies = {}
  ) {}

  isConfigured(settings: ModelSettings): boolean {
    return Boolean(
      settings.endpoint.trim() &&
      settings.model.trim() &&
      (settings.provider !== "custom" || settings.serviceName.trim())
    );
  }

  async answer(
    question: string,
    builtContext: BuiltContext,
    history: ChatTurn[],
    schemaGuidance: string,
    settings: ModelSettings,
    timeoutMilliseconds: number,
    options: CompletionAnswerOptions = {}
  ): Promise<string> {
    const request = this.prepareRequest(question, builtContext, history, schemaGuidance, settings);
    const responseMode = options.responseMode ?? "auto";
    if (responseMode === "non-stream") {
      options.onResponseMode?.("non-stream");
      return this.answerNonStreaming(request, timeoutMilliseconds, options.signal, options.onActivity);
    }

    const fetcher = this.streamingFetch();
    if (!fetcher) {
      if (responseMode === "auto") {
        options.onResponseMode?.("non-stream", "当前环境不支持响应流，已使用兼容模式。");
        return this.answerNonStreaming(request, timeoutMilliseconds, options.signal, options.onActivity);
      }
      throw new StreamFallbackRequiredError("当前 Obsidian 环境不支持流式读取，请使用非流式兼容模式。");
    }

    options.onResponseMode?.("stream");
    try {
      return await this.answerStreaming(request, fetcher, timeoutMilliseconds, options);
    } catch (error) {
      if (error instanceof SafeNonStreamingFallbackError && responseMode === "auto") {
        options.onResponseMode?.("non-stream", `${error.message}已使用兼容模式。`);
        return this.answerNonStreaming(request, timeoutMilliseconds, options.signal, options.onActivity);
      }
      throw error;
    }
  }

  private prepareRequest(
    question: string,
    builtContext: BuiltContext,
    history: ChatTurn[],
    schemaGuidance: string,
    settings: ModelSettings
  ): PreparedCompletionRequest {
    if (!this.isConfigured(settings)) {
      throw new Error(settings.provider === "custom" && !settings.serviceName.trim()
        ? "请先在 Wiki Copilot 设置中填写服务名称。"
        : "请先在 Wiki Copilot 设置中填写模型 endpoint 和模型名称。 ");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = this.getApiKey()?.trim() ?? "";
    if (providerRequiresApiKey(settings.provider) && !apiKey) {
      throw new Error("请先在 Wiki Copilot 设置中填写 API Key。");
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const messages = [
      { role: "system", content: buildSystemPrompt(schemaGuidance, builtContext.sources.length > 0) },
      ...historyForModel(history),
      {
        role: "user",
        content: [
          `Question:\n${question}`,
          "Evidence for this turn:",
          builtContext.context || "(No evidence was retrieved.)"
        ].filter((part): part is string => Boolean(part)).join("\n\n")
      }
    ];

    return {
      url: completionUrl(settings.endpoint),
      headers,
      body: {
        model: settings.model,
        messages,
        ...completionRequestOptions(settings)
      }
    };
  }

  private async answerNonStreaming(
    request: PreparedCompletionRequest,
    timeoutMilliseconds: number,
    signal?: AbortSignal,
    onActivity?: (activity: CompletionActivity) => void
  ): Promise<string> {
    if (signal?.aborted) {
      throw new RequestCancelledError();
    }
    const requester = this.dependencies.requester ?? requestUrl;
    const timerHost = this.dependencies.timerHost ?? currentWindow();
    const responsePromise = requester({
      url: request.url,
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ ...request.body, stream: false }),
      throw: false
    });
    const response = await waitForNonStreamingResponse(
      responsePromise,
      timeoutMilliseconds,
      signal,
      timerHost
    );
    onActivity?.("response-headers");
    let body: ChatCompletionResponse;
    try {
      body = response.json as ChatCompletionResponse;
    } catch {
      body = {};
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = body.error?.message || response.text.slice(0, 500) || `HTTP ${response.status}`;
      throw new ModelRequestError(`模型请求失败：${detail}`);
    }
    const text = responseText(body.choices);
    if (!text) {
      throw new ModelRequestError("模型返回了空回答。 ");
    }
    return text;
  }

  private async answerStreaming(
    request: PreparedCompletionRequest,
    fetcher: FetchFunction,
    timeoutMilliseconds: number,
    options: CompletionAnswerOptions
  ): Promise<string> {
    if (options.signal?.aborted) {
      throw new RequestCancelledError();
    }

    const controller = new AbortController();
    const timerHost = this.dependencies.timerHost ?? currentWindow();
    let timedOut = false;
    let receivedText = false;
    const cancel = (): void => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeoutId = timerHost.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMilliseconds);

    try {
      const response = await fetcher(request.url, {
        method: "POST",
        headers: { ...request.headers, Accept: "text/event-stream" },
        body: JSON.stringify({ ...request.body, stream: true }),
        signal: controller.signal
      });
      options.onActivity?.("response-headers");
      const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
      if (!response.ok) {
        const responseBody = await response.text();
        const detail = responseErrorDetail(responseBody, response.status);
        if (streamUnsupported(response.status, detail)) {
          throw new SafeNonStreamingFallbackError("服务不支持流式响应，");
        }
        throw new ModelRequestError(`模型请求失败：${detail}`);
      }

      if (contentType.includes("application/json")) {
        const responseBody = await response.text();
        const body = parseJsonResponse(responseBody);
        const text = responseText(body.choices);
        if (!text) {
          throw new ModelRequestError(body.error?.message || "模型返回了空回答。 ");
        }
        options.onResponseMode?.("non-stream", "服务返回了完整响应。");
        options.onDelta?.(text);
        return text;
      }
      if (!response.body || typeof response.body.getReader !== "function") {
        throw new StreamFallbackRequiredError(
          "当前响应不支持流式读取，可使用非流式兼容模式重试。"
        );
      }

      let receivedStreamData = false;
      const result = await readChatCompletionStream(response.body, {
        signal: controller.signal,
        onActivity: () => {
          if (!receivedStreamData) {
            receivedStreamData = true;
            options.onActivity?.("stream-data");
          }
        },
        onDelta: (delta) => {
          receivedText = true;
          options.onDelta?.(delta);
        }
      });
      return finishWarning(result.text, result.finishReason);
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
      if (timedOut) {
        throw new RequestTimeoutError(timeoutMilliseconds, "模型回答超时。 ");
      }
      if (options.signal?.aborted) {
        throw new RequestCancelledError();
      }
      if (
        error instanceof SafeNonStreamingFallbackError ||
        error instanceof ModelRequestError ||
        error instanceof StreamFallbackRequiredError
      ) {
        throw error;
      }
      if (error instanceof ChatCompletionStreamInterruptedError && error.partialText) {
        throw error;
      }
      if (receivedText) {
        throw new ChatCompletionStreamInterruptedError(
          error instanceof Error ? error.message : "模型流式连接已中断。",
          "",
          { cause: error }
        );
      }
      const detail = error instanceof ChatCompletionStreamError
        ? error.message
        : "无法建立流式连接。";
      throw new StreamFallbackRequiredError(
        `${detail} 可使用非流式兼容模式重试。`,
        { cause: error }
      );
    } finally {
      timerHost.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  private streamingFetch(): FetchFunction | null {
    if (this.dependencies.fetcher !== undefined) {
      return this.dependencies.fetcher;
    }
    const requestWindow = currentWindow();
    return typeof requestWindow.fetch === "function" &&
      typeof ReadableStream === "function" &&
      typeof TextDecoder === "function"
      ? requestWindow.fetch.bind(requestWindow)
      : null;
  }
}
