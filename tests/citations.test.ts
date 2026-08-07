import { describe, expect, it } from "vitest";
import {
  citationIdFromText,
  citationTarget,
  linkifyAnswerCitations,
  validateAnswerCitations
} from "../src/core/citations";
import type { SourceReference } from "../src/core/types";

const sources: SourceReference[] = [{
  id: "S1",
  path: "wiki/topics/制动.md",
  title: "制动",
  heading: "制动 › 压力控制",
  role: "topic",
  evidenceTier: "synthesis",
  score: 1,
  origin: "lexical"
}];

describe("answer citations", () => {
  it("links valid source markers to the exact Obsidian heading", () => {
    expect(linkifyAnswerCitations("压力受控。[S1]", sources))
      .toBe("压力受控。<sup class=\"wiki-copilot-citation-ref\">[[wiki/topics/制动#压力控制\\|S1]]</sup>");
  });

  it("keeps citation Wikilinks inside one Markdown table cell", () => {
    expect(linkifyAnswerCitations("| 结论 |\n| --- |\n| 压力受控 [S1] |", sources))
      .toContain("压力受控 <sup class=\"wiki-copilot-citation-ref\">[[wiki/topics/制动#压力控制\\|S1]]</sup> |");
  });

  it("maps rendered citation labels back to their exact source target", () => {
    expect(citationIdFromText(" S1 ")).toBe("S1");
    expect(citationIdFromText("[S1]")).toBe("S1");
    expect(citationIdFromText("source S1")).toBeNull();
    expect(citationTarget(sources[0]!)).toBe("wiki/topics/制动#压力控制");
  });

  it("flags missing and invalid model citations", () => {
    const invalid = validateAnswerCitations("一个结论。[S9]", sources);
    expect(invalid.invalidIds).toEqual(["S9"]);
    expect(invalid.markdown).toContain("引用检查");

    const missing = validateAnswerCitations("一个没有引用的结论。", sources);
    expect(missing.markdown).toContain("未包含有效来源标记");
  });
});
