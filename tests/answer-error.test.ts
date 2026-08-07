import { describe, expect, it } from "vitest";
import { answerTimeoutMessage } from "../src/core/answer-error";

describe("answer timeout copy", () => {
  it("explains that retrieval completed and suggests a lower range", () => {
    expect(answerTimeoutMessage("DeepSeek", 180_000, "high")).toBe(
      "本地检索已完成，但 DeepSeek 在 180 秒内未返回回答。请重试；若仍超时，可将“范围与深度”调为“中”。"
    );
  });

  it("suggests a faster model when the range is already low", () => {
    expect(answerTimeoutMessage("自建服务", 90_000, "low")).toBe(
      "本地检索已完成，但 自建服务 在 90 秒内未返回回答。请稍后重试；若仍超时，可更换响应更快的模型。"
    );
  });
});
