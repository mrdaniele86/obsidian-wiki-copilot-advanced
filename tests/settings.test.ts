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

describe("retrieval mode settings", () => {
  it("defaults an invalid saved interface language to Auto", () => {
    expect(loadWikiCopilotSettings(undefined).language).toBe("auto");
    expect(loadWikiCopilotSettings({ language: "invalid" } as never).language).toBe("auto");
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
  it("does not expose a response-mode choice in settings", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null
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
  it("exposes precise and fast retrieval without the legacy range control", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null
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
      .find((item) => item.name === "检索模式");

    expect(retrieval?.control).toMatchObject({
      key: "retrievalMode",
      options: {
        precise: "精准（推荐）",
        fast: "快速"
      }
    });
    expect(retrieval?.desc).toBe(
      "精准扫描全部 Markdown；快速搜索已整理 Wiki。"
    );
  });

  it("renders a concise plugin introduction with the responsive styling hook", () => {
    const plugin = {
      settings: loadWikiCopilotSettings(undefined),
      getApiKey: () => null
    };
    const tab = new WikiCopilotSettingTab({} as never, plugin as never);
    const intro = tab.getSettingDefinitions()[0] as {
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
      "面向 LLM Wiki 的知识库问答插件，支持精准检索与来源引用。"
    );
    expect(setting.setHeading).toHaveBeenCalledOnce();
  });
});
