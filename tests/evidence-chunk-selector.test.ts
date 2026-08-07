import { describe, expect, it } from "vitest";
import {
  selectRelevantEvidenceChunks,
  selectRelevantEvidenceChunksAsync
} from "../src/core/evidence-chunk-selector";

describe("selectRelevantEvidenceChunks", () => {
  it("keeps the relevant section from a large routed source", () => {
    const markdown = [
      "# 标准",
      ...Array.from({ length: 30 }, (_, index) => `\n## 普通章节 ${index}\n\n这是与问题无关的通用内容 ${index}。`),
      "\n## 压力限值\n\n制动压力最大值为 120 bar，超过时应触发保护。"
    ].join("\n");
    const chunks = selectRelevantEvidenceChunks("raw/processed/标准.md", markdown, "制动压力最大值", 4);
    expect(chunks.some((chunk) => chunk.heading.includes("压力限值"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("120 bar"))).toBe(true);
  });

  it("keeps the same relevant evidence when large-file scoring yields to the UI", async () => {
    const markdown = [
      "# 大型标准",
      ...Array.from({ length: 80 }, (_, index) => `\n## 章节 ${index}\n\n一般性条文 ${index}。`),
      "\n## 目标条文\n\n故障代码 ZXQ-991 表示压力异常。"
    ].join("\n");

    const chunks = await selectRelevantEvidenceChunksAsync(
      "raw/processed/大型标准.md",
      markdown,
      "ZXQ-991 压力异常",
      4
    );
    expect(chunks.some((chunk) => chunk.heading.includes("目标条文"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("ZXQ-991"))).toBe(true);
  });
});
