import type { ModelSettings } from "../settings";
import { isGroqEndpoint } from "./prompt-budget";

export interface CompletionRequestOptions {
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low";
  include_reasoning?: false;
  thinking?: {
    type: "disabled";
  };
}

export function isGroqGptOssModel(settings: Partial<Pick<ModelSettings, "endpoint" | "model">>): boolean {
  return isGroqEndpoint(settings.endpoint) &&
    (settings.model === "openai/gpt-oss-20b" || settings.model === "openai/gpt-oss-120b");
}

export function completionRequestOptions(
  settings: Pick<ModelSettings, "provider"> & Partial<Pick<ModelSettings, "endpoint" | "model" | "maximumOutputTokens">>,
  outputTokens?: number
): CompletionRequestOptions {
  const configured = settings.maximumOutputTokens;
  const effectiveOutputTokens = outputTokens ?? (typeof configured === "number" ? configured : 512);
  if (isGroqGptOssModel(settings)) {
    return {
      max_completion_tokens: effectiveOutputTokens,
      reasoning_effort: "low",
      include_reasoning: false
    };
  }
  if (settings.provider === "deepseek") {
    return {
      max_tokens: typeof settings.maximumOutputTokens === "number" ? settings.maximumOutputTokens : 4_096,
      thinking: { type: "disabled" }
    };
  }
  if (typeof configured === "number") return { max_tokens: configured };
  return isGroqEndpoint(settings.endpoint) ? { max_tokens: 512 } : {};
}
