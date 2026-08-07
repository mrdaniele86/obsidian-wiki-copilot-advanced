import { describe, expect, it, vi } from "vitest";
import { EvidenceReferenceMap } from "../src/core/evidence-references";
import { hasBreadthIntent, HybridWikiRetriever } from "../src/core/hybrid-retriever";
import type { EvidenceNote } from "../src/core/hybrid-retriever";
import { LinkGraph } from "../src/core/link-graph";
import { WikiSearchIndex } from "../src/core/search-index";
import { SourceCatalogIndex } from "../src/core/source-catalog";
import type { NoteMetadata } from "../src/core/types";

const rawPath = "raw/processed/codes/md/制动规范.md";

function metadata(path: string, role: NoteMetadata["role"]): NoteMetadata {
  return {
    path,
    basename: path.split("/").at(-1)?.replace(/\.md$/u, "") ?? path,
    aliases: [],
    tags: [],
    role
  };
}

describe("HybridWikiRetriever", () => {
  it("recognizes exhaustive list questions", () => {
    expect(hasBreadthIntent("列出所有 MS6 技术条件号")).toBe(true);
    expect(hasBreadthIntent("MS6 的端口定义是什么")).toBe(false);
  });

  it("preserves the catalog-ranked family for exhaustive questions", async () => {
    const primary = new WikiSearchIndex();
    const graph = new LinkGraph();
    const catalog = new SourceCatalogIndex();
    const references = new EvidenceReferenceMap();
    const specificationA = "raw/processed/MS6-spec-a.md";
    const specificationB = "raw/processed/MS6-spec-b.md";
    const usage = "raw/processed/MS6-usage.md";
    await catalog.replaceBatchAsync([{
      path: specificationA,
      title: "MS6 技术条件 A",
      aliases: "",
      tags: "",
      headings: "",
      role: "stable-source"
    }, {
      path: specificationB,
      title: "MS6 技术条件 B",
      aliases: "",
      tags: "",
      headings: "",
      role: "stable-source"
    }, {
      path: usage,
      title: "MS6 使用说明",
      aliases: "",
      tags: "",
      headings: "",
      role: "stable-source"
    }]);
    const notes = new Map<string, EvidenceNote>([
      [specificationA, {
        metadata: metadata(specificationA, "stable-source"),
        markdown: "# MS6 技术条件 A\n\n编号 A-001。"
      }],
      [specificationB, {
        metadata: metadata(specificationB, "stable-source"),
        markdown: "# MS6 技术条件 B\n\n编号 B-001。"
      }],
      [usage, {
        metadata: metadata(usage, "stable-source"),
        markdown: "# MS6 使用说明\n\n所有 MS6 电路板技术条件号技术条件号技术条件号。"
      }]
    ]);
    const retriever = new HybridWikiRetriever(
      primary,
      graph,
      catalog,
      references,
      async (paths) => paths.map((path) => notes.get(path)).filter((note): note is EvidenceNote => note !== undefined)
    );

    const result = await retriever.retrieve("列出所有MS6技术条件号", {
      maxIndexResults: 0,
      maxTopicConceptResults: 0,
      maxSummaryResults: 0,
      maxWikiResults: 0,
      maxStableSourceResults: 2,
      maxPendingResults: 0,
      maxRetrievedPages: 4,
      maxEvidenceFiles: 2,
      maxContextCharacters: 10_000,
      graphExpansion: false
    });

    expect(result.chunks.map((chunk) => chunk.path)).toEqual([specificationA, specificationB]);
    catalog.destroy();
  });

  it("loads raw evidence on demand from a Summary source path", async () => {
    const primary = new WikiSearchIndex();
    const graph = new LinkGraph();
    const catalog = new SourceCatalogIndex();
    const references = new EvidenceReferenceMap();
    const summaryPath = "wiki/summaries/制动规范摘要.md";
    const summary = `# 制动规范摘要\n\n制动压力有明确上限。\n\n来源路径：\`${rawPath}\``;
    primary.replaceNote(metadata(summaryPath, "summary"), summary);
    catalog.replace({
      path: rawPath,
      title: "制动规范",
      aliases: "",
      tags: "",
      headings: "压力限值",
      role: "stable-source"
    });
    references.replace(summaryPath, summary, ["raw/processed"], (path) => catalog.hasPath(path));

    const notes: EvidenceNote[] = [{
      metadata: metadata(rawPath, "stable-source"),
      markdown: "# 制动规范\n\n## 压力限值\n\n制动压力最大值为 120 bar。"
    }];
    const loader = vi.fn(async () => notes);
    const retriever = new HybridWikiRetriever(primary, graph, catalog, references, loader);
    const result = await retriever.retrieve("制动压力最大值");

    expect(loader).toHaveBeenCalledWith(expect.arrayContaining([rawPath]));
    expect(result.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: rawPath, role: "stable-source" })
    ]));
  });

  it("uses the source catalog when no Wiki page covers the query", async () => {
    const primary = new WikiSearchIndex();
    const graph = new LinkGraph();
    const catalog = new SourceCatalogIndex();
    const references = new EvidenceReferenceMap();
    catalog.replace({
      path: rawPath,
      title: "ZXQ-991 制动规范",
      aliases: "",
      tags: "",
      headings: "特殊报码",
      role: "stable-source"
    });
    const loader = vi.fn(async () => [{
      metadata: metadata(rawPath, "stable-source"),
      markdown: "# 规范\n\n特殊报码 ZXQ-991 表示压力故障。"
    }]);
    const retriever = new HybridWikiRetriever(primary, graph, catalog, references, loader);
    const result = await retriever.retrieve("ZXQ-991");

    expect(loader).toHaveBeenCalledOnce();
    expect(result.chunks[0]).toMatchObject({ path: rawPath, evidenceTier: "stable" });
  });
});
