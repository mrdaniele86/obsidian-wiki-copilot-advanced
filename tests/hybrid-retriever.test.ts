import { describe, expect, it, vi } from "vitest";
import { HybridWikiRetriever } from "../src/core/hybrid-retriever";
import { LinkGraph } from "../src/core/link-graph";
import { WikiSearchIndex } from "../src/core/search-index";
import type { NoteMetadata } from "../src/core/types";

function metadata(path: string, role: NoteMetadata["role"]): NoteMetadata {
  return {
    path,
    basename: path.split("/").at(-1)?.replace(/\.md$/u, "") ?? path,
    aliases: [],
    tags: [],
    role
  };
}

describe("HybridWikiRetriever fast mode", () => {
  it("searches curated Wiki fragments without returning source documents", async () => {
    const index = new WikiSearchIndex();
    const summaryPath = "wiki/summaries/PCBA测试要求.md";
    const sourcePath = "raw/processed/PCBA-design-rules.md";
    index.replaceNote(
      metadata(summaryPath, "summary"),
      "# PCBA 测试要求\n\n整理后的测试点与验收要求。"
    );
    index.replaceNote(
      metadata(sourcePath, "stable-source"),
      "# PCBA design rules\n\nComplete source testing requirements."
    );
    const retriever = new HybridWikiRetriever(index, new LinkGraph());

    const result = await retriever.retrieve("PCBA测试要求", {
      includePending: true,
      maxSummaryResults: 4,
      maxStableSourceResults: 10,
      maxPendingResults: 10,
      graphExpansion: false
    });

    expect(result.chunks.map((chunk) => chunk.path)).toEqual([summaryPath]);
    expect(result.chunks.every((chunk) =>
      chunk.role !== "stable-source" && chunk.role !== "pending-source"
    )).toBe(true);
  });

  it("reports that it is searching the prepared Wiki fragments", async () => {
    const index = new WikiSearchIndex();
    index.replaceNote(
      metadata("wiki/concepts/制动.md", "concept"),
      "# 制动系统\n\n压力控制。"
    );
    const progress = vi.fn();
    const retriever = new HybridWikiRetriever(index, new LinkGraph());

    await retriever.retrieve("制动压力", { graphExpansion: false }, progress);

    expect(progress).toHaveBeenCalledWith("正在检索已整理的 Wiki 片段…");
  });

  it("merges model-planned lexical variants while remaining Wiki-only", async () => {
    const index = new WikiSearchIndex();
    const summaryPath = "wiki/summaries/Brake-validation.md";
    index.replaceNote(
      metadata(summaryPath, "summary"),
      "# Brake validation\n\nBrake inspection specification and acceptance criteria."
    );
    index.replaceNote(
      metadata("raw/processed/brake-source.md", "stable-source"),
      "# 制动测试要求\n\n原始验收要求。"
    );
    const retriever = new HybridWikiRetriever(index, new LinkGraph());

    const result = await retriever.retrievePlannedQueries(
      "制动测试要求",
      ["制动测试要求", "brake inspection specification"],
      { graphExpansion: false }
    );

    expect(result.query).toBe("制动测试要求");
    expect(result.chunks.map((chunk) => chunk.path)).toEqual([summaryPath]);
    expect(result.chunks.every((chunk) => chunk.role === "summary")).toBe(true);
  });
});
