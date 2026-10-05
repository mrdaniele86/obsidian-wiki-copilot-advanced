import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  App: class {},
  PluginSettingTab: class {},
  Setting: class {}
}));

import {
  DEFAULT_SETTINGS,
  loadWikiCopilotSettings,
  WikiCopilotSettingTab
} from "../src/settings";
import { en } from "../src/i18n/en";
import { it as italian } from "../src/i18n/it";
import { zh } from "../src/i18n/zh";

describe("translation dictionaries", () => {
  it("covers every English key with Italian and Chinese translations", () => {
    expect(Object.keys(italian).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(italian["settings.model.heading"]).toBe("Servizio modello");
    expect(zh["settings.model.heading"]).toBe("模型服务");
    expect(zh["role.topic"]).toBe("主题");
  });
});

describe("retrieval mode settings", () => {
  it("defaults web search to the disabled Gemini configuration", () => {
    const settings = loadWikiCopilotSettings(undefined);

    expect(settings.webSearch).toEqual({
      mode: "disabled",
      geminiModel: "gemini-2.5-flash",
      includeRecentChatContext: false
    });
    expect(DEFAULT_SETTINGS.webSearch).toEqual(settings.webSearch);
  });

  it("keeps recognized persisted web-search modes and trims a Gemini model", () => {
    const settings = loadWikiCopilotSettings({ webSearch: {
      mode: "dedicated-gemini",
      geminiModel: " gemini-3-flash-preview "
    } });

    expect(settings.webSearch).toEqual({
      mode: "dedicated-gemini",
      geminiModel: "gemini-3-flash-preview",
      includeRecentChatContext: false
    });
  });

  it("normalizes the legacy current-provider web-search mode to disabled", () => {
    expect(loadWikiCopilotSettings({ webSearch: {
      mode: "current-provider",
      geminiModel: "gemini-3-flash-preview"
    } }).webSearch).toEqual({
      mode: "disabled",
      geminiModel: "gemini-3-flash-preview",
      includeRecentChatContext: false
    });
  });

  it("normalizes malformed persisted web-search settings safely", () => {
    expect(loadWikiCopilotSettings({ webSearch: {
      mode: "untrusted-provider",
      geminiModel: 42
    } }).webSearch).toEqual({
      mode: "disabled",
      geminiModel: "gemini-2.5-flash",
      includeRecentChatContext: false
    });
    expect(loadWikiCopilotSettings({ webSearch: "enabled" }).webSearch).toEqual({
      mode: "disabled",
      geminiModel: "gemini-2.5-flash",
      includeRecentChatContext: false
    });
  });

  it("starts a fresh installation with a neutral custom provider", () => {
    const settings = loadWikiCopilotSettings(undefined);

    expect(settings.model).toEqual({
      provider: "custom",
      serviceName: "",
      endpoint: "",
      model: "",
      includeRecentConversationContext: false,
      maximumInputTokens: "automatic",
      maximumOutputTokens: "automatic"
    });
    expect(DEFAULT_SETTINGS.model).toEqual(settings.model);
  });

  it("keeps legacy configured providers usable when migrating saved settings", () => {
    expect(loadWikiCopilotSettings({ model: {
      provider: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-5.6-sol"
    } }).model).toMatchObject({
      provider: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-5.6-sol"
    });
  });
  it("defaults an invalid saved interface language to Auto", () => {
    expect(loadWikiCopilotSettings(undefined).language).toBe("auto");
    expect(loadWikiCopilotSettings({ language: "invalid" }).language).toBe("auto");
  });
  it("uses precise retrieval by default", () => {
    const settings = loadWikiCopilotSettings(undefined);

    expect(settings.retrievalMode).toBe("precise");
    expect(settings.retrievalRange).toBe("high");
    expect(settings.retrieval).toMatchObject({
      includePending: true,
      maxSummaryResults: 12,
      maxRetrievedPages: 36,
      maxEvidenceFiles: 12,
      maxContextCharacters: 48_000
    });
    expect(DEFAULT_SETTINGS.retrievalMode).toBe("precise");
  });

  it("restores precise mode and derives its wider candidate limits", () => {
    const settings = loadWikiCopilotSettings({ retrievalMode: "precise" });

    expect(settings.retrievalMode).toBe("precise");
    expect(settings.retrievalRange).toBe("high");
    expect(settings.retrieval).toMatchObject({
      includePending: true,
      maxIndexResults: 2,
      maxTopicConceptResults: 6,
      maxSummaryResults: 12,
      maxWikiResults: 6,
      maxStableSourceResults: 10,
      maxRetrievedPages: 36,
      maxEvidenceFiles: 12,
      maxContextCharacters: 48_000
    });
  });

  it("uses the balanced curated-Wiki budget in fast mode", () => {
    const settings = loadWikiCopilotSettings({ retrievalMode: "fast" });

    expect(settings.retrievalMode).toBe("fast");
    expect(settings.retrievalRange).toBe("low");
    expect(settings.retrieval).toMatchObject({
      includePending: false,
      maxIndexResults: 1,
      maxTopicConceptResults: 4,
      maxSummaryResults: 8,
      maxWikiResults: 4,
      maxRetrievedPages: 24,
      maxEvidenceFiles: 8,
      maxContextCharacters: 30_000
    });
  });

  it("migrates legacy range-only settings to precise mode", () => {
    const settings = loadWikiCopilotSettings({ retrievalRange: "low" });

    expect(settings.retrievalMode).toBe("precise");
    expect(settings.retrievalRange).toBe("high");
    expect(settings.retrieval.includePending).toBe(true);
  });

  it("falls back safely when the saved mode is invalid", () => {
    const settings = loadWikiCopilotSettings({ retrievalMode: "extreme" });

    expect(settings.retrievalMode).toBe("precise");
    expect(settings.retrievalRange).toBe("high");
  });
});

describe("model response mode settings", () => {
  it("defaults chat context off and restores valid model token limits", () => {
    expect(loadWikiCopilotSettings(undefined).model).toMatchObject({
      includeRecentConversationContext: false,
      maximumInputTokens: "automatic",
      maximumOutputTokens: "automatic"
    });
    expect(loadWikiCopilotSettings({ model: {
      maximumInputTokens: 8_000,
      maximumOutputTokens: 1_024,
      includeRecentConversationContext: true
    } }).model).toMatchObject({
      includeRecentConversationContext: true,
      maximumInputTokens: 8_000,
      maximumOutputTokens: 1_024
    });
  });

  it("does not expose a response-mode choice in settings", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null,
      t: (key: string) => key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const definitions = tab.getSettingDefinitions() as unknown as Array<{
      name?: string;
      items?: Array<{ name?: string }>;
    }>;
    const names = definitions.flatMap((definition) => [
      definition.name,
      ...(definition.items ?? []).map((item) => item.name)
    ]);

    expect(names).not.toContain("回答方式");
  });
});

