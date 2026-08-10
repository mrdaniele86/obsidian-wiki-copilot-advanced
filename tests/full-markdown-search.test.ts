import { describe, expect, it } from "vitest";
import { FullMarkdownSearchMatcher } from "../src/core/full-markdown-search";
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

describe("FullMarkdownSearchMatcher", () => {
  it("uses model-planned phrases to find relevant content in an arbitrary Markdown source", () => {
    const path = "raw/pending/restricted/md/标准/PCBA design rules.md";
    const note = metadata(path, "pending-source");
    const markdown = [
      "# Electronic design rules",
      "",
      "## PCB testing requirements",
      "",
      "Manufacturing shall provide test equipment documentation.",
      "Critical circuits require test points and acceptance criteria."
    ].join("\n");
    const matcher = new FullMarkdownSearchMatcher("PCBA测试要求", [
      "PCBA测试要求",
      "PCBA PCB testing requirements",
      "PCBA manufacturing test points acceptance criteria"
    ]);
    const fileScore = matcher.scoreFile(path, markdown);

    expect(fileScore).not.toBeNull();
    expect(matcher.chunksForNote(note, markdown, fileScore ?? 0)).toEqual([
      expect.objectContaining({
        path,
        heading: "Electronic design rules › PCB testing requirements",
        role: "pending-source",
        evidenceTier: "unverified"
      })
    ]);
  });

  it("keeps exact identifiers as a boundary even when generic planned terms match", () => {
    const matcher = new FullMarkdownSearchMatcher("MS6 功耗", [
      "MS6 power consumption",
      "MS6 watt power test"
    ]);

    expect(matcher.scoreFile(
      "raw/processed/MC2-B power.md",
      "# MC2-B power consumption\n\nMS6 is mentioned only as a comparison."
    )).not.toBeNull();
    const chunks = matcher.chunksForNote(
      metadata("raw/processed/MC2-B power.md", "stable-source"),
      "# MC2-B power consumption\n\nMS6 is mentioned only as a comparison.",
      1
    );
    expect(chunks).toEqual([]);
  });

  it("does not accept a weak one-word overlap for a multi-term query", () => {
    const matcher = new FullMarkdownSearchMatcher("PCBA 测试要求", [
      "PCBA testing requirements"
    ]);

    expect(matcher.scoreFile(
      "raw/processed/software-test.md",
      "# 通用软件测试\n\n这里只描述软件测试流程和测试工具。"
    )).toBeNull();
  });
});
