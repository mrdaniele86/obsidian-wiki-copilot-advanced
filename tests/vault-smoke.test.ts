import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyKnowledgePath, discoverKnowledgeProfile, isExcludedPath } from "../src/core/profile";
import { EvidenceReferenceMap } from "../src/core/evidence-references";
import { HybridWikiRetriever } from "../src/core/hybrid-retriever";
import { LinkGraph } from "../src/core/link-graph";
import { WikiSearchIndex } from "../src/core/search-index";
import { SourceCatalogIndex } from "../src/core/source-catalog";
import type { NoteMetadata } from "../src/core/types";

const vaultRoot = process.env.WIKI_COPILOT_VAULT_ROOT;

async function markdownFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md")) {
        output.push(relative(root, absolute).replace(/\\/gu, "/"));
      }
    }
  }
  await visit(join(root, "wiki"));
  await visit(join(root, "raw", "processed"));
  for (const rootFile of ["AGENTS.md", "index.md"]) {
    try {
      await readFile(join(root, rootFile));
      output.push(rootFile);
    } catch {
      // Optional in generic vaults.
    }
  }
  return output;
}

describe.skipIf(!vaultRoot)("real vault smoke test", () => {
  it("indexes Wiki content and builds a metadata-only stable source catalog", async () => {
    const root = vaultRoot as string;
    const paths = await markdownFiles(root);
    const schema: Record<string, string> = {};
    if (paths.includes("AGENTS.md")) {
      schema["AGENTS.md"] = await readFile(join(root, "AGENTS.md"), "utf8");
    }
    const profile = discoverKnowledgeProfile(paths, schema);
    const index = new WikiSearchIndex();
    const catalog = new SourceCatalogIndex();
    const references = new EvidenceReferenceMap();
    const started = performance.now();

    for (const path of paths) {
      const role = classifyKnowledgePath(path, profile);
      if (role !== "stable-source") {
        continue;
      }
      const basename = path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path;
      catalog.replace({ path, title: basename, aliases: "", tags: "", headings: "", role });
    }

    for (const path of paths) {
      const role = classifyKnowledgePath(path, profile);
      if (role === "stable-source") {
        continue;
      }
      if (role === "schema" || role === "other" || role === "pending-source" || isExcludedPath(path, profile)) {
        continue;
      }
      const content = await readFile(join(root, path), "utf8");
      const metadata: NoteMetadata = {
        path,
        basename: path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path,
        aliases: [],
        tags: [],
        role
      };
      index.replaceNote(metadata, content);
      references.replace(path, content, profile.stableSourceRoots, (candidate) => catalog.hasPath(candidate));
    }

    const memory = process.memoryUsage();
    console.info(JSON.stringify({
      files: index.stats.files,
      chunks: index.stats.documents,
      catalogFiles: catalog.size,
      referencePages: references.pageCount,
      sourceReferences: references.referenceCount,
      elapsedMs: Math.round(performance.now() - started),
      heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024),
      rssMiB: Math.round(memory.rss / 1024 / 1024)
    }));

    const cacheStarted = performance.now();
    const serializedSearch = JSON.stringify(index.createSnapshot());
    const restoredIndex = new WikiSearchIndex();
    await restoredIndex.restoreSnapshot(JSON.parse(serializedSearch));
    const restoredCatalog = new SourceCatalogIndex();
    await restoredCatalog.restoreSnapshot(catalog.createSnapshot());
    const restoredReferences = new EvidenceReferenceMap();
    restoredReferences.restoreSnapshot(references.createSnapshot());
    console.info(JSON.stringify({
      searchCacheMiB: Math.round(serializedSearch.length / 1024 / 1024),
      restoreElapsedMs: Math.round(performance.now() - cacheStarted),
      restoredFiles: restoredIndex.stats.files,
      restoredChunks: restoredIndex.stats.documents,
      restoredCatalogFiles: restoredCatalog.size
    }));
    expect(restoredIndex.stats).toEqual(index.stats);
    expect(restoredCatalog.size).toBe(catalog.size);
    expect(restoredReferences.referenceCount).toBe(references.referenceCount);
    restoredCatalog.destroy();

    const retriever = new HybridWikiRetriever(
      index,
      new LinkGraph(),
      catalog,
      references,
      async (requestedPaths) => Promise.all(requestedPaths.map(async (path) => ({
        metadata: {
          path,
          basename: path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path,
          aliases: [],
          tags: [],
          role: "stable-source" as const
        },
        markdown: await readFile(join(root, path), "utf8")
      })))
    );
    const retrievalStarted = performance.now();
    const phases: Array<{ message: string; elapsedMs: number }> = [];
    const result = await retriever.retrieve(
      "消防返回 消防员服务",
      { graphExpansion: false },
      (message) => phases.push({ message, elapsedMs: Math.round(performance.now() - retrievalStarted) })
    );
    console.info(JSON.stringify({
      retrievalElapsedMs: Math.round(performance.now() - retrievalStarted),
      phases
    }));
    expect(index.stats.files).toBeGreaterThan(100);
    expect(catalog.size).toBeGreaterThan(100);
    expect(references.referenceCount).toBeGreaterThan(100);
    expect(result.chunks.some((chunk) => chunk.role === "topic" || chunk.role === "concept")).toBe(true);
    expect(result.chunks.some((chunk) => chunk.role === "stable-source")).toBe(true);
    expect(result.chunks.some((chunk) => chunk.role === "pending-source")).toBe(false);
  }, 120_000);
});
