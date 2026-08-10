import { describe, expect, it } from "vitest";
import { answerTimeoutMessage } from "../src/core/answer-error";

describe("answer timeout copy", () => {
  it("explains that retrieval completed and suggests fast mode", () => {
    expect(answerTimeoutMessage("DeepSeek", 180_000, "precise")).toBe(
      "本地检索已完成，但 DeepSeek 在 180 秒内未返回回答。请重试；若仍超时，可在设置中切换为“快速”检索。"
    );
  });

  it("suggests a faster model when fast mode already timed out", () => {
    expect(answerTimeoutMessage("自建服务", 90_000, "fast")).toBe(
      "本地检索已完成，但 自建服务 在 90 秒内未返回回答。请稍后重试；若仍超时，可更换响应更快的模型。"
    );
  });
});
