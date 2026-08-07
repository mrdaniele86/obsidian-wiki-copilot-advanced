import { requestUrl } from "obsidian";
import type { BuiltContext } from "../core/context-builder";
import { providerRequiresApiKey } from "../model-presets";
import type { ModelSettings } from "../settings";
import { completionRequestOptions } from "./completion-request";
import { buildSystemPrompt } from "./prompt";
import { withTimeout } from "./request-timeout";

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

function historyForModel(history: ChatTurn[]): ChatTurn[] {
  return history.slice(-6).map((turn) => ({
    ...turn,
    content: turn.content.replace(/\[S\d+\]/gu, "[prior source]")
  }));
}

export class OpenAICompatibleClient {
  constructor(private readonly getApiKey: () => string | null) {}

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
    timeoutMilliseconds: number
  ): Promise<string> {
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
        ].join("\n\n")
      }
    ];

    const response = await withTimeout(requestUrl({
      url: completionUrl(settings.endpoint),
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: false,
        ...completionRequestOptions(settings)
      }),
      throw: false
    }), timeoutMilliseconds, "模型回答超时。 ");

    let body: ChatCompletionResponse;
    try {
      body = response.json as ChatCompletionResponse;
    } catch {
      body = {};
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = body.error?.message || response.text.slice(0, 500) || `HTTP ${response.status}`;
      throw new Error(`模型请求失败：${detail}`);
    }
    const text = responseText(body.choices);
    if (!text) {
      throw new Error("模型返回了空回答。 ");
    }
    return text;
  }
}
