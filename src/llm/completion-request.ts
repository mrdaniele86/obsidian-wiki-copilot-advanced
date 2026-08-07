import type { ModelSettings } from "../settings";

export interface CompletionRequestOptions {
  max_tokens?: number;
  thinking?: {
    type: "disabled";
  };
}

export function completionRequestOptions(
  settings: Pick<ModelSettings, "provider">
): CompletionRequestOptions {
  if (settings.provider !== "deepseek") {
    return {};
  }
  return {
    max_tokens: 4_096,
    thinking: { type: "disabled" }
  };
}
