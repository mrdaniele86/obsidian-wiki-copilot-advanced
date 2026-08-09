import { describe, expect, it } from "vitest";
import { EvidenceReferenceMap } from "../src/core/evidence-references";
import { shouldRestoreIndexSynchronously, WikiSearchIndex } from "../src/core/search-index";
import type { WikiSearchIndexSnapshot } from "../src/core/search-index";
import { SourceCatalogIndex } from "../src/core/source-catalog";
import type { NoteMetadata } from "../src/core/types";

const metadata: NoteMetadata = {
  path: "wiki/concepts/MS6 功耗.md",
  basename: "MS6 功耗",
  aliases: ["MS6 power"],
  tags: ["功耗"],
  role: "concept"
};

describe("persistent index snapshots", () => {
  it("uses synchronous cache restore only while the WebView cannot paint", () => {
    expect(shouldRestoreIndexSynchronously(null)).toBe(false);
    expect(shouldRestoreIndexSynchronously({ visibilityState: "visible", hasFocus: () => true }))
      .toBe(false);
    expect(shouldRestoreIndexSynchronously({ visibilityState: "hidden", hasFocus: () => false }))
      .toBe(true);
    expect(shouldRestoreIndexSynchronously({ visibilityState: "visible", hasFocus: () => false }))
      .toBe(true);
  });

  it("restores the MiniSearch index without reading and chunking Markdown again", async () => {
    const original = new WikiSearchIndex();
    original.replaceNote(metadata, "# MS6 功耗\n\n待机功耗与运行功耗应分别核对。");
    const serialized = JSON.stringify(original.createSnapshot());
    const restored = new WikiSearchIndex();

    await restored.restoreSnapshot(JSON.parse(serialized) as WikiSearchIndexSnapshot);

    expect(restored.stats).toEqual(original.stats);
    expect(restored.search("MS6功耗")[0]?.document.path).toBe(metadata.path);
    expect(restored.getChunksForPath(metadata.path)[0]?.text).toContain("待机功耗");
  });

  it("cooperatively rebuilds MiniSearch from document-only mobile snapshots", async () => {
    const original = new WikiSearchIndex();
    original.replaceNote(metadata, "# MS6 功耗\n\n待机功耗与运行功耗应分别核对。");
    const mobileSnapshot = original.createSnapshot({ includeSerializedIndex: false });
    const restored = new WikiSearchIndex();

    expect(mobileSnapshot.index).toBeNull();
    await restored.restoreSnapshot(mobileSnapshot);

    expect(restored.stats).toEqual(original.stats);
    expect(restored.search("待机功耗")[0]?.document.path).toBe(metadata.path);
  });

  it("keeps repeated replacements stable after the former auto-vacuum threshold", async () => {
    const index = new WikiSearchIndex();

    for (let version = 0; version < 40; version += 1) {
      const marker = version === 0
        ? "obsoletezero"
        : version === 39
          ? "currentforty"
          : `intermediate${version}`;
      index.replaceNote(metadata, `# MS6 功耗\n\n版本 ${version} 的唯一内容 ${marker}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(index.stats.files).toBe(1);
    expect(index.search("currentforty")[0]?.document.path).toBe(metadata.path);
    expect(index.search("obsoletezero")).toEqual([]);
  });

  it("restores the source catalog and Wiki-to-source references", async () => {
    const originalCatalog = new SourceCatalogIndex();
    await originalCatalog.replaceAsync({
      path: "raw/processed/ms6.md",
      title: "MS6 功耗规范",
      aliases: "",
      tags: "功耗",
      headings: "待机功耗 运行功耗",
      role: "stable-source"
    });
    const restoredCatalog = new SourceCatalogIndex();
    await restoredCatalog.restoreSnapshot(originalCatalog.createSnapshot());

    const references = new EvidenceReferenceMap();
    references.restoreSnapshot([[
      metadata.path,
      ["raw/processed/ms6.md"]
    ]]);

    expect((await restoredCatalog.searchAsync("MS6功耗", false))[0]?.path)
      .toBe("raw/processed/ms6.md");
    expect(references.relatedTo([metadata.path])).toEqual(["raw/processed/ms6.md"]);
    originalCatalog.destroy();
    restoredCatalog.destroy();
  });

  it("keeps exact model-family matches ahead of generic document-type matches", async () => {
    const catalog = new SourceCatalogIndex();
    await catalog.replaceBatchAsync([{
      path: "raw/processed/MS6.md",
      title: "Technical Specification of MS6",
      aliases: "",
      tags: "",
      headings: "",
      role: "stable-source"
    }, {
      path: "raw/processed/MS5.md",
      title: "电路板 MS5 技术条件",
      aliases: "",
      tags: "",
      headings: "",
      role: "stable-source"
    }]);

    const hits = await catalog.searchAsync("所有MS6电路板的技术条件号", false, 10);

    expect(hits.map((hit) => hit.path)).toEqual(["raw/processed/MS6.md"]);
    catalog.destroy();
  });
});
