import { getAllTags, MetadataCache, TFile, Vault } from "obsidian";
import { CooperativeScheduler, yieldToUi } from "../core/cooperative";
import {
  FullMarkdownSearchMatcher,
  preciseRoleMultiplier
} from "../core/full-markdown-search";
import { HybridWikiRetriever } from "../core/hybrid-retriever";
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
import {
  hasBreadthIntent,
  lexicalRescueTokens,
  lexicalSubstringScore
} from "../core/retrieval-query";
import { WikiSearchIndex } from "../core/search-index";
import { SourceCatalogIndex } from "../core/source-catalog";
import type { SourceCatalogDocument } from "../core/source-catalog";
import { technicalIdentifierTokens } from "../core/tokenizer";
import { DEFAULT_RETRIEVAL_OPTIONS } from "../core/retriever";
import { RequestCancelledError } from "../llm/request-timeout";
import type {
  KnowledgeProfile,
  KnowledgeRole,
  NoteMetadata,
  RetrievalOptions,
  RetrievalResult,
  RetrievedChunk
} from "../core/types";
import type { WikiCopilotSettings } from "../settings";
import {
  createFileManifest,
  diffFileManifests,
  FULL_INDEX_CACHE_SNAPSHOT_POLICY,
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
type LexicalRepairCandidate = {
  file: TFile;
  role: KnowledgeRole;
  score: number;
  markdown?: string;
};
type FullMarkdownFile = {
  path: string;
  file?: TFile;
  metadata: NoteMetadata;
  metadataText: string;
};
type FullMarkdownCandidate = FullMarkdownFile & {
  score: number;
};

export interface IndexCoordinatorOptions {
  lowMemory?: boolean;
}

export interface IndexDiagnostics {
  status: IndexStatus;
  cacheScope: "device" | "vault" | "none";
  visibleMarkdownFiles: number;
  trackedMarkdownFiles: number;
  wikiFiles: number;
  wikiChunks: number;
  sourceFiles: number;
  pendingUpdates: number;
  profileRefreshPending: boolean;
  activePath?: {
    path: string;
    role: KnowledgeRole;
    indexed: boolean;
    chunks: number;
  };
}

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

function basenameFromPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.replace(/\.md$/iu, "");
}

