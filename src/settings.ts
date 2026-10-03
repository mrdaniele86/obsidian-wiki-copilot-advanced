import { App, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { DEFAULT_PROFILE_CONFIG } from "./core/profile";
import { retrievalOptionsForRange } from "./core/retriever";
import type { KnowledgeProfileConfig, RetrievalOptions, RetrievalRange } from "./core/types";
import type WikiCopilotPlugin from "./main";
import {
  defaultModelForProvider,
  inferModelProvider,
  isModelProvider,
  MODEL_PROVIDER_PRESETS,
  providerEndpoint,
  providerModels
} from "./model-presets";
import type { ModelProvider } from "./model-presets";
import { isUiLanguage } from "./i18n";
import type { UiLanguage } from "./i18n";
import type { WebSearchMode, WebSearchSettings } from "./web-search/types";

export type RetrievalMode = "precise" | "fast";

export const DEFAULT_RETRIEVAL_MODE: RetrievalMode = "precise";

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  mode: "disabled",
  geminiModel: "gemini-2.5-flash"
};

export interface ModelSettings {
  provider: ModelProvider;
  serviceName: string;
  endpoint: string;
  model: string;
}

export interface WikiCopilotSettings {
  language: UiLanguage;
  conversationFolder: string;
  autoDetectProfile: boolean;
  profile: KnowledgeProfileConfig;
  retrievalMode: RetrievalMode;
  retrievalRange: RetrievalRange;
  retrieval: RetrievalOptions;
  prioritizeActiveNote: boolean;
  model: ModelSettings;
  webSearch: WebSearchSettings;
}

export const DEFAULT_SETTINGS: WikiCopilotSettings = {
  language: "auto",
  conversationFolder: "Memory Copilot/Conversations",
  autoDetectProfile: true,
  profile: {
    ...DEFAULT_PROFILE_CONFIG,
    schemaFiles: [...DEFAULT_PROFILE_CONFIG.schemaFiles],
    indexFiles: [...DEFAULT_PROFILE_CONFIG.indexFiles],
    wikiRoots: [...DEFAULT_PROFILE_CONFIG.wikiRoots],
    stableSourceRoots: [...DEFAULT_PROFILE_CONFIG.stableSourceRoots],
    pendingSourceRoots: [...DEFAULT_PROFILE_CONFIG.pendingSourceRoots],
    excludedRoots: [...DEFAULT_PROFILE_CONFIG.excludedRoots]
  },
  retrievalMode: DEFAULT_RETRIEVAL_MODE,
  retrievalRange: "high",
  retrieval: {
    ...retrievalOptionsForRange("high"),
    includePending: true
  },
  prioritizeActiveNote: true,
  model: {
    provider: "custom",
    serviceName: "",
    endpoint: "",
    model: ""
  },
  webSearch: { ...DEFAULT_WEB_SEARCH_SETTINGS }
};

export function isRetrievalMode(value: unknown): value is RetrievalMode {
  return value === "precise" || value === "fast";
}

export function isWebSearchMode(value: unknown): value is WebSearchMode {
  return value === "disabled" || value === "current-provider" || value === "dedicated-gemini";
}

function retrievalSettingsForMode(mode: RetrievalMode): {
  answerTimeoutRange: RetrievalRange;
  options: RetrievalOptions;
} {
  const answerTimeoutRange: RetrievalRange = mode === "precise" ? "high" : "low";
  const retrievalBudget: RetrievalRange = mode === "precise" ? "high" : "medium";
  return {
    answerTimeoutRange,
    options: {
      ...retrievalOptionsForRange(retrievalBudget),
      includePending: mode === "precise"
    }
  };
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [...fallback];
}

