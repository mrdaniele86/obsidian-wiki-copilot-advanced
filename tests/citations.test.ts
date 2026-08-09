import { describe, expect, it } from "vitest";
import {
  citationIdFromText,
  citationTarget,
  linkifyAnswerCitations,
  normalizeAnswerCitations,
  validateAnswerCitations
} from "../src/core/citations";
import type { SourceReference } from "../src/core/types";

function source(id: string): SourceReference {
  return {
    id,
    path: `wiki/topics/${id}.md`,
    title: id,
    heading: `${id} › 压力控制`,
    role: "topic",
    evidenceTier: "synthesis",
    score: 1,
    origin: "lexical"
  };
}

const sources: SourceReference[] = [{
  ...source("S1"),
  path: "wiki/topics/制动.md",
  title: "制动",
  heading: "制动 › 压力控制"
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

  it("repairs the parenthesized citation variants produced in streamed answers", () => {
    const screenshotSources = ["S14", "S27", "S28", "S30", "S31", "S32", "S34"].map(source);
    const checked = validateAnswerCitations(
      "型号一致（S31/S32，两者端子定义相同）。缺项（S28 表格中断）。另见 (S14/S34: 功能说明)。",
      screenshotSources
    );

    expect(checked.markdown).toContain("（[S31][S32]，两者端子定义相同）");
    expect(checked.markdown).toContain("（[S28] 表格中断）");
    expect(checked.markdown).toContain("([S14][S34]: 功能说明)");
    expect(checked.citedIds).toEqual(["S31", "S32", "S28", "S14", "S34"]);
    expect(checked.markdown).not.toContain("Wiki Copilot 引用检查");
  });

  it("repairs combined bare and square-bracket source groups", () => {
    const groupedSources = ["S27", "S28", "S30"].map(source);
    expect(normalizeAnswerCitations("依据 S27/S30；补充见 [S28、S30]。", groupedSources))
      .toBe("依据 [S27][S30]；补充见 [S28][S30]。");
  });

  it("normalizes citations before direct link rendering", () => {
    const groupedSources = ["S31", "S32"].map(source);
    const rendered = linkifyAnswerCitations("定义一致（S31/S32）。", groupedSources);

    expect(rendered.match(/wiki-copilot-citation-ref/gu)).toHaveLength(2);
    expect(rendered).toContain("[[wiki/topics/S31#压力控制\\|S31]]");
    expect(rendered).toContain("[[wiki/topics/S32#压力控制\\|S32]]");
  });

  it("does not rewrite unknown IDs, code, or Markdown links", () => {
    const groupedSources = ["S1", "S2"].map(source);
    const markdown = [
      "未知编号 S31/S32 保持原样。",
      "行内代码 `S1/S2` 保持原样。",
      "链接 [S1/S2](https://example.com) 保持原样。",
      "```text",
      "S1/S2",
      "```"
    ].join("\n");

    expect(normalizeAnswerCitations(markdown, groupedSources)).toBe(markdown);
  });
});
