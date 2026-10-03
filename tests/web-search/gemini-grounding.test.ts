import { describe, expect, it, vi } from "vitest";
import {
  GeminiGroundingClient,
  WebSearchError,
  type WebSearchRequest
} from "../../src/web-search/gemini-grounding";

const request: WebSearchRequest = {
  question: "What temperature does Misti use?",
  model: "gemini-2.5-flash",
  apiKey: "test-key"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function groundingClient(fetcher: ConstructorParameters<typeof GeminiGroundingClient>[0], timeout = 30_000) {
  return new GeminiGroundingClient(fetcher, timeout, {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
}

describe("GeminiGroundingClient", () => {
  it("sends only the question with Google Search grounding", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      candidates: [{
        content: { parts: [{ text: "Misti uses 30 °C." }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.test/misti", title: "Misti" } }] }
      }]
    }));
    const client = groundingClient(fetcher);

    await client.search(request);

    expect(fetcher).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-key",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      contents: [{ parts: [{ text: "What temperature does Misti use?" }] }],
      tools: [{ google_search: {} }]
    });
  });

  it("extracts text and deduplicated HTTPS grounding URLs", async () => {
    const client = groundingClient(async () => jsonResponse({
      candidates: [{
        content: { parts: [{ text: "Misti uses 30 °C." }] },
        groundingMetadata: { groundingChunks: [
          { web: { uri: "https://manual.example/misti", title: "Manuale" } },
          { web: { uri: "https://manual.example/misti", title: "Duplicate" } },
          { web: { uri: "http://manual.example/not-secure", title: "Ignored" } },
          { web: { uri: "not a URL", title: "Ignored" } }
        ] }
      }]
    }));

    await expect(client.search(request)).resolves.toEqual({
      provider: "gemini",
      question: "What temperature does Misti use?",
      model: "gemini-2.5-flash",
      answer: "Misti uses 30 °C.",
      sources: [{ title: "Manuale", url: "https://manual.example/misti" }]
    });
  });

  it("limits displayed sources to twelve", async () => {
    const chunks = Array.from({ length: 13 }, (_, index) => ({
      web: { uri: `https://example.test/${index}`, title: `Source ${index}` }
    }));
    const client = groundingClient(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: "Answer" }] }, groundingMetadata: { groundingChunks: chunks } }]
    }));

    await expect(client.search(request)).resolves.toMatchObject({
      sources: Array.from({ length: 12 }, (_, index) => ({
        title: `Source ${index}`,
        url: `https://example.test/${index}`
      }))
    });
  });

  it.each([
    [401, "invalid-key"],
    [403, "invalid-key"],
    [429, "quota"],
    [400, "invalid-model"],
    [404, "invalid-model"]
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const client = groundingClient(async () => jsonResponse({ error: { message: "failure" } }, status));
    await expect(client.search(request)).rejects.toMatchObject({ code });
  });

  it("maps fetch failures to network", async () => {
    const client = groundingClient(async () => { throw new TypeError("Failed to fetch"); });
    await expect(client.search(request)).rejects.toMatchObject({ code: "network" });
  });

  it("rejects malformed response JSON", async () => {
    const client = groundingClient(async () => new Response("not json", { status: 200 }));
    await expect(client.search(request)).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("rejects a structurally valid response with no answer", async () => {
    const client = groundingClient(async () => jsonResponse({ candidates: [{ content: { parts: [] } }] }));
    await expect(client.search(request)).rejects.toBeInstanceOf(WebSearchError);
    await expect(client.search(request)).rejects.toMatchObject({ code: "no-answer" });
  });

  it.each([
    { content: { parts: [null] } },
    { content: { parts: [{ text: "Answer" }] }, groundingMetadata: { groundingChunks: [null] } }
  ])("rejects null nested response values as malformed", async (candidate) => {
    const client = groundingClient(async () => jsonResponse({ candidates: [candidate] }));
    await expect(client.search(request)).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("rejects an answer without valid web grounding sources", async () => {
    const client = groundingClient(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: "Answer without sources" }] } }]
    }));
    await expect(client.search(request)).rejects.toMatchObject({ code: "no-sources" });
  });

  it("aborts and reports a timed-out request", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = groundingClient(fetcher, 1);

    await expect(client.search(request)).rejects.toMatchObject({ code: "timeout" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("propagates a caller cancellation distinctly from its timeout", async () => {
    const caller = new AbortController();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = groundingClient(fetcher);
    const pending = client.search({ ...request, signal: caller.signal });

    caller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("keeps timeout as the cause when caller cancellation follows it", async () => {
    const caller = new AbortController();
    let timeoutHandler: (() => void) | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = new GeminiGroundingClient(fetcher, 30_000, {
      setTimeout: (handler) => {
        timeoutHandler = handler;
        return 1;
      },
      clearTimeout: () => undefined
    });
    const pending = client.search({ ...request, signal: caller.signal });

    timeoutHandler?.();
    caller.abort();

    await expect(pending).rejects.toMatchObject({ code: "timeout" });
  });
});