export function loadWikiCopilotSettings(data: unknown): WikiCopilotSettings {
  const raw = data && typeof data === "object" ? data as Partial<WikiCopilotSettings> : {};
  const language = isUiLanguage(raw.language) ? raw.language : DEFAULT_SETTINGS.language;
  const conversationFolder = typeof raw.conversationFolder === "string" && raw.conversationFolder.trim()
    ? raw.conversationFolder.trim()
    : DEFAULT_SETTINGS.conversationFolder;
  const rawProfile: Partial<KnowledgeProfileConfig> = raw.profile && typeof raw.profile === "object" ? raw.profile : {};
  const rawModel: Partial<ModelSettings> = raw.model && typeof raw.model === "object" ? raw.model : {};
  const rawWebSearch: Partial<WebSearchSettings> = raw.webSearch && typeof raw.webSearch === "object" ? raw.webSearch : {};
  const savedEndpoint = typeof rawModel.endpoint === "string" ? rawModel.endpoint.trim() : "";
  const provider = isModelProvider(rawModel.provider)
    ? rawModel.provider
    : savedEndpoint
      ? inferModelProvider(savedEndpoint)
      : DEFAULT_SETTINGS.model.provider;
  const savedModel = typeof rawModel.model === "string" ? rawModel.model.trim() : "";
  const savedServiceName = typeof rawModel.serviceName === "string" ? rawModel.serviceName.trim() : "";
  const retrievalMode = isRetrievalMode(raw.retrievalMode)
    ? raw.retrievalMode
    : DEFAULT_RETRIEVAL_MODE;
  const retrievalSettings = retrievalSettingsForMode(retrievalMode);
  const webSearchMode = isWebSearchMode(rawWebSearch.mode)
    ? rawWebSearch.mode
    : DEFAULT_WEB_SEARCH_SETTINGS.mode;
  const savedGeminiModel = typeof rawWebSearch.geminiModel === "string"
    ? rawWebSearch.geminiModel.trim()
    : "";

  return {
    language,
    conversationFolder,
    autoDetectProfile: true,
    profile: {
      schemaFiles: stringArray(rawProfile.schemaFiles, DEFAULT_SETTINGS.profile.schemaFiles),
      indexFiles: stringArray(rawProfile.indexFiles, DEFAULT_SETTINGS.profile.indexFiles),
      wikiRoots: stringArray(rawProfile.wikiRoots, DEFAULT_SETTINGS.profile.wikiRoots),
      stableSourceRoots: stringArray(rawProfile.stableSourceRoots, DEFAULT_SETTINGS.profile.stableSourceRoots),
      pendingSourceRoots: stringArray(rawProfile.pendingSourceRoots, DEFAULT_SETTINGS.profile.pendingSourceRoots),
      excludedRoots: stringArray(rawProfile.excludedRoots, DEFAULT_SETTINGS.profile.excludedRoots)
    },
    retrievalMode,
    retrievalRange: retrievalSettings.answerTimeoutRange,
    retrieval: retrievalSettings.options,
    prioritizeActiveNote: true,
    model: {
      provider,
      serviceName: savedServiceName,
      endpoint: providerEndpoint(provider, savedEndpoint),
      model: savedModel || defaultModelForProvider(provider)
    },
    webSearch: {
      mode: webSearchMode,
      geminiModel: savedGeminiModel || DEFAULT_WEB_SEARCH_SETTINGS.geminiModel
    }
  };
}

export function legacyApiKeySecretName(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const model = (data as { model?: unknown }).model;
  if (!model || typeof model !== "object") {
    return "";
  }
  const value = (model as { apiKeySecret?: unknown }).apiKeySecret;
  return typeof value === "string" ? value.trim() : "";
}

type WikiCopilotSettingKey =
  | "language"
  | "conversationFolder"
  | "provider"
  | "serviceName"
  | "endpoint"
  | "model"
  | "retrievalMode";

export class WikiCopilotSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WikiCopilotPlugin) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem<WikiCopilotSettingKey>[] {
    const t = this.plugin.t.bind(this.plugin);
    const provider = this.plugin.settings.model.provider;
    const selectedModel = this.plugin.settings.model.model;
    const modelOptions = Object.fromEntries(
      providerModels(provider).map((option) => [option.id, option.label])
    );
    if (selectedModel && !(selectedModel in modelOptions)) {
      modelOptions[selectedModel] = t("settings.model.current", { model: selectedModel });
    }

