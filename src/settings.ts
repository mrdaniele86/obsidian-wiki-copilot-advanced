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

export type RetrievalMode = "precise" | "fast";

export const DEFAULT_RETRIEVAL_MODE: RetrievalMode = "precise";

export interface ModelSettings {
  provider: ModelProvider;
  serviceName: string;
  endpoint: string;
  model: string;
}

export interface WikiCopilotSettings {
  language: UiLanguage;
  autoDetectProfile: boolean;
  profile: KnowledgeProfileConfig;
  retrievalMode: RetrievalMode;
  retrievalRange: RetrievalRange;
  retrieval: RetrievalOptions;
  prioritizeActiveNote: boolean;
  model: ModelSettings;
}

export const DEFAULT_SETTINGS: WikiCopilotSettings = {
  language: "auto",
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
    provider: "openai",
    serviceName: "",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.6-terra"
  }
};

export function isRetrievalMode(value: unknown): value is RetrievalMode {
  return value === "precise" || value === "fast";
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
  const rawProfile: Partial<KnowledgeProfileConfig> = raw.profile && typeof raw.profile === "object" ? raw.profile : {};
  const rawModel: Partial<ModelSettings> = raw.model && typeof raw.model === "object" ? raw.model : {};
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

  return {
    language,
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
    const provider = this.plugin.settings.model.provider;
    const selectedModel = this.plugin.settings.model.model;
    const modelOptions = Object.fromEntries(
      providerModels(provider).map((option) => [option.id, option.label])
    );
    if (selectedModel && !(selectedModel in modelOptions)) {
      modelOptions[selectedModel] = `${selectedModel}（当前配置）`;
    }

    return [
      {
        type: "group",
        heading: "Interface",
        items: [{
          name: "Interface language",
          desc: "Choose Auto, Italian, English, or Chinese.",
          control: { type: "dropdown", key: "language", options: { auto: "Auto", it: "Italiano", en: "English", zh: "中文" } }
        }]
      },
      {
        name: "Wiki Copilot",
        desc: "面向 LLM Wiki 的知识库问答插件，支持精准检索与来源引用。",
        render: (setting) => {
          setting
            .setClass("wiki-copilot-settings-intro")
            .setName("Wiki Copilot")
            .setDesc("面向 LLM Wiki 的知识库问答插件，支持精准检索与来源引用。")
            .setHeading();
        }
      },
      {
        type: "group",
        heading: "模型服务",
        items: [
          {
            name: "服务商",
            desc: "选择后自动配置兼容接口地址和常用模型。",
            control: {
              type: "dropdown",
              key: "provider",
              options: {
                deepseek: "DeepSeek",
                openai: "OpenAI",
                custom: "其他 OpenAI 兼容服务"
              }
            }
          },
          {
            name: "服务名称",
            desc: "用于回答等待提示，例如“硅基流动思考中…”。",
            visible: () => this.plugin.settings.model.provider === "custom",
            control: {
              type: "text",
              key: "serviceName",
              placeholder: "例如：硅基流动"
            }
          },
          {
            name: "接口地址",
            desc: "填写 API 根地址，或完整的 /chat/completions 地址。",
            visible: () => this.plugin.settings.model.provider === "custom",
            control: {
              type: "text",
              key: "endpoint",
              placeholder: "https://example.com/v1"
            }
          },
          provider === "custom"
            ? {
              name: "模型",
              desc: "填写服务商提供的模型 ID。",
              control: {
                type: "text",
                key: "model",
                placeholder: "模型 ID"
              }
            }
            : {
              name: "模型",
              desc: `接口地址自动使用 ${MODEL_PROVIDER_PRESETS[provider].endpoint}`,
              control: {
                type: "dropdown",
                key: "model",
                options: modelOptions
              }
            },
          {
            name: "API key",
            desc: "密钥保存在 Obsidian 安全存储中，不写入插件设置文件。",
            render: (setting) => {
              setting
                .setName("API key")
                .setDesc("密钥保存在 Obsidian 安全存储中，不写入插件设置文件。")
                .addText((text) => {
                  text.inputEl.type = "password";
                  text.inputEl.autocomplete = "off";
                  return text
                    .setPlaceholder(provider === "custom" ? "可留空（本地服务）" : "请输入 API key")
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
        heading: "知识检索",
        items: [
          {
            name: "检索模式",
            desc: "精准扫描全部 Markdown；快速搜索已整理 Wiki。",
            control: {
              type: "dropdown",
              key: "retrievalMode",
              options: {
                precise: "精准（推荐）",
                fast: "快速"
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
  }
}
