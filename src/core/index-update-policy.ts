import type { KnowledgeProfile } from "./types";

export type IndexUpdateKind = "change" | "remove";

const SCHEMA_FILE_NAMES = new Set(["agents.md", "claude.md", "gemini.md"]);

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

function includesPath(paths: readonly string[], candidate: string): boolean {
  const normalized = normalizePath(candidate);
  return paths.some((path) => normalizePath(path) === normalized);
}

/** Returns whether a metadata event is already represented by the index snapshot. */
export function isMetadataEventCovered(
  indexedModifiedAt: number | undefined,
  fileModifiedAt: number
): boolean {
  return indexedModifiedAt !== undefined && fileModifiedAt <= indexedModifiedAt;
}

/**
 * Schema content and structural additions/removals can change path roles and
 * therefore require profile discovery. Editing an already-known index page
 * only changes searchable content and can be handled incrementally.
 */
export function requiresFullProfileRebuild(
  path: string,
  profile: KnowledgeProfile,
  kind: IndexUpdateKind
): boolean {
  const knownSchema = includesPath(profile.schemaFiles, path);
  const knownIndex = includesPath(profile.indexFiles, path);

  if (kind === "remove") {
    return knownSchema || knownIndex;
  }
  if (knownSchema) {
    return true;
  }
  if (knownIndex || !profile.autoDetected) {
    return false;
  }

  const fileName = normalizePath(path).split("/").at(-1) ?? "";
  return SCHEMA_FILE_NAMES.has(fileName) || fileName === "index.md";
}
