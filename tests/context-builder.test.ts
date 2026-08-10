import { describe, expect, it } from "vitest";
import { buildAnswerContext } from "../src/core/context-builder";
import type { RetrievedChunk } from "../src/core/types";

function sourceChunk(
  id: string,
  role: "stable-source" | "pending-source",
  evidenceTier: "stable" | "unverified"
): RetrievedChunk {
  return {
    id,
    path: `raw/${role === "pending-source" ? "pending" : "processed"}/${id}.md`,
    title: `${id} source`,
    heading: "Requirements",
    headingLevel: 1,
    chunkIndex: 0,
    text: "Acceptance requirement.",
    aliases: "",
    tags: "",
    role,
    evidenceTier,
    score: 1,
    lexicalScore: 1,
    origin: "lexical"
  };
}

describe("answer context source presentation", () => {
  it("does not expose stable versus pending source status to the model or UI", () => {
    const result = buildAnswerContext({
      query: "requirements",
      chunks: [
        sourceChunk("stable", "stable-source", "stable"),
        sourceChunk("pending", "pending-source", "unverified")
      ],
      totalCandidates: 2,
      truncated: false
    });

    expect(result.context.match(/role="source"/gu)).toHaveLength(2);
    expect(result.context).not.toContain("stable-source");
    expect(result.context).not.toContain("pending-source");
    expect(result.context).not.toContain("unverified");
    expect(result.context).not.toContain("raw/pending");
    expect(result.sources.map((source) => source.evidenceTier)).toEqual(["stable", "stable"]);
    expect(result.sources.map((source) => source.path)).toEqual([
      "raw/processed/stable.md",
      "raw/pending/pending.md"
    ]);
  });
});
