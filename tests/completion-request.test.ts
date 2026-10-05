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

  it("sets a conservative output limit only for the exact Groq API host", () => {
    expect(completionRequestOptions({
      provider: "custom",
      endpoint: "https://API.GROQ.COM/openai/v1/"
    })).toEqual({ max_tokens: 512 });
    expect(completionRequestOptions({
      provider: "custom",
      endpoint: "https://api.groq.com.example.com/v1"
    })).toEqual({});
  });
});
