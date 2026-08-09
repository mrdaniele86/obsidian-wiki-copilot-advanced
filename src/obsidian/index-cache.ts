import type { DataAdapter } from "obsidian";
import type { LinkGraphSnapshot } from "../core/link-graph";
import type { WikiSearchIndexSnapshot } from "../core/search-index";
import type { SourceCatalogDocument } from "../core/source-catalog";
import type {
  EvidenceTier,
  KnowledgeProfile,
  KnowledgeRole,
  SearchDocument
} from "../core/types";
import type { WikiCopilotSettings } from "../settings";

export const INDEX_CACHE_VERSION = 3;

export interface FileFingerprint {
  path: string;
  mtime: number;
  size: number;
}

export interface FileFingerprintSource {
  path: string;
  stat: {
    mtime: number;
    size: number;
  };
}

export interface FileManifestDiff {
  changedPaths: string[];
  removedPaths: string[];
}

export interface IndexCacheSnapshot {
  version: number;
  createdAt: number;
  settingsKey: string;
  profile: KnowledgeProfile;
  queryGuidance: string;
  files: FileFingerprint[];
  searchIndex: WikiSearchIndexSnapshot;
  sourceCatalog: SourceCatalogDocument[];
  evidenceReferences: Array<[string, string[]]>;
  linkGraph?: LinkGraphSnapshot;
}

export interface IndexCacheRepository {
  readonly snapshotPolicy?: IndexCacheSnapshotPolicy;
  load(): Promise<IndexCacheSnapshot | null>;
  save(snapshot: IndexCacheSnapshot): Promise<void>;
}

export interface IndexCacheSnapshotPolicy {
  includeSerializedSearchIndex: boolean;
  includeLinkGraph: boolean;
}

export const FULL_INDEX_CACHE_SNAPSHOT_POLICY: IndexCacheSnapshotPolicy = {
  includeSerializedSearchIndex: true,
  includeLinkGraph: true
};

export const MOBILE_INDEX_CACHE_SNAPSHOT_POLICY: IndexCacheSnapshotPolicy = {
  includeSerializedSearchIndex: false,
  includeLinkGraph: true
};

const KNOWLEDGE_ROLES = new Set<KnowledgeRole>([
  "schema",
  "index",
  "topic",
  "concept",
  "summary",
  "wiki",
  "stable-source",
  "pending-source",
  "other"
]);
const EVIDENCE_TIERS = new Set<EvidenceTier>([
  "navigation",
  "synthesis",
  "stable",
  "unverified"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProfile(value: unknown): value is KnowledgeProfile {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.autoDetected === "boolean" &&
    isStringArray(value.warnings) &&
    isStringArray(value.schemaFiles) &&
    isStringArray(value.indexFiles) &&
    isStringArray(value.wikiRoots) &&
    isStringArray(value.stableSourceRoots) &&
    isStringArray(value.pendingSourceRoots) &&
    isStringArray(value.excludedRoots);
}

function isFileFingerprint(value: unknown): value is FileFingerprint {
  return isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.mtime === "number" && Number.isFinite(value.mtime) &&
    typeof value.size === "number" && Number.isFinite(value.size);
}

function isSearchDocument(value: unknown): value is SearchDocument {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.title === "string" &&
    typeof value.heading === "string" &&
    typeof value.headingLevel === "number" &&
    typeof value.chunkIndex === "number" &&
    typeof value.text === "string" &&
    typeof value.aliases === "string" &&
    typeof value.tags === "string" &&
    typeof value.role === "string" && KNOWLEDGE_ROLES.has(value.role as KnowledgeRole) &&
    typeof value.evidenceTier === "string" && EVIDENCE_TIERS.has(value.evidenceTier as EvidenceTier);
}

function isSourceCatalogDocument(value: unknown): value is SourceCatalogDocument {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.title === "string" &&
    typeof value.aliases === "string" &&
    typeof value.tags === "string" &&
    typeof value.headings === "string" &&
    (value.role === "stable-source" || value.role === "pending-source");
}

function isEvidenceReference(value: unknown): value is [string, string[]] {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    isStringArray(value[1]);
}

function isLinkDestination(value: unknown): value is [string, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] > 0;
}

function isLinkGraphSource(value: unknown): value is LinkGraphSnapshot[number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    Array.isArray(value[1]) && value[1].every(isLinkDestination);
}

function isLinkGraphSnapshot(value: unknown): value is LinkGraphSnapshot {
  return Array.isArray(value) && value.every(isLinkGraphSource);
}

export function isIndexCacheSnapshot(
  value: unknown,
  policy: IndexCacheSnapshotPolicy = FULL_INDEX_CACHE_SNAPSHOT_POLICY
): value is IndexCacheSnapshot {
  if (!isRecord(value) ||
    value.version !== INDEX_CACHE_VERSION ||
    typeof value.createdAt !== "number" ||
    typeof value.settingsKey !== "string" ||
    typeof value.queryGuidance !== "string" ||
    !isProfile(value.profile) ||
    !Array.isArray(value.files) || !value.files.every(isFileFingerprint) ||
    !isRecord(value.searchIndex) ||
    !(isRecord(value.searchIndex.index) ||
      (!policy.includeSerializedSearchIndex && value.searchIndex.index === null)) ||
    !Array.isArray(value.searchIndex.documents) || !value.searchIndex.documents.every(isSearchDocument) ||
    !Array.isArray(value.sourceCatalog) || !value.sourceCatalog.every(isSourceCatalogDocument) ||
    !Array.isArray(value.evidenceReferences) || !value.evidenceReferences.every(isEvidenceReference) ||
    (value.linkGraph !== undefined && !isLinkGraphSnapshot(value.linkGraph))) {
    return false;
  }
  return true;
}

export function parseIndexCacheSnapshot(serialized: string): IndexCacheSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  return isIndexCacheSnapshot(value) ? value : null;
}

