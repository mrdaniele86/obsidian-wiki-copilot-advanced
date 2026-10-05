import { describe, expect, it } from "vitest";
import {
  discardUnanchoredTechnicalResult,
  exactIdentifierMissingMessage,
  hasTechnicalIdentifierAnchor,
  keepTechnicalIdentifierFamily,
  lexicalRescueTokens,
  lexicalSubstringScore,
  matchesTechnicalIdentifierFamily,
  retrievalQueryForQuestion,
  technicalQuerySubjectTokens
} from "../src/core/retrieval-query";
import type { RetrievalResult, RetrievedChunk } from "../src/core/types";

function chunk(path: string, title: string): RetrievedChunk {
  return {
    id: `${path}::0`,
    path,
    title,
    heading: "端口定义",
    headingLevel: 1,
    chunkIndex: 0,
    text: title,
    aliases: "",
    tags: "",
    role: "summary",
    evidenceTier: "synthesis",
    score: 1,
    lexicalScore: 1,
    origin: "lexical"
  };
}

function result(chunks: RetrievedChunk[]): RetrievalResult {
  return { query: "", chunks, totalCandidates: chunks.length, truncated: false };
}

describe("retrieval query continuity", () => {
  it("does not pollute a short standalone identifier query with the previous turn", () => {
    expect(retrievalQueryForQuestion("所有ms6端口定义", [
      { role: "user", content: "XY 端口重定义参数" },
      { role: "assistant", content: "上一轮回答" }
    ])).toBe("所有ms6端口定义");
  });

  it("retains the previous turn only for an explicit follow-up", () => {
    expect(retrievalQueryForQuestion("这个型号的端口呢", [
      { role: "user", content: "MS6-3.7V-WTI-C 是什么" }
    ])).toBe("MS6-3.7V-WTI-C 是什么\n这个型号的端口呢");

    expect(retrievalQueryForQuestion("功耗呢", [
      { role: "user", content: "MS6-3.7V-WTI-C 是什么" }
    ])).toBe("MS6-3.7V-WTI-C 是什么\n功耗呢");
  });

  it("lets a new explicit identifier override the previous conversation for retrieval", () => {
    expect(retrievalQueryForQuestion("那 MC2-B 呢", [
      { role: "user", content: "MS6-3.7V-WTI-C 是什么" }
    ])).toBe("那 MC2-B 呢");
  });
});

describe("query-time lexical rescue", () => {
  it("does not inject a built-in vocabulary from any specific domain", () => {
    const terms = lexicalRescueTokens("所有 MS6 功耗");

    expect(terms).toContain("功耗");
    expect(terms).not.toContain("power");
    expect(terms).not.toContain("watt");
  });

  it("keeps identifiers and useful Chinese terms while dropping request boilerplate", () => {
    const terms = lexicalRescueTokens("请列出所有 MS6 功耗资料");

    expect(terms[0]).toBe("ms6");
    expect(terms).toContain("功耗");
    expect(terms).not.toContain("所有");
    expect(terms).not.toContain("资料");
  });

  it("scores direct path or content matches without requiring a persistent index", () => {
    const terms = lexicalRescueTokens("消防员服务定义");

    expect(lexicalSubstringScore("wiki/concepts/消防员服务.md", terms)).toBeGreaterThan(0);
    expect(lexicalSubstringScore("完全无关的知识页", terms)).toBe(0);
  });
});

