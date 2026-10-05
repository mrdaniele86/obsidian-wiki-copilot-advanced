import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { createTranslator } from "../src/i18n";
import { ModelConfigurationError, ModelRequestError, ModelStreamInterruptedError, StreamFallbackRequiredError } from "../src/llm/openai-compatible";
import { localizeModelError, localizeModelResponseDetail } from "../src/ui/model-response-localization";

describe("model response localization", () => {
  it("does not expose provider detail for a reasoning-exhausted response", () => {
    const localized = localizeModelError(
      createTranslator("it"),
      new ModelRequestError("reasoning-exhausted" as never, "private chain of thought")
    );

    expect(localized).not.toContain("private chain of thought");
    expect(localized).not.toContain("api.groq.com");
  });

  it.each([
    ["it", "La risposta ha raggiunto il limite di Token massimi in output e potrebbe essere incompleta."],
    ["en", "The answer reached the Maximum output tokens limit and may be incomplete."],
    ["zh", "回答已达到最大输出 Token 限制，内容可能不完整。"]
  ] as const)("explains that the length warning is about output for %s", (language, expected) => {
    expect(createTranslator(language)("view.model.lengthWarning")).toBe(expected);
  });

  it.each([
    ["it", "Il servizio non supporta le risposte in streaming; uso della modalità compatibilità."],
    ["en", "The service does not support streaming responses; using compatibility mode."],
    ["zh", "服务不支持流式响应，已使用兼容模式。"]
  ] as const)("localizes a streaming fallback for %s", (language, expected) => {
    expect(localizeModelResponseDetail(createTranslator(language), "streaming-unsupported"))
      .toBe(expected);
  });

  it.each([
    ["it", "Impossibile completare la richiesta al modello."],
    ["en", "The model request could not be completed."],
    ["zh", "无法完成模型请求。"]
  ] as const)("localizes a request error for %s", (language, expected) => {
    expect(localizeModelError(createTranslator(language), new ModelRequestError("request-failed", "rate limit exceeded")))
      .toBe(expected);
  });

  it("localizes a compatibility retry error rather than exposing provider text", () => {
    expect(localizeModelError(createTranslator("en"), new StreamFallbackRequiredError("streaming-unavailable")))
      .toBe("Streaming is unavailable in this Obsidian environment. Retry in compatibility mode.");
  });

  it.each([
    ["it", "L'endpoint del modello deve usare http o https."],
    ["en", "The model endpoint must use http or https."],
    ["zh", "模型 endpoint 必须使用 http 或 https。"]
  ] as const)("localizes configuration errors for %s", (language, expected) => {
    expect(localizeModelError(createTranslator(language), new ModelConfigurationError("invalid-endpoint")))
      .toBe(expected);
  });

  it.each([
    ["it", "La risposta è stata interrotta perché il servizio non disponeva di risorse sufficienti."],
    ["en", "The answer was interrupted because the service did not have enough resources."],
    ["zh", "模型因服务资源不足中断了回答。"]
  ] as const)("localizes stream interruption errors for %s", (language, expected) => {
    expect(localizeModelError(createTranslator(language), new ModelStreamInterruptedError("insufficient-system-resource", "partial")))
      .toBe(expected);
  });
});