function headingsFromMarkdown(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^(?:#{1,6})\s+(.+)$/u.exec(line.trim());
    if (match?.[1]) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

const SOURCE_HEADING_INDEX_CHARACTERS = 6_000;
const MOBILE_MANIFEST_SHRINK_RATIO = 0.8;
const MOBILE_MANIFEST_SHRINK_MIN_FILES = 100;
const MOBILE_MANIFEST_SHRINK_MIN_REMOVALS = 50;
const LEXICAL_RESCUE_MAX_MATCHES = 24;
const LEXICAL_RESCUE_MAX_CONTENT_FILES = 500;
const LEXICAL_RESCUE_MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const LEXICAL_RESCUE_RECHECK_MS = 60_000;
const IDENTIFIER_RESCUE_RECHECK_MS = 60_000;

function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RequestCancelledError();
  }
}

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
  private readonly lowMemory: boolean;
  private readonly verifiedAdapterIdentifiers = new Map<
    string,
    { checkedAt: number; visibleFiles: number }
  >();
  private readonly verifiedLexicalQueries = new Map<
    string,
    { checkedAt: number; visibleFiles: number }
  >();

  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly getSettings: () => WikiCopilotSettings,
    private readonly cacheRepository: IndexCacheRepository | null = null,
    options: IndexCoordinatorOptions = {}
  ) {
    this.lowMemory = options.lowMemory === true;
    this.searchIndex = new WikiSearchIndex({ compactDocuments: this.lowMemory });
    this.sourceCatalog = new SourceCatalogIndex({ useWorker: !this.lowMemory });
    this.linkGraph = new LinkGraph();
    this.retriever = new HybridWikiRetriever(this.searchIndex, this.linkGraph);
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  get currentStatus(): IndexStatus {
    return this.status;
  }

  getDiagnostics(activePath?: string): IndexDiagnostics {
    const stats = this.searchIndex.stats;
    let activePathStatus: IndexDiagnostics["activePath"];
    if (activePath && this.profile) {
      const role = classifyKnowledgePath(activePath, this.profile);
      const chunks = this.searchIndex.getChunksForPath(activePath).length;
      activePathStatus = {
        path: activePath,
        role,
        indexed: chunks > 0 || this.sourceCatalog.hasPath(activePath),
        chunks
      };
    }
    return {
      status: { ...this.status },
      cacheScope: !this.cacheRepository ? "none" : this.lowMemory ? "device" : "vault",
      visibleMarkdownFiles: this.vault.getMarkdownFiles().length,
      trackedMarkdownFiles: this.indexedFileMtimes.size,
      wikiFiles: stats.files,
      wikiChunks: stats.documents,
      sourceFiles: this.sourceCatalog.size,
      pendingUpdates: this.pendingFiles.size,
      profileRefreshPending: this.profileRefreshPending,
      activePath: activePathStatus
    };
  }

  /**
   * Precise mode deliberately checks the body of every visible, non-excluded
   * Markdown file. The first pass keeps only lightweight file candidates; only
   * those candidates are read again and split into sections for final context.
   */
  async retrieveAllMarkdown(
    query: string,
    searchQueries: readonly string[],
    overrides: Partial<RetrievalOptions> = {},
    onProgress?: (message: string) => void,
    signal?: AbortSignal
  ): Promise<RetrievalResult> {
    const profile = this.profile;
    if (!profile || !query.trim()) {
      return { query, chunks: [], totalCandidates: 0, truncated: false };
    }
    const options: RetrievalOptions = { ...DEFAULT_RETRIEVAL_OPTIONS, ...overrides };
    const matcher = new FullMarkdownSearchMatcher(query, searchQueries);
    const filesByPath = new Map<string, FullMarkdownFile>();
    for (const file of this.vault.getMarkdownFiles()) {
      const role = classifyKnowledgePath(file.path, profile);
      if (
        isExcludedPath(file.path, profile) ||
        role === "schema" ||
        (role === "pending-source" && !options.includePending)
      ) {
        continue;
      }
      filesByPath.set(file.path, {
        path: file.path,
        file,
        metadata: this.noteMetadata(file, role),
        metadataText: this.fileMetadataSearchText(file)
      });
    }

    onProgress?.("正在枚举全部 Markdown…");
    const folders = [""];
    const visitedFolders = new Set<string>();
    const adapterScheduler = new CooperativeScheduler(8, 16);
    for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
      throwIfSearchAborted(signal);
      const folder = folders[folderIndex];
      if (folder === undefined || visitedFolders.has(folder)) {
        continue;
      }
      visitedFolders.add(folder);
      try {
        const listed = await this.vault.adapter.list(folder);
        for (const path of listed.files) {
          if (filesByPath.has(path) || !path.toLocaleLowerCase().endsWith(".md")) {
            continue;
          }
          const role = classifyKnowledgePath(path, profile);
          if (
            isExcludedPath(path, profile) ||
            role === "schema" ||
            (role === "pending-source" && !options.includePending)
          ) {
            continue;
          }
          const basename = basenameFromPath(path);
          filesByPath.set(path, {
            path,
            metadata: { path, basename, aliases: [], tags: [], role },
            metadataText: `${path}\n${basename}`
          });
        }
        for (const child of listed.folders) {
          if (!isExcludedPath(child, profile)) {
            folders.push(child);
          }
        }
      } catch (error) {
        console.warn(`Wiki Copilot: 精准模式无法枚举目录 ${folder || "/"}`, error);
      }
      await adapterScheduler.checkpoint();
    }

    const files = [...filesByPath.values()];
    const fileCandidates: FullMarkdownCandidate[] = [];
    const scanScheduler = new CooperativeScheduler(8, 4);

    onProgress?.("正在扫描全部 Markdown…");
    for (let index = 0; index < files.length; index += 1) {
      throwIfSearchAborted(signal);
      const entry = files[index];
      if (!entry) {
        continue;
      }
      try {
        const markdown = entry.file
          ? await this.vault.cachedRead(entry.file)
          : await this.vault.adapter.read(entry.path);
        const relevance = matcher.scoreFile(entry.metadataText, markdown);
        if (relevance !== null) {
          fileCandidates.push({
            ...entry,
            score: relevance * preciseRoleMultiplier(entry.metadata.role)
          });
        }
      } catch (error) {
        console.warn(`Wiki Copilot: 精准模式无法读取 ${entry.path}`, error);
      }
      await scanScheduler.checkpoint();
    }

    fileCandidates.sort((left, right) =>
      right.score - left.score || left.path.localeCompare(right.path));
    const maxPages = options.maxRetrievedPages;
    const candidateLimit = Math.min(
      fileCandidates.length,
      Math.max(64, Math.min(144, maxPages * 4))
    );
    const candidates = fileCandidates.slice(0, candidateLimit);
    const rankedChunks: RetrievedChunk[] = [];
    const chunkScheduler = new CooperativeScheduler(8, 4);

    onProgress?.("正在提取相关段落…");
    for (let index = 0; index < candidates.length; index += 1) {
      throwIfSearchAborted(signal);
      const candidate = candidates[index];
      if (!candidate) {
        continue;
      }
      try {
        const markdown = candidate.file
          ? await this.vault.cachedRead(candidate.file)
          : await this.vault.adapter.read(candidate.path);
        rankedChunks.push(...matcher.chunksForNote(
          candidate.metadata,
          markdown,
          candidate.score,
          2
        ));
      } catch (error) {
        console.warn(`Wiki Copilot: 精准模式无法提取 ${candidate.path}`, error);
      }
      await chunkScheduler.checkpoint();
    }

    rankedChunks.sort((left, right) =>
      right.score - left.score || left.path.localeCompare(right.path) ||
      left.chunkIndex - right.chunkIndex);
    const selected: RetrievedChunk[] = [];
    const selectedPaths = new Set<string>();
    const chunksPerPath = new Map<string, number>();
    let characters = 0;
    for (const chunk of rankedChunks) {
      const pathCount = chunksPerPath.get(chunk.path) ?? 0;
      if (pathCount >= 2 || (!selectedPaths.has(chunk.path) && selectedPaths.size >= maxPages)) {
        continue;
      }
      if (selected.length > 0 && characters + chunk.text.length > options.maxContextCharacters) {
        continue;
      }
      selected.push(chunk);
      selectedPaths.add(chunk.path);
      chunksPerPath.set(chunk.path, pathCount + 1);
      characters += chunk.text.length;
    }

    return {
      query,
      chunks: selected,
      totalCandidates: rankedChunks.length,
      truncated: fileCandidates.length > candidateLimit || selected.length < rankedChunks.length
    };
  }

  /**
   * Mobile-only index-free rescue path inspired by mature Obsidian search plugins:
   * first inspect cheap path/metadata matches, then scan only missing Wiki pages within
   * a strict byte budget. Matching notes are fed back into the normal index, so citation
   * and Wiki/source role rules remain unchanged.
   */
  async repairLexicalCoverage(query: string): Promise<number> {
    const profile = this.profile;
    const terms = lexicalRescueTokens(query);
    if (!this.lowMemory || !profile || terms.length === 0 || this.status.state !== "ready") {
      return 0;
    }

    const visibleFiles = this.vault.getMarkdownFiles();
    const queryKey = [...terms].sort().join("\u001f");
    const previousCheck = this.verifiedLexicalQueries.get(queryKey);
    if (previousCheck &&
      previousCheck.visibleFiles === visibleFiles.length &&
      Date.now() - previousCheck.checkedAt < LEXICAL_RESCUE_RECHECK_MS) {
      return 0;
    }

    const settings = this.getSettings();
    const metadataMatches = new Map<string, LexicalRepairCandidate>();
    const contentCandidates: LexicalRepairCandidate[] = [];
    const classificationScheduler = new CooperativeScheduler(8, 64);

    for (const file of visibleFiles) {
      const role = classifyKnowledgePath(file.path, profile);
      if (!this.roleParticipatesInIndex(role, settings)) {
        continue;
      }
      const score = lexicalSubstringScore(this.fileMetadataSearchText(file), terms);
      const isPrimary = this.isPrimaryRole(role, settings);
      const alreadyIndexed = isPrimary
        ? this.searchIndex.hasPath(file.path)
        : this.sourceCatalog.hasPath(file.path);
      if (score > 0 && (!alreadyIndexed || role === "stable-source" || role === "pending-source")) {
        metadataMatches.set(file.path, { file, role, score });
      } else if (isPrimary && !alreadyIndexed) {
        contentCandidates.push({ file, role, score: 0 });
      }
      await classificationScheduler.checkpoint();
    }

    contentCandidates.sort((left, right) =>
      PRIMARY_ROLE_ORDER[left.role] - PRIMARY_ROLE_ORDER[right.role] ||
      left.file.stat.size - right.file.stat.size ||
      left.file.path.localeCompare(right.file.path));
    const contentMatches: LexicalRepairCandidate[] = [];
    const contentScheduler = new CooperativeScheduler(8, 8);
    let scannedFiles = 0;
    let scannedBytes = 0;
    for (const candidate of contentCandidates) {
      if (
        scannedFiles >= LEXICAL_RESCUE_MAX_CONTENT_FILES ||
        scannedBytes + candidate.file.stat.size > LEXICAL_RESCUE_MAX_CONTENT_BYTES
      ) {
        break;
      }
      scannedFiles += 1;
      scannedBytes += candidate.file.stat.size;
      try {
        const markdown = await this.vault.cachedRead(candidate.file);
        const score = lexicalSubstringScore(markdown, terms);
        if (score > 0) {
          contentMatches.push({ ...candidate, score, markdown });
        }
      } catch (error) {
        console.warn(`Wiki Copilot: 无法直接检查本机知识页 ${candidate.file.path}`, error);
      }
      await contentScheduler.checkpoint();
    }

    const candidates = [...metadataMatches.values(), ...contentMatches]
      .sort((left, right) =>
        right.score - left.score ||
        PRIMARY_ROLE_ORDER[left.role] - PRIMARY_ROLE_ORDER[right.role] ||
        left.file.path.localeCompare(right.file.path))
      .slice(0, LEXICAL_RESCUE_MAX_MATCHES);
    const repairedPaths = new Set<string>();
    let repaired = 0;
    for (const candidate of candidates) {
      try {
        const outcome = await this.updateFile(
          candidate.file,
          profile,
          settings,
          candidate.markdown
        );
        if (outcome !== "skipped") {
          this.indexedFileMtimes.set(candidate.file.path, candidate.file.stat.mtime);
          repairedPaths.add(candidate.file.path);
          repaired += 1;
        }
      } catch (error) {
        console.warn(`Wiki Copilot: 无法按查询补齐索引 ${candidate.file.path}`, error);
      }
      await yieldToUi();
    }

    const remaining = Math.max(0, LEXICAL_RESCUE_MAX_MATCHES - repairedPaths.size);
    if (remaining > 0 && (repairedPaths.size === 0 || hasBreadthIntent(query))) {
      const adapterPaths = await this.discoverAdapterLexicalPaths(
        terms,
        profile,
        settings,
        remaining
      );
      for (const path of adapterPaths) {
        if (repairedPaths.has(path) || this.isIndexedPath(path)) {
          continue;
        }
        const role = classifyKnowledgePath(path, profile);
        if (!this.roleParticipatesInIndex(role, settings)) {
          continue;
        }
        try {
          const markdown = await this.vault.adapter.read(path);
          await this.updateAdapterMarkdown(path, markdown, role, settings);
          repairedPaths.add(path);
          repaired += 1;
        } catch (error) {
          console.warn(`Wiki Copilot: 无法直接读取本机知识页 ${path}`, error);
        }
        await yieldToUi();
      }
    }

    this.verifiedLexicalQueries.set(queryKey, {
      checkedAt: Date.now(),
      visibleFiles: visibleFiles.length
    });
    if (repaired > 0) {
      const stats = this.searchIndex.stats;
      this.emit({
        ...this.status,
        indexedFiles: stats.files + this.sourceCatalog.size,
        chunks: stats.documents,
        message: this.readyMessage()
      });
      this.scheduleCacheWrite(0);
    }
    return repaired;
  }

  async ensureReady(): Promise<void> {
    if (this.status.state === "ready") {
      return;
    }
    await this.initialize();
    await this.waitUntilReady();
  }

  /**
   * Repairs a device-local cache that was created while only a subset of the vault was visible.
   * This is intentionally narrow: only filenames containing the requested exact identifier are
   * reclassified and refreshed before the query is retried.
   */
  async repairTechnicalIdentifierCoverage(query: string): Promise<number> {
    const profile = this.profile;
    const identifiers = new Set(technicalIdentifierTokens(query));
    if (!profile || identifiers.size === 0 || this.status.state !== "ready") {
      return 0;
    }

    const settings = this.getSettings();
    const visibleFiles = this.vault.getMarkdownFiles();
    if ([...identifiers].every((identifier) => this.sourceCatalog.hasIdentifier(identifier))) {
      return 0;
    }
    const checkedAt = Date.now();
    const needsAdapterVerification = this.lowMemory && [...identifiers].some((identifier) => {
      if (this.sourceCatalog.hasIdentifier(identifier)) {
        return false;
      }
      const previous = this.verifiedAdapterIdentifiers.get(identifier);
      return !previous ||
        previous.visibleFiles !== visibleFiles.length ||
        checkedAt - previous.checkedAt >= IDENTIFIER_RESCUE_RECHECK_MS;
    });
    if (this.lowMemory && !needsAdapterVerification) {
      return 0;
    }
    const candidates = visibleFiles.filter((file) => {
      const pathIdentifiers = technicalIdentifierTokens(file.path);
      if (!pathIdentifiers.some((identifier) => identifiers.has(identifier))) {
        return false;
      }
      const role = classifyKnowledgePath(file.path, profile);
      return role === "stable-source" ||
        (role === "pending-source" && settings.retrieval.includePending) ||
        role === "index" || role === "topic" || role === "concept" ||
        role === "summary" || role === "wiki" ||
        (role === "other" && settings.retrieval.includeOtherNotes);
    });

    let repaired = 0;
    const repairedPaths = new Set<string>();
    for (const file of candidates) {
      try {
        const outcome = await this.updateFile(file, profile, settings);
        if (outcome !== "skipped") {
          this.indexedFileMtimes.set(file.path, file.stat.mtime);
          repairedPaths.add(file.path);
          repaired += 1;
        }
      } catch (error) {
        console.warn(`Wiki Copilot: 无法补齐本机标识符索引 ${file.path}`, error);
      }
      await yieldToUi();
    }

    if (needsAdapterVerification) {
      const adapterPaths = await this.discoverAdapterIdentifierPaths(identifiers, profile, settings);
      for (const path of adapterPaths) {
        if (repairedPaths.has(path)) {
          continue;
        }
        const role = classifyKnowledgePath(path, profile);
        if (role !== "stable-source" && role !== "pending-source") {
          continue;
        }
        try {
          const markdown = await this.vault.adapter.read(path);
          const headings = headingsFromMarkdown(markdown);
          await this.sourceCatalog.replaceAsync({
            path,
            title: headings[0] ?? basenameFromPath(path),
            aliases: "",
            tags: "",
            headings: compactHeadings(headings),
            role
          });
          repairedPaths.add(path);
          repaired += 1;
        } catch (error) {
          console.warn(`Wiki Copilot: 无法从设备文件系统补齐标识符索引 ${path}`, error);
        }
        await yieldToUi();
      }
      for (const identifier of identifiers) {
        this.verifiedAdapterIdentifiers.set(identifier, {
          checkedAt,
          visibleFiles: visibleFiles.length
        });
      }
    }
    if (repaired > 0) {
      this.scheduleCacheWrite(0);
    }
    return repaired;
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
    if (file || oldPath) {
      this.verifiedAdapterIdentifiers.clear();
      this.verifiedLexicalQueries.clear();
    }
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
    void this.linkGraph.synchronizeAsync(
      this.metadataCache.resolvedLinks,
      () => graphGeneration === this.graphGeneration
    ).then(({ applied, changed }) => {
      if (applied && this.status.state === "ready") {
        this.emit({ ...this.status, message: this.readyMessage() });
        if (changed) {
          this.scheduleCacheWrite(250);
        }
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
    this.verifiedAdapterIdentifiers.clear();
    this.verifiedLexicalQueries.clear();
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
    const manifestAppearsIncomplete = this.lowMemory &&
      snapshot.files.length >= MOBILE_MANIFEST_SHRINK_MIN_FILES &&
      currentManifest.length < snapshot.files.length * MOBILE_MANIFEST_SHRINK_RATIO &&
      manifestDiff.removedPaths.length >= MOBILE_MANIFEST_SHRINK_MIN_REMOVALS;
    const removedPaths = manifestAppearsIncomplete ? [] : manifestDiff.removedPaths;
    if (manifestAppearsIncomplete) {
      console.warn(
        "Wiki Copilot: 当前设备仅看到部分知识库文件；保留缓存内容，等待文件同步完成。"
      );
    }
    const requiresRebuild = manifestDiff.changedPaths.some((path) =>
      requiresFullProfileRebuild(path, snapshot.profile, "change")
    ) || removedPaths.some((path) =>
      requiresFullProfileRebuild(path, snapshot.profile, "remove")
    );
    if (requiresRebuild) {
      await this.performRebuild(generation);
      return;
    }

    let linkGraphRestored = false;
    try {
      this.profile = snapshot.profile;
      this.queryGuidance = snapshot.queryGuidance;
      this.emit({ ...this.status, message: "正在恢复 Wiki 索引…" });
      await this.searchIndex.restoreSnapshot(snapshot.searchIndex);
      snapshot.searchIndex.index = null;
      snapshot.searchIndex.documents.length = 0;
      if (generation !== this.generation) {
        return;
      }

      this.emit({ ...this.status, message: "正在恢复原文目录…" });
      await this.sourceCatalog.restoreSnapshot(snapshot.sourceCatalog);
      snapshot.sourceCatalog.length = 0;
      if (generation !== this.generation) {
        return;
      }
      if (snapshot.linkGraph) {
        this.linkGraph.restoreSnapshot(snapshot.linkGraph);
        snapshot.linkGraph.length = 0;
        linkGraphRestored = true;
      }
    } catch (error) {
      console.warn("Wiki Copilot: 恢复本地索引缓存失败，将重新构建。", error);
      if (generation === this.generation) {
        await this.performRebuild(generation);
      }
      return;
    }

    this.indexedFileMtimes = new Map(snapshot.files.map((file) => [file.path, file.mtime]));
    for (const path of removedPaths) {
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
    const updateCount = removedPaths.length + changedFiles.length;
    let updated = removedPaths.length;
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

    if (linkGraphRestored) {
      if (updateCount > 0 && !manifestAppearsIncomplete) {
        this.emit({ ...this.status, message: "正在同步知识关联…" });
        const graphSync = await this.linkGraph.synchronizeAsync(
          this.metadataCache.resolvedLinks,
          () => generation === this.generation
        );
        if (!graphSync.applied || generation !== this.generation) {
          return;
        }
      }
    } else {
      this.emit({ ...this.status, message: "正在升级知识关联缓存…" });
      const graphBuilt = await this.linkGraph.rebuildAsync(
        this.metadataCache.resolvedLinks,
        () => generation === this.generation
      );
      if (!graphBuilt || generation !== this.generation) {
        return;
      }
    }
    this.indexedFileMtimes = manifestAppearsIncomplete
      ? new Map([
        ...snapshot.files.map((file) => [file.path, file.mtime] as const),
        ...currentFileMtimes
      ])
      : currentFileMtimes;
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
    const snapshotPolicy = cacheRepository.snapshotPolicy ?? FULL_INDEX_CACHE_SNAPSHOT_POLICY;
    if (!manifestAppearsIncomplete &&
      (updateCount > 0 || (!linkGraphRestored && snapshotPolicy.includeLinkGraph))) {
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
        role === "stable-source" || role === "pending-source"
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
        await this.indexPrimaryFile(file, role);
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

  private isPrimaryRole(role: KnowledgeRole, settings: WikiCopilotSettings): boolean {
    return role === "index" || role === "topic" || role === "concept" ||
      role === "summary" || role === "wiki" ||
      (role === "other" && settings.retrieval.includeOtherNotes);
  }

  private roleParticipatesInIndex(
    role: KnowledgeRole,
    settings: WikiCopilotSettings
  ): boolean {
    return this.isPrimaryRole(role, settings) || role === "stable-source" ||
      (role === "pending-source" && settings.retrieval.includePending);
  }

  private isIndexedPath(path: string): boolean {
    return this.searchIndex.hasPath(path) || this.sourceCatalog.hasPath(path);
  }

  private fileMetadataSearchText(file: TFile): string {
    const cache = this.metadataCache.getFileCache(file);
    const aliases = aliasesFromFrontmatter(cache?.frontmatter?.aliases ?? cache?.frontmatter?.alias);
    const tags = cache ? getAllTags(cache)?.map((tag) => tag.replace(/^#/u, "")) ?? [] : [];
    return [
      file.path,
      file.basename,
      ...aliases,
      ...tags,
      ...(cache?.headings?.map((heading) => heading.heading) ?? [])
    ].join(" ");
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
    knownMarkdown?: string
  ): Promise<void> {
    const content = knownMarkdown ?? await this.vault.cachedRead(file);
    await this.searchIndex.replaceNoteAsync(this.noteMetadata(file, role), content);
  }

  private async updateFile(
    file: TFile,
    profile: KnowledgeProfile,
    settings: WikiCopilotSettings,
    knownMarkdown?: string
  ): Promise<IndexOutcome> {
    this.removePath(file.path);
    if (isExcludedPath(file.path, profile)) {
      return "skipped";
    }
    const role = classifyKnowledgePath(file.path, profile);
    if (role === "stable-source" || role === "pending-source") {
      const document = this.catalogDocument(file, role);
      if (document) {
        await this.sourceCatalog.replaceAsync(document);
      }
      return "catalog";
    }
    if (this.isPrimaryRole(role, settings)) {
      await this.indexPrimaryFile(file, role, knownMarkdown);
      return "primary";
    }
    return "skipped";
  }

  private removePath(path: string): void {
    this.searchIndex.removePath(path);
    this.sourceCatalog.remove(path);
    this.indexedFileMtimes.delete(path);
  }

  private async updateAdapterMarkdown(
    path: string,
    markdown: string,
    role: KnowledgeRole,
    settings: WikiCopilotSettings
  ): Promise<void> {
    this.removePath(path);
    const headings = headingsFromMarkdown(markdown);
    if (role === "stable-source" || role === "pending-source") {
      await this.sourceCatalog.replaceAsync({
        path,
        title: headings[0] ?? basenameFromPath(path),
        aliases: "",
        tags: "",
        headings: compactHeadings(headings),
        role
      });
      return;
    }
    if (!this.isPrimaryRole(role, settings)) {
      return;
    }
    await this.searchIndex.replaceNoteAsync({
      path,
      basename: basenameFromPath(path),
      aliases: [],
      tags: [],
      role
    }, markdown);
  }

  private async discoverAdapterLexicalPaths(
    terms: readonly string[],
    profile: KnowledgeProfile,
    settings: WikiCopilotSettings,
    limit: number
  ): Promise<string[]> {
    if (limit <= 0) {
      return [];
    }
    const roots = [
      ...profile.wikiRoots,
      ...profile.stableSourceRoots,
      ...(settings.retrieval.includePending ? profile.pendingSourceRoots : [])
    ];
    const queue = [...new Set(roots)];
    const visited = new Set<string>();
    const matches: Array<{ path: string; score: number }> = [];
    const scheduler = new CooperativeScheduler(8, 8);

    while (queue.length > 0) {
      const folder = queue.shift();
      if (!folder || visited.has(folder)) {
        continue;
      }
      visited.add(folder);
      try {
        const listed = await this.vault.adapter.list(folder);
        for (const path of listed.files) {
          if (!path.toLocaleLowerCase().endsWith(".md")) {
            continue;
          }
          const role = classifyKnowledgePath(path, profile);
          if (!this.roleParticipatesInIndex(role, settings)) {
            continue;
          }
          const score = lexicalSubstringScore(path, terms);
          if (score > 0) {
            matches.push({ path, score });
          }
        }
        queue.push(...listed.folders);
      } catch (error) {
        console.warn(`Wiki Copilot: 无法枚举设备知识目录 ${folder}`, error);
      }
      await scheduler.checkpoint();
    }

    return matches
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, limit)
      .map((match) => match.path);
  }

  private async discoverAdapterIdentifierPaths(
    identifiers: ReadonlySet<string>,
    profile: KnowledgeProfile,
    settings: WikiCopilotSettings
  ): Promise<string[]> {
    const roots = [
      ...profile.stableSourceRoots,
      ...(settings.retrieval.includePending ? profile.pendingSourceRoots : [])
    ];
    const queue = [...new Set(roots)];
    const visited = new Set<string>();
    const matches: string[] = [];
    const scheduler = new CooperativeScheduler(8, 8);

    while (queue.length > 0 && matches.length < 64) {
      const folder = queue.shift();
      if (!folder || visited.has(folder)) {
        continue;
      }
      visited.add(folder);
      try {
        const listed = await this.vault.adapter.list(folder);
        for (const path of listed.files) {
          if (!path.toLocaleLowerCase().endsWith(".md")) {
            continue;
          }
          const pathIdentifiers = technicalIdentifierTokens(path);
          if (pathIdentifiers.some((identifier) => identifiers.has(identifier))) {
            matches.push(path);
            if (matches.length >= 64) {
              break;
            }
          }
        }
        queue.push(...listed.folders);
      } catch (error) {
        console.warn(`Wiki Copilot: 无法枚举设备知识目录 ${folder}`, error);
      }
      await scheduler.checkpoint();
    }
    return matches;
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
      const graphGeneration = ++this.graphGeneration;
      await this.linkGraph.synchronizeAsync(
        this.metadataCache.resolvedLinks,
        () => graphGeneration === this.graphGeneration
      );
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
    const snapshotPolicy = this.cacheRepository?.snapshotPolicy ?? FULL_INDEX_CACHE_SNAPSHOT_POLICY;
    const snapshot: IndexCacheSnapshot = {
      version: INDEX_CACHE_VERSION,
      createdAt: Date.now(),
      settingsKey: indexSettingsKey(this.getSettings()),
      profile,
      queryGuidance: this.queryGuidance,
      files: createFileManifest(this.vault.getMarkdownFiles()),
      searchIndex: this.searchIndex.createSnapshot({
        includeSerializedIndex: snapshotPolicy.includeSerializedSearchIndex
      }),
      sourceCatalog: this.sourceCatalog.createSnapshot()
    };
    if (snapshotPolicy.includeLinkGraph) {
      snapshot.linkGraph = this.linkGraph.createSnapshot();
    }
    return snapshot;
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
