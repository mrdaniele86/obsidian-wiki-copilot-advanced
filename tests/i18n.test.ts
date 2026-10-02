import { describe, expect, it } from "vitest";
import { resolveUiLanguage } from "../src/i18n";

describe("UI language resolution", () => {
  it("uses Obsidian or system language for Auto and falls back to English", () => {
    expect(resolveUiLanguage("auto", "it-IT")).toBe("it");
    expect(resolveUiLanguage("auto", "zh-Hans")).toBe("zh");
    expect(resolveUiLanguage("auto", "fr-FR")).toBe("en");
  });
});
