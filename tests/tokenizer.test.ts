import { describe, expect, it } from "vitest";
import { containsCjk, technicalIdentifierTokens, tokenizeForSearch } from "../src/core/tokenizer";

describe("tokenizeForSearch", () => {
  it("extracts exact model identifiers from mixed Chinese queries", () => {
    expect(technicalIdentifierTokens("所有MS6电路板的技术条件号")).toContain("ms6");
  });
  it("creates deterministic overlapping tokens for unspaced Chinese", () => {
    const tokens = tokenizeForSearch("知识库检索");
    expect(tokens).toEqual(expect.arrayContaining(["知识", "库", "检索"]));
    expect(containsCjk("知识库")).toBe(true);
  });

  it("keeps technical identifiers and emits useful variants", () => {
    const tokens = tokenizeForSearch("MiniSearch raw/processed A320BrakeMode");
    expect(tokens).toEqual(expect.arrayContaining([
      "minisearch",
      "raw/processed",
      "raw",
      "processed",
      "a320brakemode",
      "a320",
      "brake",
      "mode"
    ]));
  });

  it("normalizes full-width characters", () => {
    expect(tokenizeForSearch("ＡＰＩ １２３")).toEqual(expect.arrayContaining(["api", "123"]));
  });
});