describe("technical identifier integrity", () => {
  const ms6 = chunk("wiki/summaries/MS6.md", "MS6 端口定义");
  const mcx = chunk("wiki/summaries/MCX.md", "MCX 端口定义");

  it("separates the subject from an identifier without requiring spaces", () => {
    expect(technicalQuerySubjectTokens("所有ms6功耗")).toEqual(
      expect.arrayContaining(["功耗"])
    );
  });

  it("detects when a result set has lost the requested model anchor", () => {
    expect(hasTechnicalIdentifierAnchor("所有ms6端口定义", result([mcx]))).toBe(false);
    expect(hasTechnicalIdentifierAnchor("所有ms6端口定义", result([mcx, ms6]))).toBe(true);
  });

  it("removes unrelated graph-expanded product families when an exact family exists", () => {
    expect(keepTechnicalIdentifierFamily("所有ms6端口定义", [mcx, ms6]))
      .toEqual([ms6]);
  });

  it("returns no unrelated family when the requested identifier is missing", () => {
    expect(keepTechnicalIdentifierFamily("所有ms6功耗", [mcx])).toEqual([]);
  });

  it("clears unrelated evidence at the final model boundary", () => {
    expect(discardUnanchoredTechnicalResult("所有ms6功耗", result([mcx]))).toMatchObject({
      chunks: [],
      truncated: true
    });
    expect(discardUnanchoredTechnicalResult("所有ms6功耗", result([ms6])).chunks).toEqual([ms6]);
    expect(discardUnanchoredTechnicalResult("所有ms6功耗", result([mcx, ms6])).chunks)
      .toEqual([ms6]);
  });

  it("uses a domain-neutral no-substitution answer when an exact identifier is unavailable", () => {
    const message = exactIdentifierMissingMessage("所有ms6功耗", (identifiers) => `Missing ${identifiers}`);
    expect(message).toContain("MS6");
    expect(message).toContain("Missing");
    expect(message).not.toContain("iCloud");
    expect(message).not.toContain("其他型号");
    expect(exactIdentifierMissingMessage("电路板功耗", (identifiers) => identifiers)).toBeNull();
  });

  it("limits hard no-substitution behavior to strong identifiers", () => {
    expect(hasTechnicalIdentifierAnchor("8x300", result([mcx]))).toBe(true);
    expect(discardUnanchoredTechnicalResult("8x300", result([mcx])).chunks).toEqual([mcx]);
    expect(exactIdentifierMissingMessage("8x300", (identifiers) => `Missing ${identifiers}`)).toBeNull();

    expect(hasTechnicalIdentifierAnchor("MS6", result([mcx]))).toBe(false);
    expect(discardUnanchoredTechnicalResult("MS6", result([mcx])).chunks).toEqual([]);
    expect(exactIdentifierMissingMessage("MS6", (identifiers) => `Missing ${identifiers}`)).toBe("Missing MS6");
    expect(exactIdentifierMissingMessage("PCBA-001", (identifiers) => `Missing ${identifiers}`))
      .toBe("Missing PCBA001");
  });

  it("prioritizes subject-relevant chunks without dropping the rest of the requested family", () => {
    const overview = { ...ms6, id: "overview", heading: "MS6 概览", text: "型号与安装说明" };
    const power = { ...ms6, id: "power", heading: "MS6 功耗", text: "额定功耗 2W" };

    expect(keepTechnicalIdentifierFamily("所有ms6功耗", [overview, power]))
      .toEqual([power, overview]);
    expect(keepTechnicalIdentifierFamily("ms6功耗", [overview, power]))
      .toEqual([power, overview]);
  });

  it("orders a short model query by subject while preserving related family context", () => {
    const software = { ...ms6, id: "software", heading: "软件信息", text: "通信接口版本" };
    const ports = {
      ...ms6,
      id: "ports",
      heading: "板上端子列表",
      text: "端子号、管脚、信号定义与输入端口规格"
    };

    expect(keepTechnicalIdentifierFamily("ms6端口定义", [software, ports]))
      .toEqual([ports, software]);
  });

  it("keeps a generic Wiki page with an exact body anchor but rejects a conflicting model page", () => {
    const generic = {
      ...ms6,
      id: "generic",
      path: "wiki/topics/显示板功耗.md",
      title: "显示板功耗",
      heading: "功耗比较",
      text: "MS6 额定功耗与测试条件。"
    };
    const conflicting = {
      ...mcx,
      id: "conflicting",
      path: "wiki/summaries/MC2功耗.md",
      title: "MC2 功耗",
      heading: "与其他型号比较",
      text: "MC2 与 MS6 的功耗比较。"
    };

    expect(matchesTechnicalIdentifierFamily(["ms6"], generic)).toBe(true);
    expect(matchesTechnicalIdentifierFamily(["ms6"], conflicting)).toBe(false);
    expect(keepTechnicalIdentifierFamily("所有ms6功耗", [conflicting, generic]))
      .toEqual([generic]);
  });

  it("does not treat a catalog mention as exact model evidence", () => {
    const catalog = {
      ...ms6,
      id: "catalog",
      path: "index.md",
      title: "Index",
      heading: "来源目录",
      role: "index" as const,
      evidenceTier: "navigation" as const,
      text: "MS6 技术条件；MF4-U 端口定义；DSC 端口定义。"
    };

    expect(matchesTechnicalIdentifierFamily(["ms6"], catalog)).toBe(false);
    expect(hasTechnicalIdentifierAnchor("ms6端口定义", result([catalog]))).toBe(false);
    expect(discardUnanchoredTechnicalResult("ms6端口定义", result([catalog])).chunks)
      .toEqual([]);
  });
});
