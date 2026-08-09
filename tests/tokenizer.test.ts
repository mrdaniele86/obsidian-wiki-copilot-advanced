import { describe, expect, it } from "vitest";
import { containsCjk, technicalIdentifierTokens, tokenizeForSearch } from "../src/core/tokenizer";

describe("tokenizeForSearch", () => {
  it("extracts exact identifiers from mixed Chinese queries", () => {
    expect(technicalIdentifierTokens("所有MS6电路板的技术条件号")).toContain("ms6");
  });

  it("normalizes identifiers from unrelated domains and separator styles", () => {
    expect(technicalIdentifierTokens(
      "Python 3、ISO-9001、RFC 9110、GPT-4o 与 ZXQ-991"
    )).toEqual(expect.arrayContaining([
      "python3",
      "iso9001",
      "rfc9110",
      "gpt4o",
      "zxq991"
    ]));
  });
  it("creates deterministic overlapping tokens for unspaced Chinese", () => {
    const tokens = tokenizeForSearch("知识库检索");
    expect(tokens).toEqual(expect.arrayContaining(["知识", "库", "检索"]));
    expect(containsCjk("知识库")).toBe(true);
  });

  it("keeps technical identifiers and emits useful variants", () => {
    const tokens = tokenizeForSearch("MiniSearch raw/processed A320BrakeMode XMLParser");
    expect(tokens).toEqual(expect.arrayContaining([
      "minisearch",
      "raw/processed",
      "raw",
      "processed",
      "a320brakemode",
      "a320",
      "brake",
      "mode",
      "xmlparser",
      "xml",
      "parser"
    ]));
  });

  it("normalizes full-width characters", () => {
    expect(tokenizeForSearch("ＡＰＩ １２３")).toEqual(expect.arrayContaining(["api", "123"]));
  });
});
