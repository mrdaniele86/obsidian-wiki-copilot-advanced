function normalizePath(path: string): string {
  let decoded = path.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the literal path when it is not URI encoded.
  }
  return decoded
    .replace(/^<|>$/gu, "")
    .replace(/\\ /gu, " ")
    .replace(/#.*$/u, "")
    .replace(/\|.*$/u, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function extractPathCandidates(markdown: string, sourceRoots: string[]): Set<string> {
  const candidates = new Set<string>();
  const patterns = [
    /`([^`\r\n]+\.md)`/giu,
    /\[\[([^\]\r\n]+\.md(?:#[^\]\r\n]+)?(?:\|[^\]\r\n]+)?)\]\]/giu,
    /\[[^\]\r\n]*\]\(([^)\r\n]+\.md(?:#[^)\r\n]+)?)\)/giu
  ];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      if (match[1]) {
        candidates.add(normalizePath(match[1]));
      }
    }
  }

  for (const root of sourceRoots) {
    const rootPattern = escapeRegExp(root.replace(/\\/gu, "/").replace(/\/+$/u, ""));
    const pattern = new RegExp(`${rootPattern}/[^\\r\\n\`<>]+?\\.md`, "giu");
    for (const match of markdown.matchAll(pattern)) {
      candidates.add(normalizePath(match[0]));
    }
  }
  return candidates;
}

export class EvidenceReferenceMap {
  private readonly byWikiPath = new Map<string, Set<string>>();

  replace(
    wikiPath: string,
    markdown: string,
    sourceRoots: string[],
    sourceExists: (path: string) => boolean
  ): void {
    const references = new Set(
      [...extractPathCandidates(markdown, sourceRoots)].filter(sourceExists)
    );
    if (references.size > 0) {
      this.byWikiPath.set(wikiPath, references);
    } else {
      this.byWikiPath.delete(wikiPath);
    }
  }

  remove(wikiPath: string): void {
    this.byWikiPath.delete(wikiPath);
  }

  relatedTo(wikiPaths: Iterable<string>, limit = 16): string[] {
    const results: string[] = [];
    const seen = new Set<string>();
    for (const wikiPath of wikiPaths) {
      for (const sourcePath of this.byWikiPath.get(wikiPath) ?? []) {
        if (seen.has(sourcePath)) {
          continue;
        }
        seen.add(sourcePath);
        results.push(sourcePath);
        if (results.length >= limit) {
          return results;
        }
      }
    }
    return results;
  }

  clear(): void {
    this.byWikiPath.clear();
  }

  createSnapshot(): Array<[string, string[]]> {
    return [...this.byWikiPath.entries()].map(([path, references]) => [path, [...references]]);
  }

  restoreSnapshot(entries: Array<[string, string[]]>): void {
    this.byWikiPath.clear();
    for (const [path, references] of entries) {
      if (references.length > 0) {
        this.byWikiPath.set(path, new Set(references));
      }
    }
  }

  get pageCount(): number {
    return this.byWikiPath.size;
  }

  get referenceCount(): number {
    let count = 0;
    for (const references of this.byWikiPath.values()) {
      count += references.size;
    }
    return count;
  }
}
