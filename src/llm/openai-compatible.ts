import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { BuiltContext } from "../core/context-builder";
import type { ChatTurn } from "../core/types";
import {
  extractClarificationDirective,
  type ClarificationDirective
} from "../chat/pending-clarification";
import { providerRequiresApiKey } from "../model-presets";
import type { ModelSettings } from "../settings";
import {
  ChatCompletionStreamError,
  ChatCompletionStreamInterruptedError,
  readChatCompletionStream
} from "./chat-completion-stream";
import { completionRequestOptions, isGroqGptOssModel } from "./completion-request";
import { groqActionBudget, isGroqEndpoint, planPromptBudget } from "./prompt-budget";
import { buildSystemPrompt } from "./prompt";
import { RequestCancelledError, RequestTimeoutError } from "./request-timeout";
import { parseRetrievalQueries } from "../core/retrieval-plan";
import type { RetrievalPlanningMode } from "../core/retrieval-plan";

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
export type ModelResponseDetail = "streaming-unavailable" | "streaming-unsupported" | "complete-response";
export type StreamFallbackReason = "streaming-unavailable" | "response-not-streamable" | "stream-connection-failed";
export type ModelRequestErrorCode = "request-failed" | "input-too-large" | "rate-limited" | "empty-response" | "reasoning-exhausted";
export type ModelConfigurationErrorCode = "invalid-endpoint" | "missing-service-name" | "missing-endpoint-or-model" | "missing-api-key";
export type ModelCompletionWarning = "length" | "content-filter";
export type ModelStreamInterruptionReason = "insufficient-system-resource" | "stream-interrupted";

export interface CompletionAnswerOptions {
  signal?: AbortSignal;
  responseMode?: ModelResponseMode;
  onDelta?: (delta: string) => void;
  onResponseMode?: (mode: ActiveCompletionMode, detail?: ModelResponseDetail) => void;
  onActivity?: (activity: CompletionActivity) => void;
  onWarning?: (warning: ModelCompletionWarning) => void;
  onClarification?: (clarification: ClarificationDirective) => void;
  reducedContext?: boolean;
  onPromptBudget?: (budget: { usedTokens: number; limitTokens: number; plannerReservationTokens?: number; outputTokens?: number; totalTpm?: number }) => void;
}

export interface RetrievalPlanningOptions {
  signal?: AbortSignal;
  mode?: RetrievalPlanningMode;
  history?: readonly ChatTurn[];
  question?: string;
}

export class StreamFallbackRequiredError extends Error {
  override readonly name = "StreamFallbackRequiredError";

  constructor(readonly reason: StreamFallbackReason, options?: ErrorOptions) {
    super(reason, options);
  }
}

class SafeNonStreamingFallbackError extends Error {
  override readonly name = "SafeNonStreamingFallbackError";

  constructor(readonly reason: Extract<ModelResponseDetail, "streaming-unsupported">) {
    super(reason);
  }
}

export class ModelRequestError extends Error {
  override readonly name = "ModelRequestError";

  constructor(readonly code: ModelRequestErrorCode, readonly detail?: string) {
    super(code);
  }
}

export class ModelConfigurationError extends Error {
  override readonly name = "ModelConfigurationError";

  constructor(readonly code: ModelConfigurationErrorCode) {
    super(code);
  }
}

export class ModelStreamInterruptedError extends ChatCompletionStreamInterruptedError {
  constructor(
    readonly reason: ModelStreamInterruptionReason,
    partialText: string,
    options?: ErrorOptions
  ) {
    super(reason, partialText, options);
  }
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
  isGroqGptOss: boolean;
  promptBudget?: { usedTokens: number; limitTokens: number; plannerReservationTokens?: number; outputTokens?: number; totalTpm?: number };
}

