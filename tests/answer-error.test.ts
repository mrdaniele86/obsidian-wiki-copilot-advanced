import { describe, expect, it } from "vitest";
import { answerTimeoutDetails } from "../src/core/answer-error";

describe("answer timeout semantics", () => {
  it("keeps precise-mode timeout details independent of display language", () => {
    expect(answerTimeoutDetails("DeepSeek", 180_000, "precise")).toEqual({
      service: "DeepSeek",
      seconds: 180,
      mode: "precise"
    });
  });

  it("keeps fast-mode timeout details independent of display language", () => {
    expect(answerTimeoutDetails("Custom", 90_000, "fast")).toEqual({
      service: "Custom",
      seconds: 90,
      mode: "fast"
    });
  });
});
