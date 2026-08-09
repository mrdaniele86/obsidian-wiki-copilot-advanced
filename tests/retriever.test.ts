import { describe, expect, it } from "vitest";
import { LinkGraph } from "../src/core/link-graph";
import { WikiRetriever } from "../src/core/retriever";
import { WikiSearchIndex } from "../src/core/search-index";
import type { KnowledgeRole, NoteMetadata } from "../src/core/types";

function add(index: WikiSearchIndex, path: string, role: KnowledgeRole, markdown: string): void {
  const metadata: NoteMetadata = {
    path,
    basename: path.split("/").at(-1)?.replace(/\.md$/u, "") ?? path,
    aliases: [],
    tags: [],
    role
  };
  index.replaceNote(metadata, markdown);
}

describe("WikiRetriever", () => {
  it("applies exact identifier retrieval outside product-model domains", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "wiki/summaries/Python 3.md", "summary", "# Python 3\n\n类型标注与迁移说明。");
    add(index, "wiki/summaries/Python 2.md", "summary", "# Python 2\n\n旧版类型系统说明。");

    const result = new WikiRetriever(index, graph).retrieve("Python3 类型标注", {
      graphExpansion: false
    });

    expect(result.chunks.map((chunk) => chunk.path)).toContain("wiki/summaries/Python 3.md");
    expect(result.chunks.map((chunk) => chunk.path)).not.toContain("wiki/summaries/Python 2.md");
  });

  it("treats an exact technical identifier as an anchor instead of generic query prose", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "wiki/summaries/MS6.md", "summary", "# Technical Specification of MS6\n\nMS6 family document.");
    add(index, "wiki/summaries/MS5.md", "summary", "# 电路板 MS5 技术条件\n\n电路板技术条件号完整清单。");

    const result = new WikiRetriever(index, graph).retrieve("所有MS6电路板的技术条件号", {
      graphExpansion: false
    });

    expect(result.chunks.map((chunk) => chunk.path)).toEqual(["wiki/summaries/MS6.md"]);
  });

  it("retains generic Wiki synthesis anchored in body text without admitting a conflicting model", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "wiki/summaries/MS6.md", "summary", "# MS6 规范\n\nMS6 功耗资料。");
    add(index, "wiki/topics/显示板功耗.md", "topic", "# 显示板功耗\n\nMS6 额定功耗汇总。");
    add(index, "wiki/summaries/MC2功耗.md", "summary", "# MC2 功耗\n\nMC2 与 MS6 功耗对比。");

    const result = new WikiRetriever(index, graph).retrieve("所有MS6功耗", {
      graphExpansion: false
    });

    expect(result.chunks.map((chunk) => chunk.path)).toEqual(expect.arrayContaining([
      "wiki/summaries/MS6.md",
      "wiki/topics/显示板功耗.md"
    ]));
    expect(result.chunks.map((chunk) => chunk.path)).not.toContain("wiki/summaries/MC2功耗.md");
  });

  it("prioritizes Wiki synthesis while retaining stable evidence", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "wiki/topics/制动.md", "topic", "# 制动\n\n制动压力由控制回路调节。 ");
    add(index, "wiki/summaries/规范.md", "summary", "# 规范摘要\n\n制动压力的规范摘要。 ");
    add(index, "raw/processed/codes/md/规范.md", "stable-source", "# 原始规范\n\n制动压力最大值为 120 bar。 ");
    add(index, "raw/pending/codes/md/草稿.md", "pending-source", "# 草稿\n\n制动压力可能为 999 bar。 ");

    const result = new WikiRetriever(index, graph).retrieve("制动压力最大值", {
      maxIndexResults: 0,
      graphExpansion: false
    });
    expect(result.chunks.map((chunk) => chunk.role)).toEqual(expect.arrayContaining(["topic", "summary", "stable-source"]));
    expect(result.chunks.some((chunk) => chunk.role === "pending-source")).toBe(false);
  });

  it("marks pending evidence only when explicitly enabled", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "raw/pending/codes/md/草稿.md", "pending-source", "# 草稿\n\n独有代号 ZXQ-991。 ");

    const retriever = new WikiRetriever(index, graph);
    expect(retriever.retrieve("ZXQ-991").chunks).toHaveLength(0);
    const enabled = retriever.retrieve("ZXQ-991", { includePending: true });
    expect(enabled.chunks[0]).toMatchObject({ role: "pending-source", evidenceTier: "unverified" });
  });

  it("expands a lexical hit through one-hop Wikilinks", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "wiki/topics/制动.md", "topic", "# 制动专题\n\n液压制动总览与故障分析。 ");
    add(index, "wiki/concepts/控制器.md", "concept", "# 控制器\n\n负责闭环执行。 ");
    graph.rebuild({
      "wiki/topics/制动.md": { "wiki/concepts/控制器.md": 1 }
    });

    const result = new WikiRetriever(index, graph).retrieve("液压制动故障", {
      maxIndexResults: 0,
      maxSummaryResults: 0,
      maxStableSourceResults: 0
    });
    expect(result.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "wiki/concepts/控制器.md", origin: "wikilink" })
    ]));
  });

  it("does not expand a Wikilink candidate into a second hop", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    add(index, "wiki/topics/入口.md", "topic", "# 入口\n\n唯一检索词 alphaquery。");
    add(index, "wiki/concepts/一跳.md", "concept", "# 一跳\n\n第一层关联内容。");
    add(index, "wiki/concepts/二跳.md", "concept", "# 二跳\n\n第二层关联内容。");
    graph.rebuild({
      "wiki/topics/入口.md": { "wiki/concepts/一跳.md": 1 },
      "wiki/concepts/一跳.md": { "wiki/concepts/二跳.md": 1 }
    });

    const result = new WikiRetriever(index, graph).retrieve("alphaquery", {
      maxIndexResults: 0,
      maxSummaryResults: 0,
      maxStableSourceResults: 0
    });

    expect(result.chunks.map((chunk) => chunk.path)).toContain("wiki/concepts/一跳.md");
    expect(result.chunks.map((chunk) => chunk.path)).not.toContain("wiki/concepts/二跳.md");
  });

  it("keeps the expanded default evidence quota", () => {
    const index = new WikiSearchIndex();
    const graph = new LinkGraph();
    const addMany = (role: KnowledgeRole, root: string, count: number): void => {
      for (let item = 0; item < count; item += 1) {
        add(index, `${root}/${item}.md`, role, `# ${role} ${item}\n\nrecallkey evidence ${item}`);
      }
    };
    addMany("index", "navigation", 3);
    addMany("topic", "wiki/topics", 6);
    addMany("summary", "wiki/summaries", 10);
    addMany("wiki", "wiki/notes", 6);
    addMany("stable-source", "raw/processed", 10);

    const result = new WikiRetriever(index, graph).retrieve("recallkey", {
      graphExpansion: false
    });
    const roleCount = (role: KnowledgeRole): number =>
      result.chunks.filter((chunk) => chunk.role === role).length;

    expect(result.chunks).toHaveLength(24);
    expect(new Set(result.chunks.map((chunk) => chunk.path)).size).toBe(24);
    expect(roleCount("index")).toBe(1);
    expect(roleCount("topic")).toBe(4);
    expect(roleCount("summary")).toBe(8);
    expect(roleCount("wiki")).toBe(4);
    expect(roleCount("stable-source")).toBe(7);
  });
});
