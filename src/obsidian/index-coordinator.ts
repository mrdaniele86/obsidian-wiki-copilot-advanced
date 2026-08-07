import { getAllTags, MetadataCache, TFile, Vault } from "obsidian";
import { CooperativeScheduler, yieldToUi } from "../core/cooperative";
import { EvidenceReferenceMap } from "../core/evidence-references";
import { HybridWikiRetriever } from "../core/hybrid-retriever";
import type { EvidenceNote } from "../core/hybrid-retriever";
import {
  isMetadataEventCovered,
  requiresFullProfileRebuild
} from "../core/index-update-policy";
import { waitForReadyStatus } from "../core/index-readiness";
import { LinkGraph } from "../core/link-graph";
import {
  classifyKnowledgePath,
  discoverKnowledgeProfile,
  extractQueryGuidance,
  isExcludedPath
} from "../core/profile";
import { WikiSearchIndex } from "../core/search-index";
import { SourceCatalogIndex } from "../core/source-catalog";
import type { SourceCatalogDocument } from "../core/source-catalog";
import type { KnowledgeProfile, KnowledgeRole, NoteMetadata } from "../core/types";
import type { WikiCopilotSettings } from "../settings";
import {
  createFileManifest,
  diffFileManifests,
  INDEX_CACHE_VERSION,
  indexSettingsKey
} from "./index-cache";
import type { IndexCacheRepository, IndexCacheSnapshot } from "./index-cache";

export type IndexState = "idle" | "building" | "ready" | "error";

export interface IndexStatus {
  state: IndexState;
  processedFiles: number;
  totalFiles: number;
  indexedFiles: number;
  chunks: number;
  message: string;
}

type StatusListener = (status: IndexStatus) => void;
type IndexOutcome = "primary" | "catalog" | "skipped";

const PRIMARY_ROLE_ORDER: Readonly<Record<KnowledgeRole, number>> = {
  index: 0,
  topic: 1,
  concept: 2,
  summary: 3,
  wiki: 4,
  other: 5,
  schema: 6,
  "stable-source": 7,
  "pending-source": 8
};

