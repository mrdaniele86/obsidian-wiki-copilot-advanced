import { afterEach, describe, expect, it, vi } from "vitest";
import {
  modelTimeoutMsForRange,
  RequestCancelledError,
  RequestTimeoutError,
  withAbortSignal,
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

  it("stops waiting for non-cancellable local work when aborted", async () => {
    const controller = new AbortController();
    const neverSettles = new Promise<never>(() => undefined);
    const result = withAbortSignal(neverSettles, controller.signal);

    controller.abort();

    await expect(result).rejects.toBeInstanceOf(RequestCancelledError);
  });

  it("returns completed local work and removes its abort listener", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");

    await expect(withAbortSignal(Promise.resolve("完成"), controller.signal))
      .resolves.toBe("完成");
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
