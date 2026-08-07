import { App, PluginSettingTab, Setting } from "obsidian";
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

export class WikiCopilotSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WikiCopilotPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("wiki-copilot-settings");

    containerEl.createEl("h2", { text: "Wiki Copilot" });
    containerEl.createEl("p", {
      text: "Wiki Copilot 是面向持久化 LLM Wiki 的知识库问答插件。它优先检索 Wiki 中沉淀的知识，并按需回查稳定原文，生成带来源引用的回答。"
    });

    containerEl.createEl("h3", { text: "模型服务" });
    new Setting(containerEl)
      .setName("服务商")
      .setDesc("选择后自动配置兼容接口地址和常用模型。")
      .addDropdown((dropdown) => dropdown
        .addOption("deepseek", "DeepSeek")
        .addOption("openai", "OpenAI")
        .addOption("custom", "其他 OpenAI 兼容服务")
        .setValue(this.plugin.settings.model.provider)
        .onChange(async (value) => {
          if (!isModelProvider(value)) {
            return;
          }
          this.plugin.settings.model.provider = value;
          this.plugin.settings.model.endpoint = providerEndpoint(value);
          this.plugin.settings.model.model = defaultModelForProvider(value);
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.model.provider === "custom") {
      new Setting(containerEl)
        .setName("服务名称")
        .setDesc("用于回答等待提示，例如“硅基流动思考中…”。")
        .addText((text) => text
          .setPlaceholder("例如：硅基流动")
          .setValue(this.plugin.settings.model.serviceName)
          .onChange(async (value) => {
            this.plugin.settings.model.serviceName = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("接口地址")
        .setDesc("填写 API 根地址，或完整的 /chat/completions 地址。")
        .addText((text) => text
          .setPlaceholder("https://example.com/v1")
          .setValue(this.plugin.settings.model.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.model.endpoint = value.trim();
            await this.plugin.saveSettings();
          }));
    }

    const modelSetting = new Setting(containerEl)
      .setName("模型")
      .setDesc(this.plugin.settings.model.provider === "custom"
        ? "填写服务商提供的模型 ID。"
        : `接口地址自动使用 ${MODEL_PROVIDER_PRESETS[this.plugin.settings.model.provider].endpoint}`);
    if (this.plugin.settings.model.provider === "custom") {
      modelSetting.addText((text) => text
        .setPlaceholder("模型 ID")
        .setValue(this.plugin.settings.model.model)
        .onChange(async (value) => {
          this.plugin.settings.model.model = value.trim();
          await this.plugin.saveSettings();
        }));
    } else {
      modelSetting.addDropdown((dropdown) => {
        for (const option of providerModels(this.plugin.settings.model.provider)) {
          dropdown.addOption(option.id, option.label);
        }
        const selected = this.plugin.settings.model.model;
        if (selected && !providerModels(this.plugin.settings.model.provider).some((option) => option.id === selected)) {
          dropdown.addOption(selected, `${selected}（当前配置）`);
        }
        return dropdown
          .setValue(selected)
          .onChange(async (value) => {
            this.plugin.settings.model.model = value;
            await this.plugin.saveSettings();
          });
      });
    }

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("直接填写即可。密钥保存在 Obsidian 的安全存储中，不写入插件设置文件。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        return text
          .setPlaceholder(this.plugin.settings.model.provider === "custom" ? "可留空（本地服务）" : "请输入 API Key")
          .setValue(this.plugin.getApiKey() ?? "")
          .onChange(async (value) => {
            await this.plugin.setApiKey(value);
          });
      });

    containerEl.createEl("h3", { text: "知识检索" });
    new Setting(containerEl)
      .setName("范围与深度")
      .setDesc("控制每次回答最多参考的知识页面：低 12 页、中 24 页、高 36 页。档位越高，覆盖越广，等待时间也可能越长。")
      .addDropdown((dropdown) => dropdown
        .addOption("low", "低（更快）")
        .addOption("medium", "中（推荐）")
        .addOption("high", "高（更全面）")
        .setValue(this.plugin.settings.retrievalRange)
        .onChange(async (value) => {
          if (!isRetrievalRange(value)) {
            return;
          }
          this.plugin.settings.retrievalRange = value;
          this.plugin.settings.retrieval = retrievalOptionsForRange(value);
          await this.plugin.saveSettings();
        }));

  }
}
