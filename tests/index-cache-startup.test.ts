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
  indexSettingsKey,
  MOBILE_INDEX_CACHE_SNAPSHOT_POLICY
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
  language: "auto",
  conversationFolder: "Memory Copilot/Conversations",
  autoDetectProfile: true,
  profile,
  retrievalMode: "fast",
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
  },
  webSearch: {
    mode: "disabled",
    geminiModel: "gemini-2.5-flash"
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
      linkGraph: [[files[0]!.path, [[files[1]!.path, 1]]]]
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
      get resolvedLinks(): never {
        throw new Error("unchanged startup must restore the cached link graph");
      },
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
    expect(coordinator.linkGraph.neighbors(files[0]!.path)[0]?.path).toBe(files[1]!.path);
    expect(vault.cachedRead).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it("repairs a missing device-local model family from vault filenames", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const files = [
      new MockTFile("wiki/concepts/XY.md", { mtime: 10, size: 100 }),
      new MockTFile("raw/processed/MS6-ports.md", { mtime: 20, size: 200 })
    ];
    const searchIndex = new WikiSearchIndex();
    searchIndex.replaceNote({
      path: files[0]!.path,
      basename: "XY",
      aliases: [],
      tags: [],
      role: "concept"
    }, "# XY 端口\n\n端口重定义参数");
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(files),
      searchIndex: searchIndex.createSnapshot(),
      sourceCatalog: [],
      linkGraph: []
    };
    const repository: IndexCacheRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const coordinator = new IndexCoordinator(
      {
        adapter: {
          list: vi.fn(async () => ({ files: [], folders: [] })),
          read: vi.fn(async () => "")
        },
        getMarkdownFiles: vi.fn(() => files),
        cachedRead: vi.fn(async () => ""),
        getAbstractFileByPath: vi.fn((path: string) => files.find((file) => file.path === path) ?? null)
      } as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository,
      { lowMemory: true }
    );

    try {
      await coordinator.initialize();
      expect(await coordinator.sourceCatalog.searchAsync("所有ms6端口定义", false)).toHaveLength(0);

      const repaired = await coordinator.repairTechnicalIdentifierCoverage("ms6端口定义");

      expect(repaired).toBe(1);
      expect((await coordinator.sourceCatalog.searchAsync("ms6端口定义", false))[0]?.path)
        .toBe("raw/processed/MS6-ports.md");
    } finally {
      coordinator.destroy();
      vi.unstubAllGlobals();
    }
  });

  it("caches a negative device identifier scan instead of rescanning the same roots", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const files = [new MockTFile("wiki/concepts/overview.md", { mtime: 10, size: 100 })];
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(files),
      searchIndex: new WikiSearchIndex({ compactDocuments: true })
        .createSnapshot({ includeSerializedIndex: false }),
      sourceCatalog: [],
      linkGraph: []
    };
    const repository: IndexCacheRepository = {
      snapshotPolicy: MOBILE_INDEX_CACHE_SNAPSHOT_POLICY,
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const adapter = {
      list: vi.fn(async () => ({ files: [], folders: [] })),
      read: vi.fn(async () => "")
    };
    const coordinator = new IndexCoordinator(
      {
        adapter,
        getMarkdownFiles: vi.fn(() => files),
        cachedRead: vi.fn(async () => "# Overview"),
        getAbstractFileByPath: vi.fn(() => null)
      } as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository,
      { lowMemory: true }
    );

    try {
      await coordinator.initialize();

      expect(await coordinator.repairTechnicalIdentifierCoverage("AB12 definition")).toBe(0);
      expect(await coordinator.repairTechnicalIdentifierCoverage("AB12 definition")).toBe(0);
      expect(adapter.list).toHaveBeenCalledTimes(1);
      expect(adapter.read).not.toHaveBeenCalled();
    } finally {
      coordinator.destroy();
      vi.unstubAllGlobals();
    }
  });

  it("repairs a missing mobile Wiki page with an index-free bounded content scan", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const files = [
      new MockTFile("wiki/concepts/service-note.md", { mtime: 10, size: 160 })
    ];
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(files),
      searchIndex: new WikiSearchIndex({ compactDocuments: true })
        .createSnapshot({ includeSerializedIndex: false }),
      sourceCatalog: [],
      linkGraph: []
    };
    const repository: IndexCacheRepository = {
      snapshotPolicy: MOBILE_INDEX_CACHE_SNAPSHOT_POLICY,
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const vault = {
      adapter: { list: vi.fn(async () => ({ files: [], folders: [] })) },
      getMarkdownFiles: vi.fn(() => files),
      cachedRead: vi.fn(async () => "# 服务说明\n\n消防员服务用于消防运行场景。"),
      getAbstractFileByPath: vi.fn((path: string) => files.find((file) => file.path === path) ?? null)
    };
    const coordinator = new IndexCoordinator(
      vault as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository,
      { lowMemory: true }
    );

    try {
      await coordinator.initialize();
      expect(coordinator.searchIndex.search("消防员服务定义")).toHaveLength(0);

      const repaired = await coordinator.repairLexicalCoverage("消防员服务定义");

      expect(repaired).toBe(1);
      expect(coordinator.searchIndex.search("消防员服务定义")).not.toHaveLength(0);
      expect(coordinator.getDiagnostics(files[0]!.path).activePath).toMatchObject({
        indexed: true,
        role: "concept",
        chunks: 1
      });
      expect(vault.cachedRead).toHaveBeenCalledOnce();
    } finally {
      coordinator.destroy();
      vi.unstubAllGlobals();
    }
  });

  it("discovers an exact model source through the adapter when Metadata Cache is incomplete", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const visibleFiles = [new MockTFile("wiki/concepts/XY.md", { mtime: 10, size: 100 })];
    const sourcePath = "raw/processed/MS6-V-WT-H-power.md";
    const searchIndex = new WikiSearchIndex({ compactDocuments: true });
    searchIndex.replaceNote({
      path: visibleFiles[0]!.path,
      basename: "XY",
      aliases: [],
      tags: [],
      role: "concept"
    }, "# XY\n\n端口说明");
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(visibleFiles),
      searchIndex: searchIndex.createSnapshot({ includeSerializedIndex: false }),
      sourceCatalog: [],
      linkGraph: []
    };
    const repository: IndexCacheRepository = {
      snapshotPolicy: MOBILE_INDEX_CACHE_SNAPSHOT_POLICY,
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const adapter = {
      list: vi.fn(async (path: string) => {
        if (path === "") {
          return { files: [], folders: ["raw"] };
        }
        if (path === "raw") {
          return { files: [], folders: ["raw/processed"] };
        }
        return path === "raw/processed"
          ? { files: [sourcePath], folders: [] }
          : { files: [], folders: [] };
      }),
      read: vi.fn(async (path: string) => path === sourcePath
        ? "# MS6-V-WT-H\n\n最大功耗为 0.8W。"
        : "")
    };
    const coordinator = new IndexCoordinator(
      {
        adapter,
        getMarkdownFiles: vi.fn(() => visibleFiles),
        cachedRead: vi.fn(async () => "# XY\n\n端口说明"),
        getAbstractFileByPath: vi.fn(() => null)
      } as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository,
      { lowMemory: true }
    );

    try {
      const progressMessages: string[] = [];
      await coordinator.initialize();
      const repaired = await coordinator.repairTechnicalIdentifierCoverage("所有ms6功耗");
      const fastResult = await coordinator.retriever.retrieve("所有ms6功耗", settings.retrieval);
      const preciseResult = await coordinator.retrieveAllMarkdown(
        "所有ms6功耗",
        ["所有ms6功耗", "MS6 power consumption"],
        { ...settings.retrieval, includePending: true },
        (message) => progressMessages.push(message)
      );

      expect(repaired).toBe(1);
      expect(fastResult.chunks).toHaveLength(0);
      expect(preciseResult.chunks).toHaveLength(1);
      expect(preciseResult.chunks[0]?.path).toBe(sourcePath);
      expect(preciseResult.chunks[0]?.text).toContain("0.8W");
      expect(adapter.list).toHaveBeenCalledWith("raw/processed");
      expect(progressMessages).toContain("scanning");
      expect(progressMessages).toContain("extracting");
      expect(progressMessages.some((message) => /\d+\/\d+/u.test(message))).toBe(false);
    } finally {
      coordinator.destroy();
      vi.unstubAllGlobals();
    }
  });

  it("upgrades a legacy cache by persisting the rebuilt Wikilink graph", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const files = [
      new MockTFile("wiki/a.md", { mtime: 10, size: 100 }),
      new MockTFile("wiki/b.md", { mtime: 20, size: 100 })
    ];
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(files),
      searchIndex: new WikiSearchIndex().createSnapshot(),
      sourceCatalog: []
    };
    const repository: IndexCacheRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const coordinator = new IndexCoordinator(
      {
        getMarkdownFiles: vi.fn(() => files),
        cachedRead: vi.fn(async () => ""),
        getAbstractFileByPath: vi.fn(() => null)
      } as never,
      {
        resolvedLinks: { "wiki/a.md": { "wiki/b.md": 1 } },
        getFileCache: vi.fn(() => null)
      } as never,
      () => settings,
      repository
    );

    try {
      await coordinator.initialize();
      await vi.runAllTimersAsync();

      expect(coordinator.linkGraph.neighbors("wiki/a.md")[0]?.path).toBe("wiki/b.md");
      expect(repository.save).toHaveBeenCalledOnce();
      expect(vi.mocked(repository.save).mock.calls[0]?.[0].linkGraph)
        .toEqual([["wiki/a.md", [["wiki/b.md", 1]]]]);
    } finally {
      coordinator.destroy();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("persists a low-memory mobile snapshot without serializing MiniSearch", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const files = [new MockTFile("wiki/a.md", { mtime: 10, size: 100 })];
    const repository: IndexCacheRepository = {
      snapshotPolicy: MOBILE_INDEX_CACHE_SNAPSHOT_POLICY,
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined)
    };
    const coordinator = new IndexCoordinator(
      {
        configDir: ".obsidian",
        getMarkdownFiles: vi.fn(() => files),
        cachedRead: vi.fn(async () => [
          "# A",
          "Mobile knowledge",
          "## First section",
          "First details",
          "## Second section",
          "Second details"
        ].join("\n\n")),
        getAbstractFileByPath: vi.fn(() => null)
      } as never,
      {
        resolvedLinks: { "wiki/a.md": { "wiki/b.md": 1 } },
        getFileCache: vi.fn(() => null)
      } as never,
      () => settings,
      repository,
      { lowMemory: true }
    );

    try {
      await coordinator.initialize();
      await vi.runAllTimersAsync();

      expect(repository.save).toHaveBeenCalledOnce();
      const saved = vi.mocked(repository.save).mock.calls[0]?.[0];
      expect(saved?.searchIndex.index).toBeNull();
      expect(saved?.searchIndex.documents).toHaveLength(1);
      expect(saved?.linkGraph).toEqual([["wiki/a.md", [["wiki/b.md", 1]]]]);
    } finally {
      coordinator.destroy();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps cached mobile results when iCloud exposes only a small part of the vault", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const cachedFiles = [
      new MockTFile("wiki/concepts/MS6.md", { mtime: 10, size: 100 }),
      ...Array.from({ length: 100 }, (_, index) =>
        new MockTFile(`wiki/notes/note-${index}.md`, { mtime: index + 20, size: 100 }))
    ];
    const currentFiles = cachedFiles.slice(1, 11);
    const searchIndex = new WikiSearchIndex({ compactDocuments: true });
    searchIndex.replaceNote({
      path: cachedFiles[0]!.path,
      basename: "MS6",
      aliases: [],
      tags: [],
      role: "concept"
    }, "# MS6\n\n功耗说明");
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: 1,
      settingsKey: indexSettingsKey(settings),
      profile,
      queryGuidance: "",
      files: createFileManifest(cachedFiles),
      searchIndex: searchIndex.createSnapshot({ includeSerializedIndex: false }),
      sourceCatalog: [],
      linkGraph: []
    };
    const repository: IndexCacheRepository = {
      snapshotPolicy: MOBILE_INDEX_CACHE_SNAPSHOT_POLICY,
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined)
    };
    const vault = {
      getMarkdownFiles: vi.fn(() => currentFiles),
      cachedRead: vi.fn(async () => {
        throw new Error("an incomplete iCloud manifest must not erase or rebuild cached notes");
      }),
      getAbstractFileByPath: vi.fn(() => null)
    };
    const coordinator = new IndexCoordinator(
      vault as never,
      { resolvedLinks: {}, getFileCache: vi.fn(() => null) } as never,
      () => settings,
      repository,
      { lowMemory: true }
    );

    try {
      await coordinator.initialize();

      expect(coordinator.currentStatus.state).toBe("ready");
      expect(coordinator.searchIndex.search("MS6功耗")).toHaveLength(1);
      expect(vault.cachedRead).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    } finally {
      coordinator.destroy();
      vi.unstubAllGlobals();
    }
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
      linkGraph: []
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
      linkGraph: []
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
