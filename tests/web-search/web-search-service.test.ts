import { describe, expect, it, vi } from "vitest";
import { WebSearchService } from "../../src/web-search/web-search-service";
import type { WebSearchSettings } from "../../src/web-search/types";

const dedicated: WebSearchSettings = { mode: "dedicated-gemini", geminiModel: "gemini-2.5-flash" };

describe("WebSearchService", () => {
  it("only makes dedicated Gemini available with a nonempty dedicated key", () => {
    expect(new WebSearchService({ settings: dedicated, apiKey: "  " }).capability()).toEqual({
      available: false,
      reason: "missing-api-key"
    });
    expect(new WebSearchService({ settings: dedicated, apiKey: " dedicated-key " }).capability()).toEqual({
      available: true
    });
  });

  it("reports current provider as unsupported and never reroutes it", async () => {
    const search = vi.fn();
    const service = new WebSearchService({
      settings: { mode: "current-provider", geminiModel: "gemini-2.5-flash" },
      apiKey: "dedicated-key",
      client: { search }
    });

    expect(service.capability()).toEqual({ available: false, reason: "unsupported-current-provider" });
    await expect(service.search({ question: "Question", model: "ignored", apiKey: "ignored" }))
      .rejects.toMatchObject({ code: "unsupported-current-provider" });
    expect(search).not.toHaveBeenCalled();
  });

  it("dispatches dedicated searches with only its configured model and key", async () => {
    const search = vi.fn(async (_request: unknown) => ({
      provider: "gemini" as const, model: "gemini-2.5-flash", answer: "Answer", sources: []
    }));
    const service = new WebSearchService({ settings: dedicated, apiKey: " dedicated-key ", client: { search } });

    await expect(service.search({ question: "Question", model: "other", apiKey: "other" })).resolves.toMatchObject({ answer: "Answer" });
    expect(search).toHaveBeenCalledWith({
      question: "Question",
      model: "gemini-2.5-flash",
      apiKey: "dedicated-key"
    });
  });

  it("forwards the caller cancellation signal to the grounding client", async () => {
    const search = vi.fn(async (_request: unknown) => ({
      provider: "gemini" as const, model: "gemini-2.5-flash", answer: "Answer", sources: []
    }));
    const service = new WebSearchService({ settings: dedicated, apiKey: "dedicated-key", client: { search } });
    const caller = new AbortController();

    await service.search({ question: "Question", model: "ignored", apiKey: "ignored", signal: caller.signal });

    expect(search).toHaveBeenCalledWith({
      question: "Question",
      model: "gemini-2.5-flash",
      apiKey: "dedicated-key",
      signal: caller.signal
    });
  });

  it("does not hand a cancelled operation to a grounding client that could return answer sources", async () => {
    const search = vi.fn(async () => ({
      provider: "gemini" as const,
      model: "gemini-2.5-flash",
      answer: "Must not reach the view",
      sources: [{ title: "Must not persist", url: "https://example.test/source" }]
    }));
    const service = new WebSearchService({ settings: dedicated, apiKey: "dedicated-key", client: { search } });
    const caller = new AbortController();
    caller.abort();

    await expect(service.search({ question: "Question", model: "ignored", apiKey: "ignored", signal: caller.signal }))
      .rejects.toMatchObject({ code: "cancelled" });
    expect(search).not.toHaveBeenCalled();
  });
});
