import MiniSearch from "minisearch";
import { containsCjk, tokenizeForSearch } from "../core/tokenizer";
import type {
  SourceCatalogDocument,
  SourceCatalogWorkerRequest,
  SourceCatalogWorkerResponse
} from "../core/source-catalog-protocol";

function createIndex(): MiniSearch<SourceCatalogDocument> {
  return new MiniSearch<SourceCatalogDocument>({
    idField: "id",
    fields: ["title", "aliases", "headings", "tags", "path"],
    storeFields: [],
    tokenize: tokenizeForSearch,
    processTerm: (term) => term
  });
}

let index = createIndex();
const roles = new Map<string, SourceCatalogDocument["role"]>();

function respond(response: SourceCatalogWorkerResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<SourceCatalogWorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "reset":
        index = createIndex();
        roles.clear();
        respond({ id: request.id, type: "ok" });
        return;
      case "upsert":
        for (const document of request.documents) {
          if (roles.has(document.path)) {
            index.discard(document.path);
          }
          index.add(document);
          roles.set(document.path, document.role);
        }
        respond({ id: request.id, type: "ok" });
        return;
      case "remove":
        for (const path of request.paths) {
          if (roles.has(path)) {
            index.discard(path);
            roles.delete(path);
          }
        }
        respond({ id: request.id, type: "ok" });
        return;
      case "search": {
        const results = index.search(request.query, {
          boost: { title: 8, aliases: 7, headings: 5, tags: 4, path: 3 },
          combineWith: "OR",
          prefix: (term) => !containsCjk(term) && term.length >= 3,
          fuzzy: (term) => (!containsCjk(term) && term.length >= 5 ? 0.16 : false)
        });
        const hits: { id: string; score: number }[] = [];
        for (const result of results) {
          const id = String(result.id);
          if (!request.includePending && roles.get(id) === "pending-source") {
            continue;
          }
          hits.push({ id, score: result.score });
          if (hits.length >= request.limit) {
            break;
          }
        }
        respond({ id: request.id, type: "search-results", hits });
        return;
      }
    }
  } catch (error) {
    respond({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