    return [
      {
        type: "group",
        heading: t("settings.interface.heading"),
        items: [{
          name: t("settings.interface.language.name"),
          desc: t("settings.interface.language.desc"),
          control: { type: "dropdown", key: "language", options: {
            auto: t("language.auto"), it: t("language.it"),
            en: t("language.en"), zh: t("language.zh")
          } }
        }]
      },
      {
        type: "group",
        heading: t("settings.conversation.heading"),
        items: [{
          name: t("settings.conversation.folder.name"),
          desc: t("settings.conversation.folder.desc"),
          control: { type: "text", key: "conversationFolder", placeholder: DEFAULT_SETTINGS.conversationFolder }
        }]
      },
      {
        name: "Wiki Copilot",
        desc: t("settings.intro"),
        render: (setting) => {
          setting
            .setClass("wiki-copilot-settings-intro")
            .setName("Wiki Copilot")
            .setDesc(t("settings.intro"))
            .setHeading();
        }
      },
      {
        type: "group",
        heading: t("settings.model.heading"),
        items: [
          {
            name: t("settings.provider.name"), desc: t("settings.provider.desc"),
            control: {
              type: "dropdown",
              key: "provider",
              options: {
                deepseek: "DeepSeek",
                openai: "OpenAI",
                custom: t("settings.provider.custom")
              }
            }
          },
          {
            name: t("settings.service.name"), desc: t("settings.service.desc"),
            visible: () => this.plugin.settings.model.provider === "custom",
            control: {
              type: "text",
              key: "serviceName",
              placeholder: t("settings.service.placeholder")
            }
          },
          {
            name: t("settings.endpoint.name"), desc: t("settings.endpoint.desc"),
            visible: () => this.plugin.settings.model.provider === "custom",
            control: {
              type: "text",
              key: "endpoint",
              placeholder: "https://example.com/v1"
            }
          },
          provider === "custom"
            ? {
              name: t("settings.model.name"), desc: t("settings.model.custom.desc"),
              control: {
                type: "text",
                key: "model",
                placeholder: t("settings.model.placeholder")
              }
            }
            : {
              name: t("settings.model.name"), desc: t("settings.model.endpoint", { endpoint: MODEL_PROVIDER_PRESETS[provider].endpoint }),
              control: {
                type: "dropdown",
                key: "model",
                options: modelOptions
              }
            },
          {
            name: t("settings.apiKey.name"), desc: t("settings.apiKey.desc"),
            render: (setting) => {
              setting
                .setName(t("settings.apiKey.name"))
                .setDesc(t("settings.apiKey.desc"))
                .addText((text) => {
                  text.inputEl.type = "password";
                  text.inputEl.autocomplete = "off";
                  return text
                    .setPlaceholder(provider === "custom" ? t("settings.apiKey.local") : t("settings.apiKey.placeholder"))
                    .setValue(this.plugin.getApiKey() ?? "")
                    .onChange(async (value) => {
                      await this.plugin.setApiKey(value);
                    });
                });
            }
          }
        ]
      },
      {
        type: "group",
        heading: t("settings.retrieval.heading"),
        items: [
          {
            name: t("settings.retrieval.name"), desc: t("settings.retrieval.desc"),
            control: {
              type: "dropdown",
              key: "retrievalMode",
              options: {
                precise: t("settings.retrieval.precise"), fast: t("settings.retrieval.fast")
              }
            }
          }
        ]
      }
    ];
  }

  override getControlValue(key: WikiCopilotSettingKey): unknown {
    switch (key) {
      case "language": return this.plugin.settings.language;
      case "conversationFolder": return this.plugin.settings.conversationFolder;
      case "provider":
        return this.plugin.settings.model.provider;
      case "serviceName":
        return this.plugin.settings.model.serviceName;
      case "endpoint":
        return this.plugin.settings.model.endpoint;
      case "model":
        return this.plugin.settings.model.model;
      case "retrievalMode":
        return this.plugin.settings.retrievalMode;
    }
  }

  override async setControlValue(key: WikiCopilotSettingKey, value: unknown): Promise<void> {
    switch (key) {
      case "language":
        if (!isUiLanguage(value)) return;
        this.plugin.settings.language = value;
        break;
      case "conversationFolder":
        if (typeof value !== "string" || !value.trim()) return;
        this.plugin.settings.conversationFolder = value.trim();
        break;
      case "provider":
        if (!isModelProvider(value)) {
          return;
        }
        this.plugin.settings.model.provider = value;
        this.plugin.settings.model.endpoint = providerEndpoint(value);
        this.plugin.settings.model.model = defaultModelForProvider(value);
        await this.plugin.saveSettings();
        this.update();
        return;
      case "serviceName":
        if (typeof value === "string") {
          this.plugin.settings.model.serviceName = value.trim();
        }
        break;
      case "endpoint":
        if (typeof value === "string") {
          this.plugin.settings.model.endpoint = value.trim();
        }
        break;
      case "model":
        if (typeof value === "string") {
          this.plugin.settings.model.model = value.trim();
        }
        break;
      case "retrievalMode":
        if (!isRetrievalMode(value)) {
          return;
        }
        this.plugin.settings.retrievalMode = value;
        {
          const retrievalSettings = retrievalSettingsForMode(value);
          this.plugin.settings.retrievalRange = retrievalSettings.answerTimeoutRange;
          this.plugin.settings.retrieval = retrievalSettings.options;
        }
        break;
    }
    await this.plugin.saveSettings();
    if (key === "language") {
      this.update();
    }
  }
}
