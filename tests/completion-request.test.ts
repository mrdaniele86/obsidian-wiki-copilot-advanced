import { describe, expect, it } from "vitest";
import { completionRequestOptions } from "../src/llm/completion-request";

describe("completion request options", () => {
  it("uses fast non-thinking mode for the built-in DeepSeek provider", () => {
    expect(completionRequestOptions({ provider: "deepseek" })).toEqual({
      max_tokens: 4_096,
      thinking: { type: "disabled" }
    });
  });

  it("does not send DeepSeek-specific parameters to other compatible services", () => {
    expect(completionRequestOptions({ provider: "openai" })).toEqual({});
    expect(completionRequestOptions({ provider: "custom" })).toEqual({});
  });
});
