import { describe, expect, it } from "vitest";
import { createTranslator, resolveUiLanguage } from "../src/i18n";

describe("UI language resolution", () => {
  it("uses Obsidian or system language for Auto and falls back to English", () => {
    expect(resolveUiLanguage("auto", "it-IT")).toBe("it");
    expect(resolveUiLanguage("auto", "zh-Hans")).toBe("zh");
    expect(resolveUiLanguage("auto", "fr-FR")).toBe("en");
  });

  it("localizes the strict missing-identifier fallback in every supported language", () => {
    for (const language of ["en", "it", "zh"] as const) {
      expect(createTranslator(language)("main.answer.missingIdentifier", { identifiers: "MS6" }))
        .toContain("MS6");
    }
  });
});