export function indexSettingsKey(settings: WikiCopilotSettings): string {
  return JSON.stringify({
    autoDetectProfile: settings.autoDetectProfile,
    profile: settings.profile,
    includePending: settings.retrieval.includePending,
    includeOtherNotes: settings.retrieval.includeOtherNotes
  });
}

export function createFileManifest(files: readonly FileFingerprintSource[]): FileFingerprint[] {
  return files
    .map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function diffFileManifests(
  cached: readonly FileFingerprint[],
  current: readonly FileFingerprint[]
): FileManifestDiff {
  const cachedByPath = new Map(cached.map((file) => [file.path, file]));
  const currentByPath = new Map(current.map((file) => [file.path, file]));
  const changedPaths = current
    .filter((file) => {
      const previous = cachedByPath.get(file.path);
      return !previous || previous.mtime !== file.mtime || previous.size !== file.size;
    })
    .map((file) => file.path);
  const removedPaths = cached
    .filter((file) => !currentByPath.has(file.path))
    .map((file) => file.path);
  return { changedPaths, removedPaths };
}

export class AdapterIndexCacheRepository implements IndexCacheRepository {
  readonly snapshotPolicy = FULL_INDEX_CACHE_SNAPSHOT_POLICY;

  constructor(
    private readonly adapter: DataAdapter,
    private readonly cachePath: string
  ) {}

  async load(): Promise<IndexCacheSnapshot | null> {
    if (!await this.adapter.exists(this.cachePath)) {
      return null;
    }
    try {
      const snapshot = parseIndexCacheSnapshot(await this.adapter.read(this.cachePath));
      if (!snapshot) {
        console.warn("Wiki Copilot: 本地索引缓存无效，将重新构建。");
      }
      return snapshot;
    } catch (error) {
      console.warn("Wiki Copilot: 无法读取本地索引缓存，将重新构建。", error);
      return null;
    }
  }

  async save(snapshot: IndexCacheSnapshot): Promise<void> {
    await this.adapter.write(this.cachePath, JSON.stringify(snapshot));
  }
}

const INDEXED_DB_NAME = "wiki-copilot-index-cache";
const INDEXED_DB_STORE = "snapshots";
const INDEXED_DB_VERSION = 2;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 事务已中止"));
  });
}

/** Device-local cache used on mobile so large generated data never enters iCloud. */
export class IndexedDbIndexCacheRepository implements IndexCacheRepository {
  readonly snapshotPolicy = MOBILE_INDEX_CACHE_SNAPSHOT_POLICY;

  constructor(
    private readonly factory: IDBFactory,
    private readonly cacheKey: string
  ) {}

  async load(): Promise<IndexCacheSnapshot | null> {
    let database: IDBDatabase | null = null;
    try {
      database = await this.openDatabase();
      const transaction = database.transaction(INDEXED_DB_STORE, "readonly");
      const completion = transactionComplete(transaction);
      const value = await requestResult(
        transaction.objectStore(INDEXED_DB_STORE).get(this.cacheKey) as IDBRequest<unknown>
      );
      await completion;
      if (!isIndexCacheSnapshot(value, this.snapshotPolicy)) {
        if (value !== undefined) {
          console.warn("Wiki Copilot: 手机本地索引缓存无效，将重新构建。");
        }
        return null;
      }
      return value;
    } catch (error) {
      console.warn("Wiki Copilot: 无法读取手机本地索引缓存，将重新构建。", error);
      return null;
    } finally {
      database?.close();
    }
  }

  async save(snapshot: IndexCacheSnapshot): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(INDEXED_DB_STORE, "readwrite");
      const completion = transactionComplete(transaction);
      transaction.objectStore(INDEXED_DB_STORE).put(snapshot, this.cacheKey);
      await completion;
    } finally {
      database.close();
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(INDEXED_DB_STORE)) {
          request.result.createObjectStore(INDEXED_DB_STORE);
        } else {
          // v1 mobile snapshots contain the former high-cardinality chunk layout. Clearing the
          // store inside the upgrade transaction avoids cloning that large value into JS memory
          // before it can be rejected, which could terminate iOS during plugin startup.
          request.transaction?.objectStore(INDEXED_DB_STORE).clear();
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法打开 IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB 升级被阻止"));
    });
  }
}
