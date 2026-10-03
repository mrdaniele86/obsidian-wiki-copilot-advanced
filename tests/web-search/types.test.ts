import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { WebSearchResult, WebSource } from "../../src/web-search/types";

vi.mock("obsidian", () => ({
  App: class {},
  PluginSettingTab: class {}
}));

import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  loadWikiCopilotSettings
} from "../../src/settings";

describe("web-search contracts", () => {
  it("defines Gemini results with typed sources", () => {
    const source: WebSource = {
      title: "Google AI",
      url: "https://ai.google/"
    };
    const result: WebSearchResult = {
      provider: "gemini",
      model: "gemini-2.5-flash",
      answer: "A concise answer.",
      sources: [source]
    };

    expect(result).toEqual({
      provider: "gemini",
      model: "gemini-2.5-flash",
      answer: "A concise answer.",
      sources: [{ title: "Google AI", url: "https://ai.google/" }]
    });
    expectTypeOf(result.provider).toEqualTypeOf<"gemini">();
    expectTypeOf(result.sources).toEqualTypeOf<WebSource[]>();
  });
});

describe("web-search settings loader", () => {
  it("uses the expected disabled Gemini defaults", () => {
    expect(DEFAULT_WEB_SEARCH_SETTINGS).toEqual({
      mode: "disabled",
      geminiModel: "gemini-2.5-flash",
      includeRecentChatContext: false
    });
    expect(loadWikiCopilotSettings(undefined).webSearch).toEqual(
      DEFAULT_WEB_SEARCH_SETTINGS
    );
  });

  it("falls back to defaults for a malformed mode", () => {
    expect(loadWikiCopilotSettings({ webSearch: {
      mode: "not-a-real-mode",
      geminiModel: "gemini-3-flash-preview"
    } }).webSearch).toEqual({
      mode: "disabled",
      geminiModel: "gemini-3-flash-preview",
      includeRecentChatContext: false
    });
  });
});
