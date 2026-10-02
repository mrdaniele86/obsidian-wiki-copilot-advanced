import { en } from "./en";
import { it } from "./it";
import { zh } from "./zh";

export type UiLanguage = "auto" | "it" | "en" | "zh";
export type ResolvedUiLanguage = Exclude<UiLanguage, "auto">;
export type TranslationKey = keyof typeof en;
export type TranslationVariables = Record<string, string | number>;

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "auto" || value === "it" || value === "en" || value === "zh";
}

export function resolveUiLanguage(preference: UiLanguage, locale?: string): ResolvedUiLanguage {
  if (preference !== "auto") return preference;
  const normalized = locale?.toLowerCase() ?? "";
  if (normalized.startsWith("it")) return "it";
  if (normalized.startsWith("zh")) return "zh";
  return "en";
}

const dictionaries = { en, it, zh } as const;

export function translate(
  language: ResolvedUiLanguage,
  key: TranslationKey,
  variables: TranslationVariables = {}
): string {
  return dictionaries[language][key].replace(/\{\{(\w+)\}\}/gu, (_, name: string) => String(variables[name] ?? ""));
}

export function createTranslator(language: ResolvedUiLanguage): (
  key: TranslationKey,
  variables?: TranslationVariables
) => string {
  return (key, variables) => translate(language, key, variables);
}
