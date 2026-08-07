import type { DataAdapter } from "obsidian";
import type { WikiSearchIndexSnapshot } from "../core/search-index";
import type { SourceCatalogDocument } from "../core/source-catalog";
import type {
  EvidenceTier,
  KnowledgeProfile,
  KnowledgeRole,
  SearchDocument
} from "../core/types";
import type { WikiCopilotSettings } from "../settings";

export const INDEX_CACHE_VERSION = 1;

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
}

export interface IndexCacheRepository {
  load(): Promise<IndexCacheSnapshot | null>;
  save(snapshot: IndexCacheSnapshot): Promise<void>;
}

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

export function parseIndexCacheSnapshot(serialized: string): IndexCacheSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(value) ||
    value.version !== INDEX_CACHE_VERSION ||
    typeof value.createdAt !== "number" ||
    typeof value.settingsKey !== "string" ||
    typeof value.queryGuidance !== "string" ||
    !isProfile(value.profile) ||
    !Array.isArray(value.files) || !value.files.every(isFileFingerprint) ||
    !isRecord(value.searchIndex) || !isRecord(value.searchIndex.index) ||
    !Array.isArray(value.searchIndex.documents) || !value.searchIndex.documents.every(isSearchDocument) ||
    !Array.isArray(value.sourceCatalog) || !value.sourceCatalog.every(isSourceCatalogDocument) ||
    !Array.isArray(value.evidenceReferences) || !value.evidenceReferences.every(isEvidenceReference)) {
    return null;
  }
  return value as unknown as IndexCacheSnapshot;
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
