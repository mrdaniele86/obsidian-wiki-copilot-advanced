import { describe, expect, it } from "vitest";
import { WikiSearchIndex } from "../src/core/search-index";
import type { KnowledgeProfile, NoteMetadata } from "../src/core/types";
import {
  createFileManifest,
  diffFileManifests,
  INDEX_CACHE_VERSION,
  indexSettingsKey,
  parseIndexCacheSnapshot
} from "../src/obsidian/index-cache";
import type { IndexCacheSnapshot } from "../src/obsidian/index-cache";
import type { WikiCopilotSettings } from "../src/settings";

const profile: KnowledgeProfile = {
  autoDetected: true,
  warnings: [],
  schemaFiles: ["AGENTS.md"],
  indexFiles: ["index.md"],
  wikiRoots: ["wiki"],
  stableSourceRoots: ["raw/processed"],
  pendingSourceRoots: ["raw/pending"],
  excludedRoots: [".obsidian"]
};

const settings: WikiCopilotSettings = {
  autoDetectProfile: true,
  profile,
  retrievalRange: "medium",
  retrieval: {
    includePending: false,
    includeOtherNotes: false,
    maxIndexResults: 1,
    maxTopicConceptResults: 2,
    maxSummaryResults: 5,
    maxWikiResults: 3,
    maxStableSourceResults: 4,
    maxPendingResults: 2,
    maxRetrievedPages: 24,
    maxEvidenceFiles: 5,
    maxContextCharacters: 18_000,
    graphExpansion: true
  },
  prioritizeActiveNote: true,
  model: {
    provider: "deepseek",
    serviceName: "",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  }
};

function snapshot(): IndexCacheSnapshot {
  const searchIndex = new WikiSearchIndex();
  const metadata: NoteMetadata = {
    path: "wiki/concepts/MS6.md",
    basename: "MS6",
    aliases: [],
    tags: [],
    role: "concept"
  };
  searchIndex.replaceNote(metadata, "# MS6\n\n功耗说明");
  return {
    version: INDEX_CACHE_VERSION,
    createdAt: 1,
    settingsKey: indexSettingsKey(settings),
    profile,
    queryGuidance: "优先检索 Wiki。",
    files: [{ path: metadata.path, mtime: 10, size: 20 }],
    searchIndex: searchIndex.createSnapshot(),
    sourceCatalog: [],
    evidenceReferences: []
  };
}

describe("index cache metadata", () => {
  it("round-trips a valid cache and rejects corrupt data", () => {
    expect(parseIndexCacheSnapshot(JSON.stringify(snapshot()))).not.toBeNull();
    expect(parseIndexCacheSnapshot("{broken")).toBeNull();
    expect(parseIndexCacheSnapshot(JSON.stringify({ ...snapshot(), version: 999 }))).toBeNull();
  });

  it("detects added, changed, and removed Markdown files", () => {
    const cached = createFileManifest([
      { path: "wiki/a.md", stat: { mtime: 1, size: 10 } },
      { path: "wiki/removed.md", stat: { mtime: 1, size: 10 } }
    ]);
    const current = createFileManifest([
      { path: "wiki/a.md", stat: { mtime: 2, size: 10 } },
      { path: "wiki/added.md", stat: { mtime: 1, size: 5 } }
    ]);

    expect(diffFileManifests(cached, current)).toEqual({
      changedPaths: ["wiki/a.md", "wiki/added.md"],
      removedPaths: ["wiki/removed.md"]
    });
  });

  it("invalidates for structural retrieval changes but not model changes", () => {
    const original = indexSettingsKey(settings);
    expect(indexSettingsKey({
      ...settings,
      model: { ...settings.model, model: "deepseek-v4-pro" }
    })).toBe(original);
    expect(indexSettingsKey({
      ...settings,
      retrievalRange: "high",
      retrieval: {
        ...settings.retrieval,
        maxSummaryResults: 12,
        maxRetrievedPages: 36,
        maxEvidenceFiles: 12,
        maxContextCharacters: 48_000
      }
    })).toBe(original);
    expect(indexSettingsKey({
      ...settings,
      retrieval: { ...settings.retrieval, includePending: true }
    })).not.toBe(original);
  });
});
