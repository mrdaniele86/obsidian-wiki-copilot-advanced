import { describe, expect, it } from "vitest";
import {
  defaultModelForProvider,
  inferModelProvider,
  providerEndpoint,
  providerLabel,
  providerModels
} from "../src/model-presets";

describe("model provider presets", () => {
  it("infers legacy endpoints and normalizes preset endpoints", () => {
    expect(inferModelProvider("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(inferModelProvider("https://api.openai.com/v1")).toBe("openai");
    expect(inferModelProvider("http://localhost:11434/v1")).toBe("custom");
    expect(providerEndpoint("deepseek", "https://ignored.example/v1")).toBe("https://api.deepseek.com");
  });

  it("provides a usable default and common models for each preset provider", () => {
    expect(defaultModelForProvider("deepseek")).toBe("deepseek-v4-flash");
    expect(providerModels("deepseek").map((option) => option.id)).toContain("deepseek-v4-pro");
    expect(defaultModelForProvider("openai")).toBe("gpt-5.6-terra");
    expect(providerModels("custom")).toEqual([]);
  });

  it("uses the configured service name for custom OpenAI-compatible providers", () => {
    expect(providerLabel("custom", " 硅基流动 ")).toBe("硅基流动");
    expect(providerLabel("custom", "")).toBe("OpenAI 兼容服务");
    expect(providerLabel("deepseek", "不会使用")).toBe("DeepSeek");
  });
});
