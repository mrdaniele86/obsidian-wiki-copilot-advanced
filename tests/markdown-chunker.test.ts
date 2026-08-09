import { describe, expect, it } from "vitest";
import { chunkMarkdown, compactMarkdownChunks } from "../src/core/markdown-chunker";

describe("chunkMarkdown", () => {
  it("removes frontmatter and preserves the heading hierarchy", () => {
    const chunks = chunkMarkdown("wiki/topics/制动.md", `---
aliases: [Brake]
secret: should-not-be-indexed
---
# 制动系统

总览正文。

## 压力控制

压力由控制器调节。
`);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ title: "制动系统", heading: "制动系统" });
    expect(chunks[1]).toMatchObject({ heading: "制动系统 › 压力控制" });
    expect(chunks.map((chunk) => chunk.text).join(" ")).not.toContain("should-not-be-indexed");
  });

  it("does not treat headings inside code fences as sections", () => {
    const chunks = chunkMarkdown("wiki/example.md", `# Example

\`\`\`md
# Not a heading
\`\`\`

After the fence.
`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("# Not a heading");
  });

  it("splits oversized sections without exceeding the configured limit", () => {
    const chunks = chunkMarkdown(
      "wiki/long.md",
      `# Long\n\n${"很长的段落。".repeat(120)}`,
      { maxCharacters: 180, overlapCharacters: 20 }
    );
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.text.length <= 180)).toBe(true);
  });

  it("merges adjacent sections for the low-memory mobile index", () => {
    const markdown = [
      "# MS6 功耗",
      "总览。",
      "## 型号 A",
      "功耗 1W。",
      "## 型号 B",
      "功耗 2W。"
    ].join("\n\n");

    const regular = chunkMarkdown("wiki/MS6.md", markdown);
    const compact = compactMarkdownChunks("wiki/MS6.md", markdown, 1_000);

    expect(regular).toHaveLength(3);
    expect(compact).toHaveLength(1);
    expect(compact[0]?.heading).toContain("型号 A");
    expect(compact[0]?.text).toContain("功耗 2W");
  });
});