function aliasesFromFrontmatter(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const SOURCE_HEADING_INDEX_CHARACTERS = 6_000;

function compactHeadings(headings: readonly string[]): string {
  const normalized = headings.map((heading) => heading.trim()).filter(Boolean);
  const joined = normalized.join(" ");
  if (joined.length <= SOURCE_HEADING_INDEX_CHARACTERS) {
    return joined;
  }

  const sampleCount = Math.min(80, normalized.length);
  const perHeading = Math.max(
    24,
    Math.floor((SOURCE_HEADING_INDEX_CHARACTERS - sampleCount) / Math.max(1, sampleCount))
  );
  const sampled: string[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const index = sampleCount === 1
      ? 0
      : Math.round(sample * (normalized.length - 1) / (sampleCount - 1));
    const heading = normalized[index];
    if (heading) {
      sampled.push(heading.slice(0, perHeading));
    }
  }
  return sampled.join(" ").slice(0, SOURCE_HEADING_INDEX_CHARACTERS);
}

export class IndexCoordinator {
  readonly searchIndex: WikiSearchIndex;
  readonly sourceCatalog: SourceCatalogIndex;
  readonly evidenceReferences: EvidenceReferenceMap;
  readonly linkGraph: LinkGraph;
  readonly retriever: HybridWikiRetriever;

  profile: KnowledgeProfile | null = null;
  queryGuidance = "";

  private status: IndexStatus = {
    state: "idle",
    processedFiles: 0,
    totalFiles: 0,
    indexedFiles: 0,
    chunks: 0,
    message: "等待建立索引"
  };
  private readonly listeners = new Set<StatusListener>();
  private generation = 0;
  private graphGeneration = 0;
  private buildPromise: Promise<void> | null = null;
  private fileUpdateTimer: number | null = null;
  private cacheWriteTimer: number | null = null;
  private cacheWriteChain: Promise<void> = Promise.resolve();
  private pendingFiles = new Map<string, TFile | null>();
  private indexedFileMtimes = new Map<string, number>();
  private activeBuildFileMtimes: Map<string, number> | null = null;
  private profileRefreshPending = false;
  private fileUpdateInProgress = false;

  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly getSettings: () => WikiCopilotSettings,
    private readonly cacheRepository: IndexCacheRepository | null = null
  ) {
    this.searchIndex = new WikiSearchIndex();
    this.sourceCatalog = new SourceCatalogIndex();
    this.evidenceReferences = new EvidenceReferenceMap();
    this.linkGraph = new LinkGraph();
    this.retriever = new HybridWikiRetriever(
      this.searchIndex,
      this.linkGraph,
      this.sourceCatalog,
      this.evidenceReferences,
      (paths) => this.loadEvidence(paths)
    );
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  get currentStatus(): IndexStatus {
    return this.status;
  }

  async ensureReady(): Promise<void> {
    if (this.status.state === "ready") {
      return;
    }
    await this.initialize();
    await this.waitUntilReady();
  }

  initialize(): Promise<void> {
    if (this.status.state === "ready") {
      return Promise.resolve();
    }
    return this.startBuild(true);
  }

  rebuild(): Promise<void> {
    return this.startBuild(false);
  }

  private startBuild(allowCacheRestore: boolean): Promise<void> {
    if (this.buildPromise) {
      return this.buildPromise;
    }
    const generation = ++this.generation;
    const operation = allowCacheRestore
      ? this.performInitialLoad(generation)
      : this.performRebuild(generation);
    this.buildPromise = operation.finally(() => {
      if (generation === this.generation) {
        this.buildPromise = null;
        this.activeBuildFileMtimes = null;
      }
    });
    return this.buildPromise;
  }

  async forceRebuild(): Promise<void> {
    const previousBuild = this.buildPromise;
    this.generation += 1;
    if (this.fileUpdateTimer !== null) {
      window.clearTimeout(this.fileUpdateTimer);
      this.fileUpdateTimer = null;
    }
    if (previousBuild) {
      try {
        await previousBuild;
      } catch {
        // The replacement build below reports its own outcome.
      }
    }
    this.buildPromise = null;
    this.activeBuildFileMtimes = null;
    await this.rebuild();
    await this.waitUntilReady();
  }

  scheduleFileUpdate(file: TFile | null, oldPath?: string): void {
    if (file && !oldPath) {
      const coveredMtime = this.activeBuildFileMtimes
        ? this.activeBuildFileMtimes.get(file.path)
        : this.indexedFileMtimes.get(file.path);
      if (isMetadataEventCovered(coveredMtime, file.stat.mtime)) {
        return;
      }
    }
    if (oldPath) {
      this.pendingFiles.set(oldPath, null);
    }
    if (file) {
      this.pendingFiles.set(file.path, file);
    }
    if (this.status.state !== "ready") {
      return;
    }
    this.scheduleFileFlush(350);
  }

  rebuildGraph(): void {
    if (this.status.state === "building") {
      return;
    }
    const graphGeneration = ++this.graphGeneration;
    void this.linkGraph.rebuildAsync(
      this.metadataCache.resolvedLinks,
      () => graphGeneration === this.graphGeneration
    ).then((applied) => {
      if (applied && this.status.state === "ready") {
        this.emit({ ...this.status, message: this.readyMessage() });
      }
    }).catch((error) => {
      console.warn("Wiki Copilot: Wikilink 图谱更新失败。", error);
    });
  }

  destroy(): void {
    this.generation += 1;
    this.graphGeneration += 1;
    if (this.fileUpdateTimer !== null) {
      window.clearTimeout(this.fileUpdateTimer);
      this.fileUpdateTimer = null;
    }
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
    this.sourceCatalog.destroy();
    this.activeBuildFileMtimes = null;
    this.indexedFileMtimes.clear();
    this.listeners.clear();
  }

  private async performInitialLoad(generation: number): Promise<void> {
    const cacheRepository = this.cacheRepository;
    if (!cacheRepository) {
      await this.performRebuild(generation);
      return;
    }

    this.graphGeneration += 1;
    const settings = this.getSettings();
    const markdownFiles = this.vault.getMarkdownFiles();
    const currentManifest = createFileManifest(markdownFiles);
    const currentFileMtimes = new Map(markdownFiles.map((file) => [file.path, file.stat.mtime]));
    this.activeBuildFileMtimes = currentFileMtimes;
    this.pendingFiles.clear();
    this.emit({
      state: "building",
      processedFiles: 0,
      totalFiles: markdownFiles.length,
      indexedFiles: 0,
      chunks: 0,
      message: "正在检查本地索引缓存…"
    });

    const snapshot = await cacheRepository.load();
    if (generation !== this.generation) {
      return;
    }
    if (!snapshot || snapshot.settingsKey !== indexSettingsKey(settings)) {
      await this.performRebuild(generation);
      return;
    }

    const manifestDiff = diffFileManifests(snapshot.files, currentManifest);
    const requiresRebuild = manifestDiff.changedPaths.some((path) =>
      requiresFullProfileRebuild(path, snapshot.profile, "change")
    ) || manifestDiff.removedPaths.some((path) =>
      requiresFullProfileRebuild(path, snapshot.profile, "remove")
    );
    if (requiresRebuild) {
      await this.performRebuild(generation);
      return;
    }

    try {
      this.profile = snapshot.profile;
      this.queryGuidance = snapshot.queryGuidance;
      this.emit({ ...this.status, message: "正在恢复 Wiki 索引…" });
      await this.searchIndex.restoreSnapshot(snapshot.searchIndex);
      if (generation !== this.generation) {
        return;
      }

      this.emit({ ...this.status, message: "正在恢复原文目录…" });
      await this.sourceCatalog.restoreSnapshot(snapshot.sourceCatalog);
      if (generation !== this.generation) {
        return;
      }
      this.evidenceReferences.restoreSnapshot(snapshot.evidenceReferences);
      this.retriever.clearEvidenceCache();
    } catch (error) {
      console.warn("Wiki Copilot: 恢复本地索引缓存失败，将重新构建。", error);
      if (generation === this.generation) {
        await this.performRebuild(generation);
      }
      return;
    }

    this.indexedFileMtimes = new Map(snapshot.files.map((file) => [file.path, file.mtime]));
    for (const path of manifestDiff.removedPaths) {
      this.removePath(path);
    }

    const fileByPath = new Map(markdownFiles.map((file) => [file.path, file]));
    const changedFiles = manifestDiff.changedPaths
      .map((path) => fileByPath.get(path))
      .filter((file): file is TFile => file !== undefined)
      .sort((left, right) => {
        const leftRole = classifyKnowledgePath(left.path, snapshot.profile);
        const rightRole = classifyKnowledgePath(right.path, snapshot.profile);
        const leftSource = leftRole === "stable-source" || leftRole === "pending-source";
        const rightSource = rightRole === "stable-source" || rightRole === "pending-source";
        return Number(rightSource) - Number(leftSource) || left.path.localeCompare(right.path);
      });
    const updateCount = manifestDiff.removedPaths.length + changedFiles.length;
    let updated = manifestDiff.removedPaths.length;
    if (updateCount > 0) {
      this.emit({
        ...this.status,
        message: `正在同步知识库变化 ${updated}/${updateCount}`
      });
    }
    for (const file of changedFiles) {
      if (generation !== this.generation) {
        return;
      }
      await this.updateFile(file, snapshot.profile, settings);
      this.indexedFileMtimes.set(file.path, file.stat.mtime);
      updated += 1;
      this.emit({
        ...this.status,
        message: `正在同步知识库变化 ${updated}/${updateCount}`
      });
      await yieldToUi();
    }

    this.emit({ ...this.status, message: "正在恢复知识关联…" });
    const graphBuilt = await this.linkGraph.rebuildAsync(
      this.metadataCache.resolvedLinks,
      () => generation === this.generation
    );
    if (!graphBuilt || generation !== this.generation) {
      return;
    }
    this.indexedFileMtimes = currentFileMtimes;
    const stats = this.searchIndex.stats;
    const totalFiles = stats.files + this.sourceCatalog.size;
    this.emit({
      state: "ready",
      processedFiles: totalFiles,
      totalFiles,
      indexedFiles: totalFiles,
      chunks: stats.documents,
      message: this.readyMessage()
    });
    if (updateCount > 0) {
      this.scheduleCacheWrite(0);
    }
    if (this.pendingFiles.size > 0) {
      this.scheduleFileFlush(0);
    }
  }

  private async performRebuild(generation: number): Promise<void> {
    this.graphGeneration += 1;
    this.profileRefreshPending = false;
    const settings = this.getSettings();
    const markdownFiles = this.vault.getMarkdownFiles();
    const buildFileMtimes = new Map(markdownFiles.map((file) => [file.path, file.stat.mtime]));
    this.activeBuildFileMtimes = buildFileMtimes;
    this.pendingFiles.clear();
    this.emit({
      state: "building",
      processedFiles: 0,
      totalFiles: markdownFiles.length,
      indexedFiles: 0,
      chunks: 0,
      message: "正在识别知识库结构…"
    });

    try {
      const schemaContents = await this.readPotentialSchemas(markdownFiles, settings);
      const configDir = this.vault.configDir;
      const profile = discoverKnowledgeProfile(
        markdownFiles.map((file) => file.path),
        schemaContents,
        {
          ...settings.profile,
          excludedRoots: typeof configDir === "string" && configDir.trim()
            ? [...settings.profile.excludedRoots, configDir]
            : settings.profile.excludedRoots
        },
        settings.autoDetectProfile
      );
      if (generation !== this.generation) {
        return;
      }

      this.profile = profile;
      this.queryGuidance = Object.values(schemaContents)
        .map((content) => extractQueryGuidance(content))
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8_000);
      this.searchIndex.clear();
      await this.sourceCatalog.clearAsync();
      this.evidenceReferences.clear();
      this.retriever.clearEvidenceCache();

      const classified: { file: TFile; role: KnowledgeRole }[] = [];
      const classificationScheduler = new CooperativeScheduler();
      for (const file of markdownFiles) {
        if (!isExcludedPath(file.path, profile)) {
          classified.push({ file, role: classifyKnowledgePath(file.path, profile) });
        }
        await classificationScheduler.checkpoint();
        if (generation !== this.generation) {
          return;
        }
      }
      const catalogFiles = classified.filter(({ role }) =>
        role === "stable-source" || (role === "pending-source" && settings.retrieval.includePending)
      );
      const primaryFiles = classified
        .filter(({ role }) =>
          role === "index" ||
          role === "topic" ||
          role === "concept" ||
          role === "summary" ||
          role === "wiki" ||
          (role === "other" && settings.retrieval.includeOtherNotes)
        )
        .sort((left, right) => PRIMARY_ROLE_ORDER[left.role] - PRIMARY_ROLE_ORDER[right.role]);
      const totalFiles = catalogFiles.length + primaryFiles.length;
      let processedFiles = 0;
      let catalogProcessedFiles = 0;

      const catalogBatchSize = 100;
      if (catalogFiles.length > 0) {
        this.emit({
          ...this.status,
          state: "building",
          message: `正在建立原文目录 0/${catalogFiles.length}`
        });
      }
      for (let offset = 0; offset < catalogFiles.length; offset += catalogBatchSize) {
        if (generation !== this.generation) {
          return;
        }
        const batch = catalogFiles.slice(offset, offset + catalogBatchSize);
        const documents = batch
          .map(({ file, role }) => this.catalogDocument(file, role))
          .filter((document): document is Omit<SourceCatalogDocument, "id"> => document !== null);
        await this.sourceCatalog.replaceBatchAsync(documents);
        processedFiles += batch.length;
        catalogProcessedFiles += batch.length;
        this.emit({
          state: "building",
          processedFiles,
          totalFiles,
          indexedFiles: this.sourceCatalog.size,
          chunks: 0,
          message: `正在建立原文目录 ${catalogProcessedFiles}/${catalogFiles.length}`
        });
        await yieldToUi();
      }

      let wikiProcessedFiles = 0;
      if (primaryFiles.length > 0) {
        this.emit({
          ...this.status,
          state: "building",
          message: `正在索引 Wiki 0/${primaryFiles.length}`
        });
      }
      for (const { file, role } of primaryFiles) {
        if (generation !== this.generation) {
          return;
        }
        await this.indexPrimaryFile(file, role, profile, settings);
        processedFiles += 1;
        wikiProcessedFiles += 1;
        this.emit({
          state: "building",
          processedFiles,
          totalFiles,
          indexedFiles: this.sourceCatalog.size + this.searchIndex.stats.files,
          chunks: this.searchIndex.stats.documents,
          message: `正在索引 Wiki ${wikiProcessedFiles}/${primaryFiles.length}`
        });
        await yieldToUi();
      }

      this.emit({
        ...this.status,
        state: "building",
        processedFiles: totalFiles,
        totalFiles,
        message: "正在构建知识关联…"
      });
      const graphBuilt = await this.linkGraph.rebuildAsync(
        this.metadataCache.resolvedLinks,
        () => generation === this.generation
      );
      if (!graphBuilt || generation !== this.generation) {
        return;
      }
      const stats = this.searchIndex.stats;
      this.indexedFileMtimes = buildFileMtimes;
      this.emit({
        state: "ready",
        processedFiles: totalFiles,
        totalFiles,
        indexedFiles: stats.files + this.sourceCatalog.size,
        chunks: stats.documents,
        message: this.readyMessage()
      });
      this.scheduleCacheWrite(0);
      if (this.pendingFiles.size > 0) {
        this.scheduleFileFlush(0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ ...this.status, state: "error", message: `索引失败：${message}` });
      throw error;
    }
  }

  private async readPotentialSchemas(
    files: TFile[],
    settings: WikiCopilotSettings
  ): Promise<Record<string, string>> {
    const configured = new Set(settings.profile.schemaFiles.map((path) => path.toLocaleLowerCase()));
    const named = files.filter((file) =>
      ["agents.md", "claude.md", "gemini.md"].includes(file.name.toLocaleLowerCase())
    );
    const rootNamed = named.filter((file) => !file.path.includes("/"));
    const detected = rootNamed.length > 0 ? rootNamed : named;
    const schemas = [...new Set([
      ...files.filter((file) => configured.has(file.path.toLocaleLowerCase())),
      ...detected
    ])];
    const result: Record<string, string> = {};
    for (const file of schemas) {
      result[file.path] = await this.vault.cachedRead(file);
    }
    return result;
  }

  private noteMetadata(file: TFile, role: KnowledgeRole): NoteMetadata {
    const cache = this.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache)?.map((tag) => tag.replace(/^#/u, "")) ?? [] : [];
    return {
      path: file.path,
      basename: file.basename,
      aliases: aliasesFromFrontmatter(cache?.frontmatter?.aliases ?? cache?.frontmatter?.alias),
      tags,
      role
    };
  }

  private catalogDocument(
    file: TFile,
    role: KnowledgeRole
  ): Omit<SourceCatalogDocument, "id"> | null {
    if (role !== "stable-source" && role !== "pending-source") {
      return null;
    }
    const cache = this.metadataCache.getFileCache(file);
    const metadata = this.noteMetadata(file, role);
    const title = cache?.headings?.find((heading) => heading.level === 1)?.heading ?? file.basename;
    return {
      path: file.path,
      title,
      aliases: metadata.aliases.join(" "),
      tags: metadata.tags.join(" "),
      headings: compactHeadings(cache?.headings?.map((heading) => heading.heading) ?? []),
      role
    };
  }

  private async indexPrimaryFile(
    file: TFile,
    role: KnowledgeRole,
    profile: KnowledgeProfile,
    settings: WikiCopilotSettings
  ): Promise<void> {
    const content = await this.vault.cachedRead(file);
    await this.searchIndex.replaceNoteAsync(this.noteMetadata(file, role), content);
    const sourceRoots = [
      ...profile.stableSourceRoots,
      ...(settings.retrieval.includePending ? profile.pendingSourceRoots : [])
    ];
    this.evidenceReferences.replace(
      file.path,
      content,
      sourceRoots,
      (path) => this.sourceCatalog.hasPath(path)
    );
  }

  private async updateFile(
    file: TFile,
    profile: KnowledgeProfile,
    settings: WikiCopilotSettings
  ): Promise<IndexOutcome> {
    this.removePath(file.path);
    if (isExcludedPath(file.path, profile)) {
      return "skipped";
    }
    const role = classifyKnowledgePath(file.path, profile);
    if (role === "stable-source" || (role === "pending-source" && settings.retrieval.includePending)) {
      const document = this.catalogDocument(file, role);
      if (document) {
        await this.sourceCatalog.replaceAsync(document);
      }
      return "catalog";
    }
    if (
      role === "index" ||
      role === "topic" ||
      role === "concept" ||
      role === "summary" ||
      role === "wiki" ||
      (role === "other" && settings.retrieval.includeOtherNotes)
    ) {
      await this.indexPrimaryFile(file, role, profile, settings);
      return "primary";
    }
    return "skipped";
  }

  private removePath(path: string): void {
    this.searchIndex.removePath(path);
    this.sourceCatalog.remove(path);
    this.evidenceReferences.remove(path);
    this.retriever.removeEvidencePath(path);
    this.indexedFileMtimes.delete(path);
  }

  private async loadEvidence(paths: string[]): Promise<EvidenceNote[]> {
    const profile = this.profile;
    if (!profile) {
      return [];
    }
    const includePending = this.getSettings().retrieval.includePending;
    const notes: EvidenceNote[] = [];
    for (const path of paths) {
      const abstractFile = this.vault.getAbstractFileByPath(path);
      if (!(abstractFile instanceof TFile) || abstractFile.extension.toLocaleLowerCase() !== "md") {
        continue;
      }
      const role = classifyKnowledgePath(path, profile);
      if (role !== "stable-source" && !(includePending && role === "pending-source")) {
        continue;
      }
      notes.push({
        metadata: this.noteMetadata(abstractFile, role),
        markdown: await this.vault.cachedRead(abstractFile)
      });
      await yieldToUi();
    }
    return notes;
  }

  private async flushFileUpdates(): Promise<void> {
    if (this.status.state === "building") {
      return;
    }
    if (!this.profile) {
      this.emit({
        ...this.status,
        state: "error",
        message: "索引尚未初始化，请重新打开 Obsidian 或手动重建。"
      });
      return;
    }
    const updates = [...this.pendingFiles.entries()];
    if (updates.length === 0) {
      return;
    }
    this.pendingFiles.clear();
    this.fileUpdateInProgress = true;
    if (updates.some(([path, file]) =>
      requiresFullProfileRebuild(path, this.profile!, file ? "change" : "remove")
    )) {
      // Keep using the current profile for this session. Do not overwrite the
      // previous cache: on the next Obsidian launch the manifest difference
      // will intentionally trigger profile discovery and a complete rebuild.
      this.profileRefreshPending = true;
    }
    const settings = this.getSettings();
    try {
      for (const [path, file] of updates) {
        if (!file) {
          this.removePath(path);
          continue;
        }
        await this.updateFile(file, this.profile, settings);
        this.indexedFileMtimes.set(file.path, file.stat.mtime);
      }
      const stats = this.searchIndex.stats;
      this.emit({
        ...this.status,
        state: "ready",
        indexedFiles: stats.files + this.sourceCatalog.size,
        chunks: stats.documents,
        message: this.readyMessage()
      });
      this.scheduleCacheWrite(250);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ ...this.status, state: "error", message: `增量索引失败：${message}` });
    } finally {
      this.fileUpdateInProgress = false;
    }
  }

  private readyMessage(): string {
    const stats = this.searchIndex.stats;
    return `索引就绪 · Wiki ${stats.files} 页/${stats.documents} 片段 · 原文目录 ${this.sourceCatalog.size} 页`;
  }

  private scheduleCacheWrite(delay: number): void {
    if (!this.cacheRepository || !this.profile) {
      return;
    }
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
    }
    const generation = this.generation;
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      this.cacheWriteChain = this.cacheWriteChain
        .catch(() => undefined)
        .then(async () => {
          await yieldToUi();
          const snapshot = this.createCacheSnapshot(generation);
          if (snapshot) {
            await this.cacheRepository?.save(snapshot);
          }
        })
        .catch((error) => {
          console.warn("Wiki Copilot: 无法保存本地索引缓存。", error);
        });
    }, delay);
  }

  private createCacheSnapshot(generation: number): IndexCacheSnapshot | null {
    const profile = this.profile;
    if (
      !profile ||
      generation !== this.generation ||
      this.status.state !== "ready" ||
      this.profileRefreshPending ||
      this.fileUpdateInProgress ||
      this.pendingFiles.size > 0
    ) {
      return null;
    }
    return {
      version: INDEX_CACHE_VERSION,
      createdAt: Date.now(),
      settingsKey: indexSettingsKey(this.getSettings()),
      profile,
      queryGuidance: this.queryGuidance,
      files: createFileManifest(this.vault.getMarkdownFiles()),
      searchIndex: this.searchIndex.createSnapshot(),
      sourceCatalog: this.sourceCatalog.createSnapshot(),
      evidenceReferences: this.evidenceReferences.createSnapshot()
    };
  }

  private waitUntilReady(): Promise<void> {
    return waitForReadyStatus((listener) => this.subscribe(listener));
  }

  private scheduleFileFlush(delay: number): void {
    if (this.fileUpdateTimer !== null) {
      window.clearTimeout(this.fileUpdateTimer);
    }
    this.fileUpdateTimer = window.setTimeout(() => {
      this.fileUpdateTimer = null;
      void this.flushFileUpdates();
    }, delay);
  }

  private emit(status: IndexStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
