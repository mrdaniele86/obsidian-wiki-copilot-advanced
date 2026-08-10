import type { KnowledgeProfile, KnowledgeProfileConfig, KnowledgeRole } from "./types";

export const DEFAULT_PROFILE_CONFIG: KnowledgeProfileConfig = {
  schemaFiles: ["AGENTS.md", "CLAUDE.md"],
  indexFiles: ["index.md"],
  wikiRoots: ["wiki"],
  stableSourceRoots: [],
  pendingSourceRoots: [],
  excludedRoots: [".trash", ".git", "node_modules"]
};

const WIKI_DIRECTORY_NAMES = new Set([
  "wiki", "knowledge", "knowledge-base", "knowledge_base", "kb", "知识库", "知识"
]);
const WIKI_GROUP_NAMES = new Set([
  "topic", "topics", "专题", "主题",
  "concept", "concepts", "概念", "术语",
  "summary", "summaries", "摘要", "来源摘要"
]);
const STABLE_DIRECTORY_NAMES = new Set([
  "processed", "curated", "verified", "stable", "published", "已处理", "已验收"
]);
const PENDING_DIRECTORY_NAMES = new Set([
  "pending", "inbox", "unprocessed", "staging", "drafts", "待处理", "待验收", "未处理"
]);
const SOURCE_DIRECTORY_NAMES = new Set([
  "raw", "source", "sources", "materials", "references", "原始资料", "来源", "资料"
]);

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/^\/+|\/+$/gu, "");
}

function uniquePaths(paths: Iterable<string>): string[] {
  return [...new Set([...paths].map(normalizePath).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function pathIsWithin(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path).toLocaleLowerCase();
  const normalizedRoot = normalizePath(root).toLocaleLowerCase();
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function detectNamedRoots(paths: string[], directoryNames: ReadonlySet<string>): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const parts = normalizePath(path).split("/");
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (directoryNames.has(parts[index]?.toLocaleLowerCase() ?? "")) {
        roots.add(parts.slice(0, index + 1).join("/"));
      }
    }
  }
  return [...roots];
}

function detectStructuredWikiRoots(paths: string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const parts = normalizePath(path).split("/");
    const group = parts.findIndex((part) => WIKI_GROUP_NAMES.has(part.toLocaleLowerCase()));
    if (group > 0) {
      roots.add(parts.slice(0, group).join("/"));
    } else if (group === 0) {
      roots.add(parts[0] ?? "");
    }
  }
  return [...roots].filter(Boolean);
}

function detectStandaloneSourceRoots(paths: string[], stableRoots: string[]): string[] {
  const sourceRoots = detectNamedRoots(paths, SOURCE_DIRECTORY_NAMES);
  return sourceRoots.filter((root) =>
    !stableRoots.some((stable) => stable !== root && pathIsWithin(stable, root))
  );
}

interface SchemaPathHint {
  path: string;
  context: string;
}

