import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyKnowledgePath, discoverKnowledgeProfile, isExcludedPath } from "../src/core/profile";
import { EvidenceReferenceMap } from "../src/core/evidence-references";
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
    const compactMobileIndex = new WikiSearchIndex({ compactDocuments: true });
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
      compactMobileIndex.replaceNote(metadata, content);
      references.replace(path, content, profile.stableSourceRoots, (candidate) => catalog.hasPath(candidate));
    }

    const memory = process.memoryUsage();
    console.info(JSON.stringify({
      files: index.stats.files,
      chunks: index.stats.documents,
      mobileChunks: compactMobileIndex.stats.documents,
      catalogFiles: catalog.size,
      referencePages: references.pageCount,
      sourceReferences: references.referenceCount,
      elapsedMs: Math.round(performance.now() - started),
      heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024),
      rssMiB: Math.round(memory.rss / 1024 / 1024)
    }));

    const cacheStarted = performance.now();
    const serializedSearch = JSON.stringify(index.createSnapshot());
    const serializedCatalog = JSON.stringify(catalog.createSnapshot());
    const serializedReferences = JSON.stringify(references.createSnapshot());
    const restoredIndex = new WikiSearchIndex();
    await restoredIndex.restoreSnapshot(JSON.parse(serializedSearch));
    const restoredCatalog = new SourceCatalogIndex();
    await restoredCatalog.restoreSnapshot(catalog.createSnapshot());
    const restoredReferences = new EvidenceReferenceMap();
    restoredReferences.restoreSnapshot(references.createSnapshot());
    console.info(JSON.stringify({
      searchCacheMiB: Math.round(serializedSearch.length / 1024 / 1024),
      catalogCacheMiB: Math.round(serializedCatalog.length / 1024 / 1024),
      referenceCacheMiB: Math.round(serializedReferences.length / 1024 / 1024),
      restoreElapsedMs: Math.round(performance.now() - cacheStarted),
      restoredFiles: restoredIndex.stats.files,
      restoredChunks: restoredIndex.stats.documents,
      restoredCatalogFiles: restoredCatalog.size
    }));
    expect(restoredIndex.stats).toEqual(index.stats);
    expect(restoredCatalog.size).toBe(catalog.size);
    expect(restoredReferences.referenceCount).toBe(references.referenceCount);
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

    const mobileRetriever = new HybridWikiRetriever(
      mobileRestoredIndex,
      new LinkGraph(),
      mobileRestoredCatalog,
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
        `desktop/mobile source overlap: ${query}`
      ).toBe(true);
    }

    const mobileMs6Result = await mobileRetriever.retrieve(
      "所有ms6端口定义",
      retrievalOptionsForRange("high")
    );
    expect(mobileMs6Result.chunks.length).toBeGreaterThan(0);
    expect(mobileMs6Result.chunks.every((chunk) =>
      matchesTechnicalIdentifierFamily(["ms6"], chunk)
    )).toBe(true);

    for (const [query, identifier, subject] of [
      ["ms6端口定义", "ms6", /端口|接口|端子|管脚|connector|terminal|pin/iu],
      ["ms6功耗", "ms6", /功耗|耗电|power consumption|power|watt/iu],
      ["ms6技术条件", "ms6", /技术条件|技术规范|technical specification|specification/iu],
      ["R100019486 板上端子列表", "r100019486", /端口|端子|管脚|connector|terminal|pin/iu]
    ] as const) {
      for (const surfaceRetriever of [retriever, mobileRetriever]) {
        const shortQueryResult = await surfaceRetriever.retrieve(
          query,
          retrievalOptionsForRange("high")
        );
        expect(shortQueryResult.chunks.length, query).toBeGreaterThan(0);
        expect(shortQueryResult.chunks.every((chunk) =>
          matchesTechnicalIdentifierFamily([identifier], chunk)
        ), query).toBe(true);
        expect(shortQueryResult.chunks.some((chunk) => chunk.role === "stable-source"), query)
          .toBe(true);
        expect(shortQueryResult.chunks[0]?.role, `canonical evidence first: ${query}`)
          .toBe("stable-source");
        expect(subject.test(
          `${shortQueryResult.chunks[0]?.heading ?? ""} ${shortQueryResult.chunks[0]?.text ?? ""}`
        ), `first evidence matches subject: ${query}`).toBe(true);
        expect(shortQueryResult.chunks.some((chunk) =>
          subject.test(`${chunk.heading} ${chunk.text}`)
        ), query).toBe(true);
        expect(shortQueryResult.chunks.some((chunk) => chunk.role === "index"), query)
          .toBe(false);
      }
    }

    for (const [query, expected] of [
      ["所有ND板技术条件", /(?:^|[^a-z0-9])nd(?:[^a-z0-9]|$)/iu],
      ["消防员服务定义", /消防员服务|firefighter service/iu]
    ] as const) {
      for (const surfaceRetriever of [retriever, mobileRetriever]) {
        const naturalLanguageResult = await surfaceRetriever.retrieve(
          query,
          retrievalOptionsForRange("high")
        );
        expect(naturalLanguageResult.chunks.some((chunk) =>
          expected.test(`${chunk.path} ${chunk.title} ${chunk.heading} ${chunk.text}`)
        ), query).toBe(true);
      }
    }

    const desktopMs6Power = await retriever.retrieve(
      "所有ms6功耗",
      retrievalOptionsForRange("high")
    );
    expect(desktopMs6Power.chunks.every((chunk) =>
      matchesTechnicalIdentifierFamily(["ms6"], chunk)
    )).toBe(true);
    expect(desktopMs6Power.chunks.filter((chunk) => chunk.role === "stable-source").length)
      .toBeGreaterThanOrEqual(10);

    const mobileMs6PowerByRange: Record<string, RetrievalResult> = {};
    for (const range of ["low", "medium", "high"] as const) {
      const rangeResult = await mobileRetriever.retrieve(
        "所有ms6功耗",
        retrievalOptionsForRange(range)
      );
      mobileMs6PowerByRange[range] = rangeResult;
      expect(rangeResult.chunks.length).toBeGreaterThan(0);
      expect(rangeResult.chunks.every((chunk) =>
        matchesTechnicalIdentifierFamily(["ms6"], chunk)
      )).toBe(true);
      expect(rangeResult.chunks.some((chunk) =>
        /功耗|power consumption|watt/iu.test(`${chunk.heading} ${chunk.text}`)
      )).toBe(true);
    }
    expect(mobileMs6PowerByRange.high?.chunks.filter((chunk) => chunk.role === "stable-source").length)
      .toBeGreaterThanOrEqual(10);
    const desktopMs6PowerSources = desktopMs6Power.chunks
      .filter((chunk) => chunk.role === "stable-source")
      .map((chunk) => chunk.path)
      .sort();
    const mobileMs6PowerSources = (mobileMs6PowerByRange.high?.chunks ?? [])
      .filter((chunk) => chunk.role === "stable-source")
      .map((chunk) => chunk.path)
      .sort();
    expect(mobileMs6PowerSources).toEqual(desktopMs6PowerSources);
    console.info(JSON.stringify({
      mobileMs6PowerByRange: Object.fromEntries(Object.entries(mobileMs6PowerByRange)
        .map(([range, rangeResult]) => [range, rangeResult.chunks.map((chunk) => ({
          path: chunk.path,
          heading: chunk.heading,
          role: chunk.role,
          score: chunk.score
        }))]))
    }));
    mobileRestoredCatalog.destroy();
  }, 120_000);
});
