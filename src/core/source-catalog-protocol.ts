export interface SourceCatalogDocument {
  id: string;
  path: string;
  title: string;
  aliases: string;
  tags: string;
  headings: string;
  role: "stable-source" | "pending-source";
}

export interface SourceCatalogWorkerHit {
  id: string;
  score: number;
}

export type SourceCatalogWorkerRequest =
  | { id: number; type: "reset" }
  | { id: number; type: "upsert"; documents: SourceCatalogDocument[] }
  | { id: number; type: "remove"; paths: string[] }
  | {
      id: number;
      type: "search";
      query: string;
      includePending: boolean;
      limit: number;
    };

export type SourceCatalogWorkerResponse =
  | { id: number; type: "ok" }
  | { id: number; type: "search-results"; hits: SourceCatalogWorkerHit[] }
  | { id: number; type: "error"; message: string };
