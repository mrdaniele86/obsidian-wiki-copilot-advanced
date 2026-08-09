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

describe("retrieval range settings", () => {
  it("uses the medium range by default", () => {
    const settings = loadWikiCopilotSettings(undefined);

    expect(settings.retrievalRange).toBe("medium");
    expect(settings.retrieval).toMatchObject({
      maxSummaryResults: 8,
      maxRetrievedPages: 24,
      maxEvidenceFiles: 8,
      maxContextCharacters: 30_000
    });
    expect(DEFAULT_SETTINGS.retrievalRange).toBe("medium");
  });

  it("restores the selected range and derives all retrieval limits from it", () => {
    const settings = loadWikiCopilotSettings({ retrievalRange: "high" });

    expect(settings.retrievalRange).toBe("high");
    expect(settings.retrieval).toMatchObject({
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

  it("uses a 12-page budget for the low range", () => {
    const settings = loadWikiCopilotSettings({ retrievalRange: "low" });

    expect(settings.retrievalRange).toBe("low");
    expect(settings.retrieval).toMatchObject({
      maxRetrievedPages: 12,
      maxEvidenceFiles: 4,
      maxContextCharacters: 18_000
    });
  });

  it("falls back safely when the saved range is invalid", () => {
    const settings = loadWikiCopilotSettings({ retrievalRange: "extreme" });

    expect(settings.retrievalRange).toBe("medium");
    expect(settings.retrieval.maxContextCharacters).toBe(30_000);
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
  it("marks the plugin introduction for spacious mobile styling", () => {
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
    expect(setting.setHeading).toHaveBeenCalledOnce();
  });
});
