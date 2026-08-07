import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SourceCatalogWorkerRequest,
  SourceCatalogWorkerResponse
} from "../src/core/source-catalog-protocol";

describe("source catalog worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("indexes and searches source metadata without relying on the UI thread", async () => {
    const responses: SourceCatalogWorkerResponse[] = [];
    const workerScope: {
      onmessage?: (event: MessageEvent<SourceCatalogWorkerRequest>) => void;
      postMessage: (response: SourceCatalogWorkerResponse) => void;
    } = {
      postMessage: (response) => responses.push(response)
    };
    vi.stubGlobal("self", workerScope);
    await import("../src/workers/source-catalog-worker");

    workerScope.onmessage?.({
      data: {
        id: 1,
        type: "upsert",
        documents: [{
          id: "raw/processed/ms6.md",
          path: "raw/processed/ms6.md",
          title: "MS6-ND 端口定义",
          aliases: "",
          tags: "端口",
          headings: "端子信号定义 CAN_H CAN_L",
          role: "stable-source"
        }]
      }
    } as MessageEvent<SourceCatalogWorkerRequest>);
    workerScope.onmessage?.({
      data: { id: 2, type: "search", query: "MS6-ND端口", includePending: false, limit: 10 }
    } as MessageEvent<SourceCatalogWorkerRequest>);

    expect(responses[0]).toMatchObject({ id: 1, type: "ok" });
    expect(responses[1]).toMatchObject({
      id: 2,
      type: "search-results",
      hits: [expect.objectContaining({ id: "raw/processed/ms6.md" })]
    });
  });
});