describe("settings presentation", () => {
  it("exposes the localized, capability-aware web search controls", () => {
    const settingsSource = readFileSync(
      new URL("../src/settings.ts", import.meta.url),
      "utf8"
    );

    expect(settingsSource).toContain('heading: t("settings.webSearch.heading")');
    expect(settingsSource).toContain('webSearch.mode === "dedicated-gemini"');
    expect(settingsSource).toContain('key: "webSearchMode"');
    expect(settingsSource).toContain('key: "webSearchGeminiModel"');
    expect(settingsSource).toContain('this.plugin.setWebSearchApiKey(value)');
  });

  it("offers only disabled and dedicated Gemini web-search modes", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null,
      t: (key: string) => key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const definitions = tab.getSettingDefinitions() as unknown as Array<{
      items?: Array<{ control?: { key?: string; options?: Record<string, string> } }>;
    }>;
    const mode = definitions.flatMap((definition) => definition.items ?? [])
      .find((item) => item.control?.key === "webSearchMode");

    expect(mode?.control?.options).toEqual({
      disabled: "settings.webSearch.mode.disabled",
      "dedicated-gemini": "settings.webSearch.mode.dedicatedGemini"
    });
  });

  it("fills a provider suggestion without touching the stored API key", async () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: vi.fn(() => "saved-secret"),
      setApiKey: vi.fn(),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      t: (key: string) => key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    Object.assign(tab, { update: vi.fn() });

    await tab.setControlValue("provider", "deepseek");

    expect(plugin.settings.model).toMatchObject({
      provider: "deepseek", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash"
    });
    expect(plugin.setApiKey).not.toHaveBeenCalled();
  });
  it("redraws the settings controls after persisting a language change", async () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      t: (key: string) => key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const update = vi.fn();
    Object.assign(tab, { update });

    await tab.setControlValue("language", "it");

    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it("localizes the interface language selector through the plugin translator", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null,
      t: (key: string) => ({
        "settings.interface.heading": "Interfaccia",
        "settings.interface.language.name": "Lingua dell'interfaccia",
        "settings.interface.language.desc": "Scegli la lingua dell'interfaccia.",
        "language.auto": "Automatico",
        "language.it": "Italiano",
        "language.en": "Inglese",
        "language.zh": "Cinese"
      })[key] ?? key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const interfaceGroup = tab.getSettingDefinitions()[0];

    expect(interfaceGroup).toMatchObject({
      heading: "Interfaccia",
      items: [{
        name: "Lingua dell'interfaccia",
        desc: "Scegli la lingua dell'interfaccia.",
        control: {
          options: { auto: "Automatico", it: "Italiano", en: "Inglese", zh: "Cinese" }
        }
      }]
    });
  });

  it("exposes precise and fast retrieval without the legacy range control", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null,
      t: (key: string) => key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const definitions = tab.getSettingDefinitions() as unknown as Array<{
      items?: Array<{
        name?: string;
        desc?: string;
        control?: { key?: string; options?: Record<string, string> };
      }>;
    }>;
    const retrieval = definitions.flatMap((definition) => definition.items ?? [])
      .find((item) => item.name === "settings.retrieval.name");

    expect(retrieval?.control).toMatchObject({
      key: "retrievalMode",
      options: {
        precise: "settings.retrieval.precise",
        fast: "settings.retrieval.fast"
      }
    });
    expect(retrieval?.desc).toBe(
      "settings.retrieval.desc"
    );
  });

  it("renders a concise plugin introduction with the responsive styling hook", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null,
      t: (key: string) => key
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const intro = tab.getSettingDefinitions().find((definition) => "name" in definition && definition.name === "Wiki Copilot") as {
      render: (setting: unknown, group: unknown) => void;
    };
    const setting = {
      setClass: vi.fn(),
      setName: vi.fn(),
      setDesc: vi.fn(),
      setHeading: vi.fn()
    };
    for (const method of Object.values(setting)) {
      method.mockReturnValue(setting);
    }

    intro.render(setting, {});

    expect(setting.setClass).toHaveBeenCalledWith("wiki-copilot-settings-intro");
    expect(setting.setDesc).toHaveBeenCalledWith(
      "settings.intro"
    );
    expect(setting.setHeading).toHaveBeenCalledOnce();
  });
});
