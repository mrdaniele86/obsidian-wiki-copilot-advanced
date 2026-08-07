import { describe, expect, it, vi } from "vitest";

const { MockTFile } = vi.hoisted(() => ({
  MockTFile: class {
    extension = "md";
    name: string;
    basename: string;

    constructor(
      readonly path: string,
      readonly stat: { mtime: number; size: number }
    ) {
      this.name = path.split("/").at(-1) ?? path;
      this.basename = this.name.replace(/\.md$/iu, "");
    }
  }
}));

vi.mock("obsidian", () => ({
  getAllTags: () => [],
  MetadataCache: class {},
  TFile: MockTFile,
  Vault: class {}
}));

import { WikiSearchIndex } from "../src/core/search-index";
import type { KnowledgeProfile, NoteMetadata } from "../src/core/types";
import { IndexCoordinator } from "../src/obsidian/index-coordinator";
import {
  createFileManifest,
  INDEX_CACHE_VERSION,
  indexSettingsKey
} from "../src/obsidian/index-cache";
import type { IndexCacheRepository, IndexCacheSnapshot } from "../src/obsidian/index-cache";
import type { WikiCopilotSettings } from "../src/settings";

const profile: KnowledgeProfile = {
  autoDetected: true,
  warnings: [],
  schemaFiles: [],
  indexFiles: [],
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

describe("cached index startup", () => {
  it("becomes ready without reading Markdown when the file manifest is unchanged", async () => {
    const files = [
      new MockTFile("wiki/concepts/MS6.md", { mtime: 10, size: 100 }),
      new MockTFile("raw/processed/ms6.md", { mtime: 20, size: 200 })
    ];
    const searchIndex = new WikiSearchIndex();
    const metadata: NoteMetadata = {
      path: files[0]!.path,
      basename: "MS6",
      aliases: [],
      tags: [],
      role: "concept"
    };
    searchIndex.replaceNote(metadata, "# MS6\n\n功耗说明");
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(files),
      searchIndex: searchIndex.createSnapshot(),
      sourceCatalog: [{
        id: files[1]!.path,
        path: files[1]!.path,
        title: "MS6 原文",
        aliases: "",
        tags: "",
        headings: "功耗",
        role: "stable-source"
      }],
      evidenceReferences: []
    };
    const repository: IndexCacheRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const vault = {
      getMarkdownFiles: vi.fn(() => files),
      cachedRead: vi.fn(async () => {
        throw new Error("unchanged startup must not read Markdown");
      }),
      getAbstractFileByPath: vi.fn((path: string) => files.find((file) => file.path === path) ?? null)
    };
    const metadataCache = {
      resolvedLinks: {},
      getFileCache: vi.fn(() => null)
    };
    const coordinator = new IndexCoordinator(
      vault as never,
      metadataCache as never,
      () => settings,
      repository
    );

    await coordinator.initialize();

    expect(coordinator.currentStatus.state).toBe("ready");
    expect(coordinator.searchIndex.search("MS6功耗")).toHaveLength(1);
    expect(vault.cachedRead).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it("defers schema-triggered rebuilds during a running session", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });

    const detectedProfile: KnowledgeProfile = {
      ...profile,
      schemaFiles: ["AGENTS.md"]
    };
    let files = [
      new MockTFile("AGENTS.md", { mtime: 10, size: 100 }),
      new MockTFile("wiki/concepts/MS6.md", { mtime: 20, size: 200 })
    ];
    const searchIndex = new WikiSearchIndex();
    searchIndex.replaceNote({
      path: files[1]!.path,
      basename: "MS6",
      aliases: [],
      tags: [],
      role: "concept"
    }, "# MS6\n\n功耗说明");
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile: detectedProfile,
      queryGuidance: "",
      files: createFileManifest(files),
      searchIndex: searchIndex.createSnapshot(),
      sourceCatalog: [],
      evidenceReferences: []
    };
    const repository: IndexCacheRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const vault = {
      getMarkdownFiles: vi.fn(() => files),
      cachedRead: vi.fn(async () => {
        throw new Error("a runtime schema event must not start a full rebuild");
      }),
      getAbstractFileByPath: vi.fn(() => null)
    };
    const coordinator = new IndexCoordinator(
      vault as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository
    );

    try {
      await coordinator.initialize();
      const changedSchema = new MockTFile("AGENTS.md", { mtime: 30, size: 120 });
      files = [changedSchema, files[1]!];
      coordinator.scheduleFileUpdate(changedSchema as never);

      await vi.advanceTimersByTimeAsync(600);

      expect(coordinator.currentStatus.state).toBe("ready");
      expect(vault.cachedRead).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    } finally {
      coordinator.destroy();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("rebuilds on the next launch after a cached schema fingerprint changes", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });

    const detectedProfile: KnowledgeProfile = {
      ...profile,
      schemaFiles: ["AGENTS.md"]
    };
    const cachedFiles = [
      new MockTFile("AGENTS.md", { mtime: 10, size: 100 }),
      new MockTFile("wiki/concepts/MS6.md", { mtime: 20, size: 200 })
    ];
    const currentFiles = [
      new MockTFile("AGENTS.md", { mtime: 30, size: 120 }),
      cachedFiles[1]!
    ];
    const emptyIndex = new WikiSearchIndex();
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile: detectedProfile,
      queryGuidance: "",
      files: createFileManifest(cachedFiles),
      searchIndex: emptyIndex.createSnapshot(),
      sourceCatalog: [],
      evidenceReferences: []
    };
    const repository: IndexCacheRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const vault = {
      getMarkdownFiles: vi.fn(() => currentFiles),
      cachedRead: vi.fn(async (file: { path: string }) => file.path === "AGENTS.md"
        ? "Use `wiki/` as the maintained wiki."
        : "# MS6\n\n功耗说明"),
      getAbstractFileByPath: vi.fn(() => null)
    };
    const coordinator = new IndexCoordinator(
      vault as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository
    );

    try {
      await coordinator.initialize();

      expect(coordinator.currentStatus.state).toBe("ready");
      expect(vault.cachedRead).toHaveBeenCalledWith(currentFiles[0]);
      expect(vault.cachedRead).toHaveBeenCalledWith(currentFiles[1]);
    } finally {
      coordinator.destroy();
      vi.unstubAllGlobals();
    }
  });
});
