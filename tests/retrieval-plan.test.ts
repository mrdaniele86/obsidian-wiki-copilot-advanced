import { describe, expect, it } from "vitest";
import {
  mergeRetrievalResults,
  normalizeRetrievalQueries,
  parseRetrievalQueries,
  queryRelevance
} from "../src/core/retrieval-plan";
import type { RetrievedChunk, RetrievalResult } from "../src/core/types";

function chunk(
  id: string,
  title: string,
  text: string,
  score = 1
): RetrievedChunk {
  return {
    id,
    path: `${id}.md`,
    title,
    heading: title,
    headingLevel: 1,
    chunkIndex: 0,
    text,
    aliases: "",
    tags: "",
    role: "stable-source",
    evidenceTier: "stable",
    score,
    lexicalScore: score,
    origin: "lexical"
  };
}

function result(query: string, chunks: RetrievedChunk[]): RetrievalResult {
  return { query, chunks, totalCandidates: chunks.length, truncated: false };
}

describe("retrieval query planning", () => {
  it("parses bounded JSON and always keeps the original query first", () => {
    const queries = parseRetrievalQueries(
      "pcba测试要求",
      "```json\n{\"queries\":[\"PCBA test requirements\",\"PCBA printed circuit board assembly testing acceptance criteria\"]}\n```"
    );

    expect(queries).toEqual([
      "pcba测试要求",
      "PCBA test requirements",
      "PCBA printed circuit board assembly testing acceptance criteria"
    ]);
  });

  it("rejects expansions that drop an exact identifier or explicit acronym", () => {
    expect(normalizeRetrievalQueries("MS6 功耗", [
      "display board power consumption",
      "MS6 power consumption"
    ])).toEqual(["MS6 功耗", "MS6 power consumption"]);
    expect(normalizeRetrievalQueries("PCBA 测试", [
      "assembly testing",
      "PCBA assembly testing"
    ])).toEqual(["PCBA 测试", "PCBA assembly testing"]);
    expect(normalizeRetrievalQueries("12345 标准", [])).toEqual(["12345 标准"]);
  });

  it("keeps fast planning to the original query plus at most six variants", () => {
    const queries = parseRetrievalQueries(
      "制动测试要求",
      JSON.stringify({
        queries: [
          "brake test requirements",
          "制动系统 验收 标准",
          "braking validation criteria",
          "制动 测试 条件",
          "brake inspection specification",
          "制动性能验证",
          "制动系统测试规范"
        ]
      }),
      "fast"
    );

    expect(queries).toEqual([
      "制动测试要求",
      "brake test requirements",
      "制动系统 验收 标准",
      "braking validation criteria",
      "制动 测试 条件",
      "brake inspection specification",
      "制动性能验证"
    ]);
  });

  it("requires multiple discriminating terms for a precise multi-term match", () => {
    expect(queryRelevance("通用软件测试流程", "PCBA 测试要求").strong).toBe(false);
    expect(queryRelevance(
      "PCBA manufacturing test requirements and acceptance criteria",
      "PCBA test requirements"
    ).strong).toBe(true);
  });

  it("merges query variants and removes weak OR-only candidates in precise mode", () => {
    const relevant = chunk(
      "pcba",
      "PCBA design rules",
      "PCB testing equipment, test points and manufacturing acceptance requirements."
    );
    const weak = chunk("software", "通用软件测试", "测试流程与工具说明。", 1.2);
    const merged = mergeRetrievalResults(
      "PCBA测试要求",
      ["PCBA测试要求", "PCBA test requirements"],
      [
        result("PCBA测试要求", [weak]),
        result("PCBA test requirements", [relevant])
      ],
      true,
      8,
      10_000
    );

    expect(merged.chunks.map((item) => item.id)).toEqual(["pcba"]);
  });
});