const ANSWER_HISTORY_MAX_TURNS = 10;
const ANSWER_HISTORY_MAX_CHARACTERS = 24_000;
const PLANNER_HISTORY_MAX_TURNS = 4;
const PLANNER_HISTORY_MAX_CHARACTERS = 8_000;
const CLARIFICATION_DIRECTIVE_PREFIX = "<!-- wiki-copilot-clarification ";
const CLARIFICATION_DIRECTIVE_INSTRUCTION = `When essential information is missing, ask one clear question and append exactly one final hidden HTML comment in this exact shape: <!-- wiki-copilot-clarification {"goal":"...","question":"...","missing":"...","requiresSummary":true} -->. Use it only when a clarification is required; otherwise append no such comment.`;

function directivePrefixSuffixLength(text: string): number {
  const maximum = Math.min(text.length, CLARIFICATION_DIRECTIVE_PREFIX.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (text.endsWith(CLARIFICATION_DIRECTIVE_PREFIX.slice(0, length))) return length;
  }
  return 0;
}

function retrievalPlannerPrompt(mode: RetrievalPlanningMode): string {
  const queryCount = mode === "fast" ? "3 to 6" : "4 to 10";
  return `You plan lexical searches for a local Markdown knowledge base.

Return JSON only in this shape: {"queries":["..."]}.

Rules:
- Do not answer the question and do not add explanations.
- Use recent conversation messages, when provided, to resolve omitted subjects, references, active scope, and follow-up constraints. The latest user query overrides any scope it explicitly replaces.
- Produce ${queryCount} short keyword queries when the question supports useful variants. The caller also searches the original question.
- Supply the discriminating lexical terms needed to search Markdown bodies, including terminology variants, full names and abbreviations, and Chinese/English translations when useful.
- Preserve every explicit name, identifier, version, number, quoted label, acronym, scope, and list/all intent. Never replace it with a merely similar entity.
- Do not invent domain facts, product names, document numbers, or a narrower scope.
- Each query must be independently useful for literal full-text search, must retain the explicit entity or scope, and should contain only discriminating terms.`;
}

function currentWindow(): Window {
  return window.activeWindow ?? window;
}

function completionUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/u, "");
  const url = new URL(trimmed);
  if (!/^https?:$/u.test(url.protocol)) {
    throw new ModelConfigurationError("invalid-endpoint");
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

function requestErrorCode(status: number, detail: string): ModelRequestErrorCode {
  if (status === 413) return "input-too-large";
  const sizeSignal = /\b(?:tpm|tokens? per minute|requested\s+\d+.*limit|context length|too many tokens?)\b/iu.test(detail);
  if ((status === 400 || status === 429) && sizeSignal) return "input-too-large";
  if (status === 429) return "rate-limited";
  return "request-failed";
}

function historyForModel(
  history: readonly ChatTurn[],
  maxTurns: number,
  maxCharacters: number
): ChatTurn[] {
  const selected: ChatTurn[] = [];
  let remainingCharacters = maxCharacters;
  for (let index = history.length - 1; index >= 0 && selected.length < maxTurns; index -= 1) {
    const turn = history[index];
    if (!turn || remainingCharacters <= 0) {
      continue;
    }
    const cleaned = turn.content.replace(/\[S\d+\]/gu, "[prior source]").trim();
    if (!cleaned) {
      continue;
    }
    const content = cleaned.slice(0, remainingCharacters);
    selected.unshift({ role: turn.role, content });
    remainingCharacters -= content.length;
  }
  return selected;
}

function streamUnsupported(status: number, detail: string): boolean {
  if (![400, 404, 405, 406, 415, 422, 501].includes(status)) {
    return false;
  }
  return /stream|server[- ]sent|event[- ]stream|sse|unsupported|not supported|不支持/iu.test(detail);
}

function finishWarning(
  text: string,
  finishReason: string | null,
  onWarning?: (warning: ModelCompletionWarning) => void
): string {
  if (finishReason === "length") {
    onWarning?.("length");
    return text;
  }
  if (finishReason === "content_filter") {
    onWarning?.("content-filter");
    return text;
  }
  if (finishReason === "insufficient_system_resource") {
    throw new ModelStreamInterruptedError("insufficient-system-resource", text);
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
    const request = this.prepareRequest(question, builtContext, history, schemaGuidance, settings, options.reducedContext === true);
    if (request.promptBudget) options.onPromptBudget?.(request.promptBudget);
    const responseMode = options.responseMode ?? "auto";
    if (responseMode === "non-stream") {
      options.onResponseMode?.("non-stream");
      return this.completeAnswer(await this.answerNonStreaming(request, timeoutMilliseconds, options.signal, options.onActivity), options);
    }

    const fetcher = this.streamingFetch();
    if (!fetcher) {
      if (responseMode === "auto") {
        options.onResponseMode?.("non-stream", "streaming-unavailable");
        return this.completeAnswer(await this.answerNonStreaming(request, timeoutMilliseconds, options.signal, options.onActivity), options);
      }
      throw new StreamFallbackRequiredError("streaming-unavailable");
    }

    options.onResponseMode?.("stream");
    try {
      return this.completeAnswer(await this.answerStreaming(request, fetcher, timeoutMilliseconds, options), options);
    } catch (error) {
      if (error instanceof SafeNonStreamingFallbackError && responseMode === "auto") {
        options.onResponseMode?.("non-stream", error.reason);
        return this.completeAnswer(await this.answerNonStreaming(request, timeoutMilliseconds, options.signal, options.onActivity), options);
      }
      throw error;
    }
  }

  private completeAnswer(markdown: string, options: CompletionAnswerOptions): string {
    const parsed = extractClarificationDirective(markdown);
    if (parsed.clarification) {
      options.onClarification?.(parsed.clarification);
    }
    return parsed.markdown;
  }

  async planRetrievalQueries(
    query: string,
    settings: ModelSettings,
    timeoutMilliseconds: number,
    options: RetrievalPlanningOptions = {}
  ): Promise<string[]> {
    const mode = options.mode ?? "precise";
    const history = options.history ?? [];
    const request = this.prepareRetrievalPlannerRequest(
      options.question?.trim() || query,
      settings,
      mode,
      history
    );
    if (!request) return [query];
    const response = await this.answerNonStreaming(
      request,
      timeoutMilliseconds,
      options.signal
    );
    return parseRetrievalQueries(query, response, mode);
  }

  private prepareRequest(
    question: string,
    builtContext: BuiltContext,
    history: readonly ChatTurn[],
    schemaGuidance: string,
    settings: ModelSettings,
    reducedContext: boolean
  ): PreparedCompletionRequest {
    const headers = this.requestHeaders(settings);

    const groq = isGroqEndpoint(settings.endpoint);
    const groqGptOss = isGroqGptOssModel(settings);
    const inputLimit = typeof settings.maximumInputTokens === "number"
      ? settings.maximumInputTokens
      : groq ? 7_000 : undefined;
    const outputLimit = typeof settings.maximumOutputTokens === "number"
      ? settings.maximumOutputTokens
      : 512;
    const actionBudget = groq
      ? groqActionBudget(inputLimit, outputLimit, settings.groqTotalTokensPerMinute)
      : undefined;
    const configuredLimit = actionBudget?.answerInputTokens ?? inputLimit;
    if (groq && configuredLimit !== undefined && configuredLimit <= 0) {
      throw new ModelRequestError("input-too-large");
    }
    const requestedLimit = reducedContext ? Math.min(configuredLimit ?? 2_000, 2_000) : configuredLimit;
    if (requestedLimit === undefined) {
      return {
        url: completionUrl(settings.endpoint),
        headers,
        isGroqGptOss: groqGptOss,
        body: {
          model: settings.model,
          messages: [
            { role: "system", content: `${buildSystemPrompt(schemaGuidance, builtContext.sources.length > 0)}\n\n${CLARIFICATION_DIRECTIVE_INSTRUCTION}` },
            ...historyForModel(history, ANSWER_HISTORY_MAX_TURNS, ANSWER_HISTORY_MAX_CHARACTERS),
            { role: "user", content: [`Question:\n${question}`, "Evidence for this turn:", builtContext.context || "(No evidence was retrieved.)"].join("\n\n") }
          ],
          ...completionRequestOptions(settings, actionBudget?.answerOutputTokens)
        }
      };
    }
    const evidence = builtContext.context.match(/<wiki-copilot-source\b[\s\S]*?<\/wiki-copilot-source>/giu)
      ?? (builtContext.context ? [builtContext.context] : ["(No evidence was retrieved.)"]);
    const plan = planPromptBudget({
      systemPrompt: `${buildSystemPrompt(schemaGuidance, builtContext.sources.length > 0)}\n\n${CLARIFICATION_DIRECTIVE_INSTRUCTION}`,
      question,
      history: reducedContext ? [] : historyForModel(history, ANSWER_HISTORY_MAX_TURNS, ANSWER_HISTORY_MAX_CHARACTERS),
      evidence,
      limitTokens: requestedLimit,
      budgetAlreadySafe: groq
    });
    if (plan.overBudget) {
      throw new ModelRequestError("input-too-large");
    }
    const system = plan.messages[0]!;
    const plannedEvidence = plan.messages.slice(1).filter((message) =>
      message.content.startsWith("<wiki-copilot-source") || message.content === "(No evidence was retrieved.)" || evidence.includes(message.content)
    );
    const plannedHistory = plan.messages.slice(1).filter((message) => !plannedEvidence.includes(message) && message.content !== `Question:\n${question}`);
    const user = plan.messages.find((message) => message.content === `Question:\n${question}`)!;
    const messages = [
      system,
      ...plannedHistory,
      {
        role: "user" as const,
        content: [user.content, "Evidence for this turn:", ...plannedEvidence.map((message) => message.content)].join("\n\n")
      }
    ];

    return {
      url: completionUrl(settings.endpoint),
      headers,
      isGroqGptOss: groqGptOss,
      body: {
        model: settings.model,
        messages,
        ...completionRequestOptions(settings, actionBudget?.answerOutputTokens)
      },
      promptBudget: plan.limitTokens === undefined ? undefined : {
        usedTokens: plan.usedTokens,
        limitTokens: plan.limitTokens,
        ...(actionBudget ? {
          plannerReservationTokens: actionBudget.plannerInputTokens + actionBudget.plannerOutputTokens,
          outputTokens: actionBudget.answerOutputTokens,
          totalTpm: actionBudget.totalTpm
        } : {})
      }
    };
  }

  private prepareRetrievalPlannerRequest(
    query: string,
    settings: ModelSettings,
    mode: RetrievalPlanningMode,
    history: readonly ChatTurn[]
  ): PreparedCompletionRequest | null {
    const headers = this.requestHeaders(settings);
    const groq = isGroqEndpoint(settings.endpoint);
    const groqGptOss = isGroqGptOssModel(settings);
    const actionBudget = groq
      ? groqActionBudget(
        typeof settings.maximumInputTokens === "number" ? settings.maximumInputTokens : 7_000,
        typeof settings.maximumOutputTokens === "number" ? settings.maximumOutputTokens : undefined,
        settings.groqTotalTokensPerMinute
      )
      : undefined;
    const providerOptions = completionRequestOptions(settings, actionBudget?.plannerOutputTokens);
    if (actionBudget && actionBudget.plannerInputTokens <= 0) {
      return null;
    }
    const plannerSystem = retrievalPlannerPrompt(mode);
    const plannerQuestion = query.trim();
    const planned = actionBudget
      ? planPromptBudget({
        systemPrompt: plannerSystem,
        question: plannerQuestion,
        history: historyForModel(history, PLANNER_HISTORY_MAX_TURNS, PLANNER_HISTORY_MAX_CHARACTERS),
        limitTokens: actionBudget.plannerInputTokens,
        budgetAlreadySafe: true
      })
      : undefined;
    if (planned?.overBudget) {
      return null;
    }
    const messages = planned
      ? planned.messages.map((message) => message.content === `Question:\n${plannerQuestion}`
        ? { ...message, content: plannerQuestion }
        : message)
      : [
        { role: "system" as const, content: plannerSystem },
        ...historyForModel(history, PLANNER_HISTORY_MAX_TURNS, PLANNER_HISTORY_MAX_CHARACTERS),
        { role: "user" as const, content: plannerQuestion }
      ];
    return {
      url: completionUrl(settings.endpoint),
      headers,
      isGroqGptOss: groqGptOss,
      body: {
        model: settings.model,
        messages,
        ...providerOptions,
        ...(actionBudget
          ? ("max_completion_tokens" in providerOptions ? {} : { max_tokens: actionBudget.plannerOutputTokens })
          : settings.provider === "deepseek"
          ? { max_tokens: mode === "fast" ? 240 : 600 }
          : {})
      }
    };
  }

  private requestHeaders(settings: ModelSettings): Record<string, string> {
    if (!this.isConfigured(settings)) {
      throw new ModelConfigurationError(settings.provider === "custom" && !settings.serviceName.trim()
        ? "missing-service-name"
        : "missing-endpoint-or-model");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = this.getApiKey()?.trim() ?? "";
    if (providerRequiresApiKey(settings.provider) && !apiKey) {
      throw new ModelConfigurationError("missing-api-key");
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
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
      throw new ModelRequestError(requestErrorCode(response.status, detail), detail);
    }
    const text = responseText(body.choices);
    if (!text) {
      throw new ModelRequestError(request.isGroqGptOss ? "reasoning-exhausted" : "empty-response");
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
    let streamedText = "";
    let emittedLength = 0;
    let directiveStarted = false;
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
          throw new SafeNonStreamingFallbackError("streaming-unsupported");
        }
        throw new ModelRequestError(requestErrorCode(response.status, detail), detail);
      }

      if (contentType.includes("application/json")) {
        const responseBody = await response.text();
        const body = parseJsonResponse(responseBody);
        const text = responseText(body.choices);
        if (!text) {
          throw body.error?.message
            ? new ModelRequestError("request-failed", body.error.message)
            : new ModelRequestError(request.isGroqGptOss ? "reasoning-exhausted" : "empty-response");
        }
        options.onResponseMode?.("non-stream", "complete-response");
        options.onDelta?.(text);
        return text;
      }
      if (!response.body || typeof response.body.getReader !== "function") {
        throw new StreamFallbackRequiredError("response-not-streamable");
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
          streamedText += delta;
          if (directiveStarted) return;
          const directiveStart = streamedText.indexOf(CLARIFICATION_DIRECTIVE_PREFIX);
          if (directiveStart >= 0) {
            options.onDelta?.(streamedText.slice(emittedLength, directiveStart));
            emittedLength = directiveStart;
            directiveStarted = true;
            return;
          }
          const safeEnd = streamedText.length - directivePrefixSuffixLength(streamedText);
          options.onDelta?.(streamedText.slice(emittedLength, safeEnd));
          emittedLength = safeEnd;
        }
      });
      if (!directiveStarted && emittedLength < streamedText.length) {
        options.onDelta?.(streamedText.slice(emittedLength));
      }
      return finishWarning(result.text, result.finishReason, options.onWarning);
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
      if (error instanceof ChatCompletionStreamError && request.isGroqGptOss) {
        throw new ModelRequestError("reasoning-exhausted");
      }
      if (
        error instanceof SafeNonStreamingFallbackError ||
        error instanceof ModelRequestError ||
        error instanceof StreamFallbackRequiredError
      ) {
        throw error;
      }
      if (error instanceof ChatCompletionStreamInterruptedError && error.partialText) {
        throw new ModelStreamInterruptedError(
          "stream-interrupted",
          extractClarificationDirective(error.partialText).markdown,
          { cause: error }
        );
      }
      if (receivedText) {
        throw new ModelStreamInterruptedError(
          "stream-interrupted",
          "",
          { cause: error }
        );
      }
      throw new StreamFallbackRequiredError(
        "stream-connection-failed",
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
