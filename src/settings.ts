import { App, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { DEFAULT_PROFILE_CONFIG } from "./core/profile";
import {
  DEFAULT_RETRIEVAL_RANGE,
  isRetrievalRange,
  retrievalOptionsForRange
} from "./core/retriever";
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

export interface ModelSettings {
  provider: ModelProvider;
  serviceName: string;
  endpoint: string;
  model: string;
}

export interface WikiCopilotSettings {
  autoDetectProfile: boolean;
  profile: KnowledgeProfileConfig;
  retrievalRange: RetrievalRange;
  retrieval: RetrievalOptions;
  prioritizeActiveNote: boolean;
  model: ModelSettings;
}

export const DEFAULT_SETTINGS: WikiCopilotSettings = {
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
  retrievalRange: DEFAULT_RETRIEVAL_RANGE,
  retrieval: retrievalOptionsForRange(DEFAULT_RETRIEVAL_RANGE),
  prioritizeActiveNote: true,
  model: {
    provider: "openai",
    serviceName: "",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.6-terra"
  }
};

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [...fallback];
}

export function loadWikiCopilotSettings(data: unknown): WikiCopilotSettings {
  const raw = data && typeof data === "object" ? data as Partial<WikiCopilotSettings> : {};
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
  const retrievalRange = isRetrievalRange(raw.retrievalRange)
    ? raw.retrievalRange
    : DEFAULT_RETRIEVAL_RANGE;

  return {
    autoDetectProfile: true,
    profile: {
      schemaFiles: stringArray(rawProfile.schemaFiles, DEFAULT_SETTINGS.profile.schemaFiles),
      indexFiles: stringArray(rawProfile.indexFiles, DEFAULT_SETTINGS.profile.indexFiles),
      wikiRoots: stringArray(rawProfile.wikiRoots, DEFAULT_SETTINGS.profile.wikiRoots),
      stableSourceRoots: stringArray(rawProfile.stableSourceRoots, DEFAULT_SETTINGS.profile.stableSourceRoots),
      pendingSourceRoots: stringArray(rawProfile.pendingSourceRoots, DEFAULT_SETTINGS.profile.pendingSourceRoots),
      excludedRoots: stringArray(rawProfile.excludedRoots, DEFAULT_SETTINGS.profile.excludedRoots)
    },
    retrievalRange,
    retrieval: retrievalOptionsForRange(retrievalRange),
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
  | "provider"
  | "serviceName"
  | "endpoint"
  | "model"
  | "retrievalRange";

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
        name: "Wiki Copilot",
        desc: "面向持久化 LLM Wiki 的知识库问答插件。优先检索沉淀知识，按需核对稳定原文，并生成带来源引用的回答。",
        render: (setting) => {
          setting
            .setName("Wiki Copilot")
            .setDesc("面向持久化 LLM Wiki 的知识库问答插件。优先检索沉淀知识，按需核对稳定原文，并生成带来源引用的回答。")
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
            name: "范围与深度",
            desc: "每次回答最多参考：低 12 页、中 24 页、高 36 页。档位越高，覆盖越广，等待时间也可能越长。",
            control: {
              type: "dropdown",
              key: "retrievalRange",
              options: {
                low: "低（更快）",
                medium: "中（推荐）",
                high: "高（更全面）"
              }
            }
          }
        ]
      }
    ];
  }

  override getControlValue(key: WikiCopilotSettingKey): unknown {
    switch (key) {
      case "provider":
        return this.plugin.settings.model.provider;
      case "serviceName":
        return this.plugin.settings.model.serviceName;
      case "endpoint":
        return this.plugin.settings.model.endpoint;
      case "model":
        return this.plugin.settings.model.model;
      case "retrievalRange":
        return this.plugin.settings.retrievalRange;
    }
  }

  override async setControlValue(key: WikiCopilotSettingKey, value: unknown): Promise<void> {
    switch (key) {
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
      case "retrievalRange":
        if (!isRetrievalRange(value)) {
          return;
        }
        this.plugin.settings.retrievalRange = value;
        this.plugin.settings.retrieval = retrievalOptionsForRange(value);
        break;
    }
    await this.plugin.saveSettings();
  }
}
