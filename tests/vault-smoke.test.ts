import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyKnowledgePath, discoverKnowledgeProfile, isExcludedPath } from "../src/core/profile";
import {
  FullMarkdownSearchMatcher,
  preciseRoleMultiplier
} from "../src/core/full-markdown-search";
import { HybridWikiRetriever } from "../src/core/hybrid-retriever";
import { LinkGraph } from "../src/core/link-graph";
import { matchesTechnicalIdentifierFamily } from "../src/core/retrieval-query";
import { retrievalOptionsForRange } from "../src/core/retriever";
import { WikiSearchIndex } from "../src/core/search-index";
import { SourceCatalogIndex } from "../src/core/source-catalog";
import type { NoteMetadata, RetrievalResult } from "../src/core/types";

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
  try {
    await visit(join(root, "raw", "pending"));
  } catch {
    // Pending is optional in generic Vaults.
  }
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

async function preciseSearch(
  root: string,
  paths: readonly string[],
  profile: ReturnType<typeof discoverKnowledgeProfile>,
  query: string,
  queries: readonly string[]
): Promise<RetrievalResult> {
  const matcher = new FullMarkdownSearchMatcher(query, queries);
  const candidates: Array<{
    metadata: NoteMetadata;
    markdown: string;
    score: number;
  }> = [];
  for (const path of paths) {
    const role = classifyKnowledgePath(path, profile);
    if (role === "schema" || isExcludedPath(path, profile)) {
      continue;
    }
    const markdown = await readFile(join(root, path), "utf8");
    const metadata: NoteMetadata = {
      path,
      basename: path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path,
      aliases: [],
      tags: [],
      role
    };
    const relevance = matcher.scoreFile(`${path}\n${metadata.basename}`, markdown);
    if (relevance !== null) {
      candidates.push({
        metadata,
        markdown,
        score: relevance * preciseRoleMultiplier(role)
      });
    }
  }
  const chunks = candidates
    .sort((left, right) => right.score - left.score ||
      left.metadata.path.localeCompare(right.metadata.path))
    .slice(0, 144)
    .flatMap((candidate) => matcher.chunksForNote(
      candidate.metadata,
      candidate.markdown,
      candidate.score,
      2
    ))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 36);
  return { query, chunks, totalCandidates: chunks.length, truncated: false };
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
    const compactMobileIndex = new WikiSearchIndex({ compactDocuments: true });
    const catalog = new SourceCatalogIndex();
    const started = performance.now();

    for (const path of paths) {
      const role = classifyKnowledgePath(path, profile);
      if (role !== "stable-source" && role !== "pending-source") {
        continue;
      }
      const basename = path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path;
      catalog.replace({ path, title: basename, aliases: "", tags: "", headings: "", role });
    }

    for (const path of paths) {
      const role = classifyKnowledgePath(path, profile);
      if (role === "stable-source" || role === "pending-source") {
        continue;
      }
      if (role === "schema" || role === "other" || isExcludedPath(path, profile)) {
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
      compactMobileIndex.replaceNote(metadata, content);
    }

    const memory = process.memoryUsage();
    console.info(JSON.stringify({
      files: index.stats.files,
      chunks: index.stats.documents,
      mobileChunks: compactMobileIndex.stats.documents,
      catalogFiles: catalog.size,
      elapsedMs: Math.round(performance.now() - started),
      heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024),
      rssMiB: Math.round(memory.rss / 1024 / 1024)
    }));

    const cacheStarted = performance.now();
    const serializedSearch = JSON.stringify(index.createSnapshot());
    const serializedCatalog = JSON.stringify(catalog.createSnapshot());
    const restoredIndex = new WikiSearchIndex();
    await restoredIndex.restoreSnapshot(JSON.parse(serializedSearch));
    const restoredCatalog = new SourceCatalogIndex();
    await restoredCatalog.restoreSnapshot(catalog.createSnapshot());
    console.info(JSON.stringify({
      searchCacheMiB: Math.round(serializedSearch.length / 1024 / 1024),
      catalogCacheMiB: Math.round(serializedCatalog.length / 1024 / 1024),
      restoreElapsedMs: Math.round(performance.now() - cacheStarted),
      restoredFiles: restoredIndex.stats.files,
      restoredChunks: restoredIndex.stats.documents,
      restoredCatalogFiles: restoredCatalog.size
    }));
    expect(restoredIndex.stats).toEqual(index.stats);
    expect(restoredCatalog.size).toBe(catalog.size);
    restoredCatalog.destroy();

    const mobileSnapshot = compactMobileIndex.createSnapshot({ includeSerializedIndex: false });
    console.info(JSON.stringify({
      mobileSearchCacheMiB: Math.round(JSON.stringify(mobileSnapshot).length / 1024 / 1024),
      mobileFiles: compactMobileIndex.stats.files,
      mobileChunks: compactMobileIndex.stats.documents
    }));
    expect(compactMobileIndex.stats.documents).toBeLessThan(index.stats.documents / 2);
    const mobileRestoredIndex = new WikiSearchIndex({ compactDocuments: true });
    await mobileRestoredIndex.restoreSnapshot(mobileSnapshot);
    const mobileRestoredCatalog = new SourceCatalogIndex({ useWorker: false });
    await mobileRestoredCatalog.restoreSnapshot(catalog.createSnapshot());

    const retriever = new HybridWikiRetriever(index, new LinkGraph());
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
    expect(result.chunks.some((chunk) => chunk.role === "topic" || chunk.role === "concept")).toBe(true);
    expect(result.chunks.every((chunk) =>
      chunk.role !== "stable-source" && chunk.role !== "pending-source"
    )).toBe(true);

    const ms6Result = await retriever.retrieve(
      "所有ms6端口定义",
      retrievalOptionsForRange("high")
    );
    console.info(JSON.stringify({
      ms6Chunks: ms6Result.chunks.map((chunk) => ({
        path: chunk.path,
        heading: chunk.heading,
        role: chunk.role,
        score: chunk.score
      }))
    }));
    expect(ms6Result.chunks.length).toBeGreaterThan(0);
    expect(ms6Result.chunks.some((chunk) => /ms6/iu.test(`${chunk.path} ${chunk.title} ${chunk.heading}`)))
      .toBe(true);

    const pcbaResult = await preciseSearch(
      root,
      paths,
      profile,
      "PCBA测试要求",
      [
        "PCBA测试要求",
        "PCBA PCB testing requirements",
        "PCBA manufacturing test points acceptance criteria"
      ]
    );
    console.info(JSON.stringify({
      pcbaChunks: pcbaResult.chunks.map((chunk) => ({
        path: chunk.path,
        heading: chunk.heading,
        role: chunk.role,
        score: chunk.score
      }))
    }));
    expect(pcbaResult.chunks.length).toBeGreaterThan(0);
    expect(pcbaResult.chunks[0]?.path).toMatch(/PCBA design rules/iu);
    expect(pcbaResult.chunks[0]?.evidenceTier).toBe("unverified");

    const mobileRetriever = new HybridWikiRetriever(mobileRestoredIndex, new LinkGraph());

    for (const query of [
      "所有ms6端口定义",
      "所有ms6功耗",
      "所有ND板技术条件",
      "消防返回 消防员服务"
    ]) {
      const desktopResult = await retriever.retrieve(
        query,
        retrievalOptionsForRange("high")
      );
      const mobileResult = await mobileRetriever.retrieve(
        query,
        retrievalOptionsForRange("high")
      );
      const desktopPaths = new Set(desktopResult.chunks.map((chunk) => chunk.path));

      expect(desktopResult.chunks.length, `desktop query: ${query}`).toBeGreaterThan(0);
      expect(mobileResult.chunks.length, `mobile query: ${query}`).toBeGreaterThan(0);
      expect(
        mobileResult.chunks.some((chunk) => desktopPaths.has(chunk.path)),
        `desktop/mobile Wiki overlap: ${query}`
      ).toBe(true);
      expect(desktopResult.chunks.every((chunk) =>
        chunk.role !== "stable-source" && chunk.role !== "pending-source"
      )).toBe(true);
      expect(mobileResult.chunks.every((chunk) =>
        chunk.role !== "stable-source" && chunk.role !== "pending-source"
      )).toBe(true);
    }

    const mobileMs6Result = await mobileRetriever.retrieve(
      "所有ms6端口定义",
      retrievalOptionsForRange("high")
    );
    expect(mobileMs6Result.chunks.length).toBeGreaterThan(0);
    expect(mobileMs6Result.chunks.every((chunk) =>
      matchesTechnicalIdentifierFamily(["ms6"], chunk)
    )).toBe(true);

    const preciseMs6Power = await preciseSearch(
      root,
      paths,
      profile,
      "所有ms6功耗",
      ["所有ms6功耗", "MS6 power consumption", "MS6 watt power test"]
    );
    expect(preciseMs6Power.chunks.length).toBeGreaterThan(0);
    expect(preciseMs6Power.chunks.every((chunk) =>
      matchesTechnicalIdentifierFamily(["ms6"], chunk)
    )).toBe(true);
    expect(preciseMs6Power.chunks.some((chunk) => chunk.role === "stable-source")).toBe(true);
    expect(preciseMs6Power.chunks.some((chunk) =>
      /功耗|power consumption|watt/iu.test(`${chunk.heading} ${chunk.text}`)
    )).toBe(true);
    mobileRestoredCatalog.destroy();
  }, 120_000);
});