function extractBacktickedPaths(schema: string): SchemaPathHint[] {
  const candidates: SchemaPathHint[] = [];
  for (const line of schema.split(/\r?\n/u)) {
    for (const match of line.matchAll(/`([^`\r\n]+)`/gu)) {
      let value = (match[1] ?? "").trim();
      if (!value || /^(?:https?:|[\w.-]+\s+--|uv\s|python\s|git\s)/iu.test(value)) {
        continue;
      }
      value = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
      const wildcard = value.search(/[<*{]/u);
      if (wildcard >= 0) {
        value = value.slice(0, wildcard);
      }
      value = value.replace(/\/+$/u, "");
      if (/^[\p{L}\p{N}_.()\-/ ]+(?:\.md|\/[^\s]*)?$/iu.test(value)) {
        candidates.push({ path: value, context: line });
      }
    }
  }
  return candidates;
}

function rootFromCandidate(candidate: string): string {
  const normalized = normalizePath(candidate);
  if (!/\.md$/iu.test(normalized)) {
    return normalized;
  }
  return normalized.split("/").slice(0, -1).join("/");
}

function firstNamedRoot(parts: string[], names: ReadonlySet<string>): string {
  const index = parts.findIndex((part) => names.has(part.toLocaleLowerCase()));
  return index >= 0 ? parts.slice(0, index + 1).join("/") : "";
}

function structuredWikiRoot(parts: string[]): string {
  const named = firstNamedRoot(parts, WIKI_DIRECTORY_NAMES);
  if (named) {
    return named;
  }
  const group = parts.findIndex((part) => WIKI_GROUP_NAMES.has(part.toLocaleLowerCase()));
  if (group > 0) {
    return parts.slice(0, group).join("/");
  }
  return group === 0 ? parts[0] ?? "" : "";
}

function mergeDetectedSchemaHints(
  base: KnowledgeProfileConfig,
  schemaContents: Readonly<Record<string, string>>,
  markdownPaths: readonly string[]
): KnowledgeProfileConfig {
  const wiki = new Set(base.wikiRoots);
  const stable = new Set(base.stableSourceRoots);
  const pending = new Set(base.pendingSourceRoots);
  const indices = new Set(base.indexFiles);

  for (const content of Object.values(schemaContents)) {
    for (const hint of extractBacktickedPaths(content)) {
      const candidate = hint.path;
      const candidateExists = /\.md$/iu.test(candidate)
        ? markdownPaths.some((path) => normalizePath(path).toLocaleLowerCase() ===
          normalizePath(candidate).toLocaleLowerCase())
        : markdownPaths.some((path) => pathIsWithin(path, candidate));
      if (!candidateExists) {
        continue;
      }
      const lower = candidate.toLocaleLowerCase();
      if (lower.endsWith("index.md")) {
        indices.add(candidate);
      }
      const parts = candidate.split("/");
      const wikiRoot = structuredWikiRoot(parts);
      if (wikiRoot) {
        wiki.add(wikiRoot);
      }
      const pendingRoot = firstNamedRoot(parts, PENDING_DIRECTORY_NAMES);
      if (pendingRoot) {
        pending.add(pendingRoot);
      }
      const stableRoot = firstNamedRoot(parts, STABLE_DIRECTORY_NAMES);
      if (stableRoot) {
        stable.add(stableRoot);
      }

      if (!wikiRoot && !pendingRoot && !stableRoot) {
        const genericRoot = rootFromCandidate(candidate);
        const context = hint.context.toLocaleLowerCase();
        const pendingContext = /(?:pending|inbox|unprocessed|待处理|待验收|未处理|草稿)/iu.test(context);
        const stableContext = /(?:processed|curated|verified|source of truth|stable source|raw source|来源|原文|事实源|已处理|已验收)/iu.test(context);
        if (genericRoot && pendingContext && !stableContext) {
          pending.add(genericRoot);
        } else if (genericRoot && /(?:wiki|knowledge|知识库|知识层|topic|concept|summary|主题|概念|摘要)/iu.test(context)) {
          wiki.add(genericRoot);
        } else if (genericRoot && stableContext && !pendingContext) {
          stable.add(genericRoot);
        }
      }
    }
  }

  const compactStable = [...stable].filter((root) => {
    const basename = root.split("/").at(-1)?.toLocaleLowerCase() ?? "";
    return !SOURCE_DIRECTORY_NAMES.has(basename) || ![...stable].some((other) =>
      other !== root && pathIsWithin(other, root)
    );
  });
  const compactPending = [...pending].filter((root) => {
    const basename = root.split("/").at(-1)?.toLocaleLowerCase() ?? "";
    return !SOURCE_DIRECTORY_NAMES.has(basename) || ![...pending].some((other) =>
      other !== root && pathIsWithin(other, root)
    );
  });

  return {
    ...base,
    indexFiles: uniquePaths(indices),
    wikiRoots: uniquePaths(wiki),
    stableSourceRoots: uniquePaths(compactStable),
    pendingSourceRoots: uniquePaths(compactPending)
  };
}

export function discoverKnowledgeProfile(
  markdownPaths: string[],
  schemaContents: Readonly<Record<string, string>>,
  configured: KnowledgeProfileConfig = DEFAULT_PROFILE_CONFIG,
  autoDetect = true
): KnowledgeProfile {
  if (!autoDetect) {
    return {
      ...configured,
      schemaFiles: uniquePaths(configured.schemaFiles),
      indexFiles: uniquePaths(configured.indexFiles),
      wikiRoots: uniquePaths(configured.wikiRoots),
      stableSourceRoots: uniquePaths(configured.stableSourceRoots),
      pendingSourceRoots: uniquePaths(configured.pendingSourceRoots),
      excludedRoots: uniquePaths(configured.excludedRoots),
      autoDetected: false,
      warnings: []
    };
  }

  const lowerToPath = new Map(markdownPaths.map((path) => [normalizePath(path).toLocaleLowerCase(), normalizePath(path)]));
  const namedSchemaFiles = markdownPaths.filter((path) =>
    ["agents.md", "claude.md", "gemini.md"].includes(path.split("/").pop()?.toLocaleLowerCase() ?? "")
  );
  const rootSchemaFiles = namedSchemaFiles.filter((path) => !normalizePath(path).includes("/"));
  const detectedSchemaFiles = rootSchemaFiles.length > 0 ? rootSchemaFiles : namedSchemaFiles;
  const detectedIndexFiles = markdownPaths.filter((path) => path.split("/").pop()?.toLocaleLowerCase() === "index.md");
  const configuredRoots = (roots: string[]): string[] => roots.filter((root) =>
    markdownPaths.some((path) => pathIsWithin(path, root))
  );
  const detectedStableRoots = detectNamedRoots(markdownPaths, STABLE_DIRECTORY_NAMES);

  let profile: KnowledgeProfileConfig = {
    schemaFiles: uniquePaths([...configured.schemaFiles.filter((path) => lowerToPath.has(normalizePath(path).toLocaleLowerCase())), ...detectedSchemaFiles]),
    indexFiles: uniquePaths([...configured.indexFiles.filter((path) => lowerToPath.has(normalizePath(path).toLocaleLowerCase())), ...detectedIndexFiles]),
    wikiRoots: uniquePaths([
      ...configuredRoots(configured.wikiRoots),
      ...detectNamedRoots(markdownPaths, WIKI_DIRECTORY_NAMES),
      ...detectStructuredWikiRoots(markdownPaths)
    ]),
    stableSourceRoots: uniquePaths([
      ...configuredRoots(configured.stableSourceRoots),
      ...detectedStableRoots,
      ...detectStandaloneSourceRoots(markdownPaths, detectedStableRoots)
    ]),
    pendingSourceRoots: uniquePaths([
      ...configuredRoots(configured.pendingSourceRoots),
      ...detectNamedRoots(markdownPaths, PENDING_DIRECTORY_NAMES)
    ]),
    excludedRoots: uniquePaths(configured.excludedRoots)
  };
  profile = mergeDetectedSchemaHints(profile, schemaContents, markdownPaths);

  const warnings: string[] = [];
  if (profile.schemaFiles.length === 0) {
    warnings.push("No AGENTS.md, CLAUDE.md, or other configured schema file was found.");
  }
  if (profile.wikiRoots.length === 0) {
    warnings.push("No Wiki/knowledge layer was detected; add one or describe it in a root Schema file.");
  }
  if (profile.stableSourceRoots.length === 0) {
    warnings.push("No stable raw-source root was detected.");
  }

  return { ...profile, autoDetected: true, warnings };
}

export function classifyKnowledgePath(path: string, profile: KnowledgeProfileConfig): KnowledgeRole {
  const normalized = normalizePath(path);
  if (profile.schemaFiles.some((file) => normalizePath(file).toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    return "schema";
  }
  if (profile.indexFiles.some((file) => normalizePath(file).toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    return "index";
  }
  if (profile.pendingSourceRoots.some((root) => pathIsWithin(normalized, root))) {
    return "pending-source";
  }
  if (profile.stableSourceRoots.some((root) => pathIsWithin(normalized, root))) {
    return "stable-source";
  }

  const wikiRoot = profile.wikiRoots.find((root) => pathIsWithin(normalized, root));
  if (wikiRoot) {
    const relativeParts = normalized.slice(normalizePath(wikiRoot).length).replace(/^\//u, "").split("/");
    const rootGroup = normalizePath(wikiRoot).split("/").at(-1)?.toLocaleLowerCase() ?? "";
    const group = WIKI_GROUP_NAMES.has(rootGroup)
      ? rootGroup
      : relativeParts[0]?.toLocaleLowerCase() ?? "";
    if (["topic", "topics", "专题", "主题"].includes(group)) {
      return "topic";
    }
    if (["concept", "concepts", "概念", "术语"].includes(group)) {
      return "concept";
    }
    if (["summary", "summaries", "摘要", "来源摘要"].includes(group)) {
      return "summary";
    }
    return "wiki";
  }

  return "other";
}

export function isExcludedPath(path: string, profile: KnowledgeProfileConfig): boolean {
  return profile.excludedRoots.some((root) => pathIsWithin(path, root));
}

export function extractQueryGuidance(markdown: string, maxCharacters = 6_000): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let capturing = false;
  let targetLevel = 0;

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (match) {
      const level = match[1]?.length ?? 1;
      const title = (match[2] ?? "").toLocaleLowerCase();
      if (/^(?:query|查询)(?:\s|$|（|\()/iu.test(title)) {
        capturing = true;
        targetLevel = level;
      } else if (capturing && level <= targetLevel) {
        break;
      }
    }
    if (capturing) {
      output.push(line);
      if (output.join("\n").length >= maxCharacters) {
        break;
      }
    }
  }

  return output.join("\n").slice(0, maxCharacters).trim();
}
