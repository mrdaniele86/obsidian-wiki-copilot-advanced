import { afterEach, describe, expect, it, vi } from "vitest";
import {
  modelTimeoutMsForRange,
  RequestTimeoutError,
  withTimeout
} from "../src/llm/request-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("model request timeout", () => {
  it("rejects a request that never settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const request = withTimeout(new Promise<never>(() => undefined), 90_000, "模型请求超时");
    const assertion = expect(request).rejects.toMatchObject({
      name: "RequestTimeoutError",
      message: "模型请求超时",
      milliseconds: 90_000
    } satisfies Partial<RequestTimeoutError>);

    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
  });

  it("returns a response received before the deadline", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    await expect(withTimeout(Promise.resolve("完成"), 90_000, "模型请求超时"))
      .resolves.toBe("完成");
  });

  it("allows more model time for broader retrieval ranges", () => {
    expect(modelTimeoutMsForRange("low")).toBe(90_000);
    expect(modelTimeoutMsForRange("medium")).toBe(120_000);
    expect(modelTimeoutMsForRange("high")).toBe(180_000);
  });
});
