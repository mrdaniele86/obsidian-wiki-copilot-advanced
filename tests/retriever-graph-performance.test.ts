import { describe, expect, it, vi } from "vitest";

const tokenizeForSearchMock = vi.hoisted(() => vi.fn<(input: string) => string[]>());

vi.mock("../src/core/tokenizer", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/core/tokenizer")>();
  tokenizeForSearchMock.mockImplementation(original.tokenizeForSearch);
  return {
    ...original,
    tokenizeForSearch: tokenizeForSearchMock
  };
});

import { LinkGraph } from "../src/core/link-graph";
import { WikiRetriever } from "../src/core/retriever";
import type { RawSearchHit, WikiSearchIndex } from "../src/core/search-index";
import type { SearchDocument } from "../src/core/types";

function document(
  id: string,
  path: string,
  chunkIndex: number,
  text: string
): SearchDocument {
  return {
    id,
    path,
    title: path,
    heading: `Section ${chunkIndex}`,
    headingLevel: 2,
    chunkIndex,
    text,
    aliases: "",
    tags: "",
    role: "concept",
    evidenceTier: "synthesis"
  };
}

describe("WikiRetriever graph expansion performance", () => {
  it("tokenizes each graph chunk at most once per query while preserving the best match", () => {
    const anchors = Array.from({ length: 8 }, (_, index) =>
      document(`anchor-${index}`, `wiki/topics/anchor-${index}.md`, 0, "needle anchor")
    );
    const targetChunks = Array.from({ length: 200 }, (_, index) =>
      document(
        `target-${index}`,
        "wiki/concepts/target.md",
        index,
        index === 137 ? "the unique needle match" : `unrelated graph content ${index}`
      )
    );
    const rawHits: RawSearchHit[] = anchors.map((anchor, index) => ({
      document: anchor,
      score: anchors.length - index
    }));
    const searchIndex = {
      search: () => rawHits,
      getChunksForPath: (path: string) =>
        path === "wiki/concepts/target.md" ? targetChunks : []
    } as unknown as WikiSearchIndex;
    const graph = new LinkGraph();
    graph.rebuild(Object.fromEntries(
      anchors.map((anchor) => [anchor.path, { "wiki/concepts/target.md": 1 }])
    ));

    tokenizeForSearchMock.mockClear();
    const result = new WikiRetriever(searchIndex, graph).retrieve("needle", {
      maxIndexResults: 0,
      maxTopicConceptResults: 9,
      maxSummaryResults: 0,
      maxWikiResults: 0,
      maxStableSourceResults: 0,
      maxRetrievedPages: 9
    });

    expect(result.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "target-137", origin: "wikilink" })
    ]));
    expect(tokenizeForSearchMock).toHaveBeenCalledTimes(targetChunks.length + 1);
  });
});
