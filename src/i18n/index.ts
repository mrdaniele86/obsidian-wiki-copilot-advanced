export type UiLanguage = "auto" | "it" | "en" | "zh";
export type ResolvedUiLanguage = Exclude<UiLanguage, "auto">;

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
