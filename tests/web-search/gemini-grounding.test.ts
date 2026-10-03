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

describe("GeminiGroundingClient", () => {
  it("sends only the question with Google Search grounding", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      candidates: [{ content: { parts: [{ text: "Misti uses 30 °C." }] } }]
    }));
    const client = new GeminiGroundingClient(fetcher);

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
    const client = new GeminiGroundingClient(async () => jsonResponse({
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
      model: "gemini-2.5-flash",
      answer: "Misti uses 30 °C.",
      sources: [{ title: "Manuale", url: "https://manual.example/misti" }]
    });
  });

  it("limits displayed sources to twelve", async () => {
    const chunks = Array.from({ length: 13 }, (_, index) => ({
      web: { uri: `https://example.test/${index}`, title: `Source ${index}` }
    }));
    const client = new GeminiGroundingClient(async () => jsonResponse({
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
    [429, "quota"]
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const client = new GeminiGroundingClient(async () => jsonResponse({ error: { message: "failure" } }, status));
    await expect(client.search(request)).rejects.toMatchObject({ code });
  });

  it("maps fetch failures to network", async () => {
    const client = new GeminiGroundingClient(async () => { throw new TypeError("Failed to fetch"); });
    await expect(client.search(request)).rejects.toMatchObject({ code: "network" });
  });

  it("rejects malformed response JSON", async () => {
    const client = new GeminiGroundingClient(async () => new Response("not json", { status: 200 }));
    await expect(client.search(request)).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("rejects a structurally valid response with no answer", async () => {
    const client = new GeminiGroundingClient(async () => jsonResponse({ candidates: [{ content: { parts: [] } }] }));
    await expect(client.search(request)).rejects.toBeInstanceOf(WebSearchError);
    await expect(client.search(request)).rejects.toMatchObject({ code: "no-answer" });
  });

  it("allows an answer with no usable web sources", async () => {
    const client = new GeminiGroundingClient(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: "Answer without sources" }] } }]
    }));
    await expect(client.search(request)).resolves.toMatchObject({
      answer: "Answer without sources",
      sources: []
    });
  });
});
