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

  it.each(["openai/gpt-oss-20b", "openai/gpt-oss-120b"])("uses Groq GPT-OSS reasoning controls for %s", (model) => {
    expect(completionRequestOptions({
      provider: "custom",
      endpoint: "https://api.groq.com/openai/v1",
      model
    } as Parameters<typeof completionRequestOptions>[0])).toEqual({
      max_completion_tokens: 512,
      reasoning_effort: "low",
      include_reasoning: false
    });
  });

  it("prioritizes the exact Groq GPT-OSS gate over a stale provider selection", () => {
    expect(completionRequestOptions({
      provider: "deepseek",
      endpoint: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-20b"
    })).toEqual({
      max_completion_tokens: 512,
      reasoning_effort: "low",
      include_reasoning: false
    });
  });
});
