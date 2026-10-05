import type { ModelSettings } from "../settings";
import { isGroqEndpoint } from "./prompt-budget";

export interface CompletionRequestOptions {
  max_tokens?: number;
  thinking?: {
    type: "disabled";
  };
}

export function completionRequestOptions(
  settings: Pick<ModelSettings, "provider"> & Partial<Pick<ModelSettings, "endpoint" | "maximumOutputTokens">>
): CompletionRequestOptions {
  if (settings.provider === "deepseek") {
    return {
      max_tokens: typeof settings.maximumOutputTokens === "number" ? settings.maximumOutputTokens : 4_096,
      thinking: { type: "disabled" }
    };
  }
  const configured = settings.maximumOutputTokens;
  if (typeof configured === "number") return { max_tokens: configured };
  return isGroqEndpoint(settings.endpoint) ? { max_tokens: 512 } : {};
}
