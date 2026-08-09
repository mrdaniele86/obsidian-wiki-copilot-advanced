import { describe, expect, it, vi } from "vitest";
import { EvidenceReferenceMap } from "../src/core/evidence-references";
import { HybridWikiRetriever } from "../src/core/hybrid-retriever";
import type { EvidenceNote } from "../src/core/hybrid-retriever";
import { LinkGraph } from "../src/core/link-graph";
import { hasBreadthIntent } from "../src/core/retrieval-query";
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

    const expanded = await retriever.retrieve("列出所有MS6技术条件号", {
      maxIndexResults: 0,
      maxTopicConceptResults: 0,
      maxSummaryResults: 0,
      maxWikiResults: 0,
      maxStableSourceResults: 2,
      maxPendingResults: 0,
      maxRetrievedPages: 4,
      maxEvidenceFiles: 3,
      maxContextCharacters: 10_000,
      graphExpansion: false
    });

    expect(expanded.chunks.map((chunk) => chunk.path)).toHaveLength(3);
    expect(expanded.chunks.map((chunk) => chunk.path))
      .toEqual(expect.arrayContaining([specificationA, specificationB, usage]));
    catalog.destroy();
  });

  it("reserves a tight breadth-query budget for canonical source evidence", async () => {
    const primary = new WikiSearchIndex();
    const graph = new LinkGraph();
    const catalog = new SourceCatalogIndex();
    const references = new EvidenceReferenceMap();
    const summaryPath = "wiki/summaries/MS6端口目录摘要.md";
    const sourceA = "raw/processed/MS6-port-a.md";
    const sourceB = "raw/processed/MS6-port-b.md";
    primary.replaceNote(
      metadata(summaryPath, "summary"),
      `# MS6 端口目录摘要\n\n${"MS6 端口定义目录。".repeat(240)}`
    );
    await catalog.replaceBatchAsync([sourceA, sourceB].map((path, index) => ({
      path,
      title: `MS6 端口定义 ${index + 1}`,
      aliases: "",
      tags: "",
      headings: "端口定义",
      role: "stable-source" as const
    })));
    const notes = new Map<string, EvidenceNote>([
      [sourceA, {
        metadata: metadata(sourceA, "stable-source"),
        markdown: "# MS6 端口定义 1\n\nJP1：电源与通信端口。"
      }],
      [sourceB, {
        metadata: metadata(sourceB, "stable-source"),
        markdown: "# MS6 端口定义 2\n\nJP2：输入输出端口。"
      }]
    ]);
    const retriever = new HybridWikiRetriever(
      primary,
      graph,
      catalog,
      references,
      async (paths) => paths
        .map((path) => notes.get(path))
        .filter((note): note is EvidenceNote => note !== undefined)
    );

    const result = await retriever.retrieve("列出所有 MS6 端口定义", {
      maxIndexResults: 0,
      maxTopicConceptResults: 0,
      maxSummaryResults: 1,
      maxWikiResults: 0,
      maxStableSourceResults: 2,
      maxPendingResults: 0,
      maxRetrievedPages: 3,
      maxEvidenceFiles: 2,
      maxContextCharacters: 800,
      graphExpansion: false
    });

    expect(result.chunks.map((chunk) => chunk.path)).toEqual([sourceA, sourceB]);
    expect(result.chunks.every((chunk) => chunk.role === "stable-source")).toBe(true);
    catalog.destroy();
  });

  it("puts canonical evidence before generated summaries for an exact identifier query", async () => {
    const primary = new WikiSearchIndex();
    const graph = new LinkGraph();
    const catalog = new SourceCatalogIndex();
    const references = new EvidenceReferenceMap();
    const summaryPath = "wiki/summaries/ZX9端口摘要.md";
    const sourcePath = "raw/processed/ZX9-port-definition.md";
    primary.replaceNote(
      metadata(summaryPath, "summary"),
      "# ZX9 端口摘要\n\n## 相关概念\n\n接口附件、信号显示和软件信息。"
    );
    await catalog.replaceBatchAsync([{
      path: sourcePath,
      title: "ZX9 端口定义",
      aliases: "",
      tags: "",
      headings: "板上端子列表 端子信号定义",
      role: "stable-source"
    }]);
    const retriever = new HybridWikiRetriever(
      primary,
      graph,
      catalog,
      references,
      async () => [{
        metadata: metadata(sourcePath, "stable-source"),
        markdown: "# ZX9 端口定义\n\n## 板上端子列表\n\nJP1：24V / GND / CAN-H / CAN-L。"
      }]
    );

    const result = await retriever.retrieve("ZX9端口定义", {
      maxRetrievedPages: 4,
      maxEvidenceFiles: 2,
      maxContextCharacters: 4_000,
      graphExpansion: false
    });

    expect(result.chunks[0]).toMatchObject({
      path: sourcePath,
      role: "stable-source"
    });
    expect(result.chunks.some((chunk) => chunk.path === summaryPath)).toBe(true);
    catalog.destroy();
  });

  it("does not clear reusable evidence in the middle of a breadth query", async () => {
    const primary = new WikiSearchIndex();
    const graph = new LinkGraph();
    const catalog = new SourceCatalogIndex({ useWorker: false });
    const references = new EvidenceReferenceMap();
    const notes = new Map<string, EvidenceNote>();
    const documents = ["AA1", "BB2", "CC3"].flatMap((identifier) =>
      Array.from({ length: 16 }, (_, index) => {
        const path = `raw/processed/${identifier}-power-${String(index + 1).padStart(2, "0")}.md`;
        notes.set(path, {
          metadata: metadata(path, "stable-source"),
          markdown: `# ${identifier} 功耗 ${index + 1}\n\n${identifier} 功耗为 ${index + 1} W。`
        });
        return {
          path,
          title: `${identifier} 功耗 ${index + 1}`,
          aliases: "",
          tags: "",
          headings: "功耗",
          role: "stable-source" as const
        };
      })
    );
    await catalog.replaceBatchAsync(documents);
    const retriever = new HybridWikiRetriever(
      primary,
      graph,
      catalog,
      references,
      async (paths) => paths
        .map((path) => notes.get(path))
        .filter((note): note is EvidenceNote => note !== undefined)
    );
    const options = {
      maxIndexResults: 0,
      maxTopicConceptResults: 0,
      maxSummaryResults: 0,
      maxWikiResults: 0,
      maxStableSourceResults: 10,
      maxPendingResults: 0,
      maxRetrievedPages: 20,
      maxEvidenceFiles: 12,
      maxContextCharacters: 20_000,
      graphExpansion: false
    };

    for (const identifier of ["AA1", "BB2", "CC3", "CC3"]) {
      const result = await retriever.retrieve(`所有 ${identifier} 功耗`, options);
      expect(result.chunks).toHaveLength(12);
      expect(result.chunks.every((chunk) => chunk.path.includes(identifier))).toBe(true);
    }
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
