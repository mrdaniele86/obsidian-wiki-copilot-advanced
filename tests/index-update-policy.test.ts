import { describe, expect, it } from "vitest";
import {
  isMetadataEventCovered,
  requiresFullProfileRebuild
} from "../src/core/index-update-policy";
import type { KnowledgeProfile } from "../src/core/types";

const profile: KnowledgeProfile = {
  schemaFiles: ["AGENTS.md"],
  indexFiles: ["index.md", "wiki/index.md"],
  wikiRoots: ["wiki"],
  stableSourceRoots: ["raw/processed"],
  pendingSourceRoots: ["raw/pending"],
  excludedRoots: [".obsidian"],
  autoDetected: true,
  warnings: []
};

describe("index update policy", () => {
  it("drops replayed metadata events but preserves edits made during a build", () => {
    expect(isMetadataEventCovered(2_000, 1_900)).toBe(true);
    expect(isMetadataEventCovered(2_000, 2_000)).toBe(true);
    expect(isMetadataEventCovered(2_000, 2_001)).toBe(false);
    expect(isMetadataEventCovered(undefined, 1_900)).toBe(false);
  });

  it("updates known index pages incrementally", () => {
    expect(requiresFullProfileRebuild("index.md", profile, "change")).toBe(false);
    expect(requiresFullProfileRebuild("wiki/index.md", profile, "change")).toBe(false);
  });

  it("rebuilds for schema changes and structural index changes", () => {
    expect(requiresFullProfileRebuild("AGENTS.md", profile, "change")).toBe(true);
    expect(requiresFullProfileRebuild("index.md", profile, "remove")).toBe(true);
    expect(requiresFullProfileRebuild("new-area/index.md", profile, "change")).toBe(true);
  });

  it("does not rebuild for ordinary note updates", () => {
    expect(requiresFullProfileRebuild("wiki/topics/制动.md", profile, "change")).toBe(false);
  });
});
