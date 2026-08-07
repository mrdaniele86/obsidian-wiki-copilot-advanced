import { describe, expect, it } from "vitest";
import { LinkGraph } from "../src/core/link-graph";
import { WikiSearchIndex } from "../src/core/search-index";
import type { MarkdownChunk, NoteMetadata } from "../src/core/types";

const metadata: NoteMetadata = {
  path: "wiki/topics/响应性.md",
  basename: "响应性",
  aliases: [],
  tags: [],
  role: "topic"
};

describe("cooperative indexing", () => {
  it("yields while adding many MiniSearch chunks without changing retrieval", async () => {
    const index = new WikiSearchIndex();
    const chunks = Array.from({ length: 24 }, (_, chunkIndex): MarkdownChunk => ({
      id: `${metadata.path}::${chunkIndex}`,
      path: metadata.path,
      title: "响应性",
      heading: `章节 ${chunkIndex}`,
      headingLevel: 2,
      chunkIndex,
      text: chunkIndex === 23 ? "最后一段包含唯一术语 ZXQ-RESPONSIVE" : `普通内容 ${chunkIndex}`
    }));
    let yields = 0;

    await index.replaceChunksAsync(metadata, chunks, async () => {
      yields += 1;
    });

    expect(yields).toBeGreaterThanOrEqual(3);
    expect(index.search("ZXQ-RESPONSIVE")[0]?.document.chunkIndex).toBe(23);
  });

  it("builds a large Wikilink graph in slices and applies it atomically", async () => {
    const graph = new LinkGraph();
    const links = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `wiki/source-${index}.md`,
        { [`wiki/target-${index}.md`]: 1 }
      ])
    );
    let yields = 0;

    const applied = await graph.rebuildAsync(links, () => true, async () => {
      yields += 1;
    });

    expect(applied).toBe(true);
    expect(yields).toBeGreaterThan(0);
    expect(graph.neighbors("wiki/source-79.md")[0]?.path).toBe("wiki/target-79.md");
  });
});
