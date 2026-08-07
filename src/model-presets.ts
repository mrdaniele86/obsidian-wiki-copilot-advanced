export type ModelProvider = "openai" | "deepseek" | "custom";

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelProviderPreset {
  label: string;
  endpoint: string;
  models: readonly ModelOption[];
}

export const FIXED_API_KEY_ID = "wiki-copilot-api-key";

export const MODEL_PROVIDER_PRESETS: Readonly<Record<Exclude<ModelProvider, "custom">, ModelProviderPreset>> = {
  openai: {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra（均衡，推荐）" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna（经济）" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol（最强）" }
    ]
  },
  deepseek: {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash（快速，推荐）" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro（更强）" }
    ]
  }
};

export function isModelProvider(value: unknown): value is ModelProvider {
  return value === "openai" || value === "deepseek" || value === "custom";
}

export function inferModelProvider(endpoint: string): ModelProvider {
  const normalized = endpoint.trim().toLocaleLowerCase();
  if (normalized.includes("api.deepseek.com")) {
    return "deepseek";
  }
  if (normalized.includes("api.openai.com")) {
    return "openai";
  }
  return "custom";
}

export function providerLabel(provider: ModelProvider, customName = ""): string {
  return provider === "custom"
    ? customName.trim() || "OpenAI 兼容服务"
    : MODEL_PROVIDER_PRESETS[provider].label;
}

export function providerEndpoint(provider: ModelProvider, customEndpoint = ""): string {
  return provider === "custom" ? customEndpoint.trim() : MODEL_PROVIDER_PRESETS[provider].endpoint;
}

export function providerModels(provider: ModelProvider): readonly ModelOption[] {
  return provider === "custom" ? [] : MODEL_PROVIDER_PRESETS[provider].models;
}

export function defaultModelForProvider(provider: ModelProvider): string {
  return providerModels(provider)[0]?.id ?? "";
}

export function providerRequiresApiKey(provider: ModelProvider): boolean {
  return provider !== "custom";
}
