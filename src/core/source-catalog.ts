import MiniSearch from "minisearch";
import { CooperativeScheduler } from "./cooperative";
import { SourceCatalogWorkerClient } from "./source-catalog-worker-client";
import { containsCjk, technicalIdentifierTokens, tokenizeForSearch } from "./tokenizer";
import type { KnowledgeRole } from "./types";
import type { SourceCatalogDocument, SourceCatalogWorkerHit } from "./source-catalog-protocol";

export type { SourceCatalogDocument } from "./source-catalog-protocol";

export interface SourceCatalogHit extends SourceCatalogDocument {
  score: number;
}

export class SourceCatalogIndex {
  private index = this.createIndex();
  private readonly documents = new Map<string, SourceCatalogDocument>();
  private workerClient = SourceCatalogWorkerClient.create();
  private fallbackPromise: Promise<void> | null = null;

  private createIndex(): MiniSearch<SourceCatalogDocument> {
    return new MiniSearch<SourceCatalogDocument>({
      idField: "id",
      fields: ["title", "aliases", "headings", "tags", "path"],
      storeFields: [],
      tokenize: tokenizeForSearch,
      processTerm: (term) => term
    });
  }

  replace(document: Omit<SourceCatalogDocument, "id">): void {
    const indexed = { ...document, id: document.path };
    this.documents.set(document.path, indexed);
    if (this.workerClient) {
      void this.workerClient.upsert([indexed]).catch(() => this.enableLocalFallback());
      return;
    }
    this.replaceLocal(indexed);
  }

  async replaceAsync(document: Omit<SourceCatalogDocument, "id">): Promise<void> {
    await this.replaceBatchAsync([document]);
  }

  async replaceBatchAsync(documents: Omit<SourceCatalogDocument, "id">[]): Promise<void> {
    const indexed = documents.map((document): SourceCatalogDocument => ({
      ...document,
      id: document.path
    }));
    for (const document of indexed) {
      this.documents.set(document.path, document);
    }
    if (this.workerClient) {
      try {
        await this.workerClient.upsert(indexed);
        return;
      } catch {
        await this.enableLocalFallback();
        return;
      }
    }

    const scheduler = new CooperativeScheduler();
    for (const document of indexed) {
      this.replaceLocal(document);
      await scheduler.checkpoint();
    }
  }

  remove(path: string): void {
    if (!this.documents.has(path)) {
      return;
    }
    this.documents.delete(path);
    if (this.workerClient) {
      void this.workerClient.remove([path]).catch(() => this.enableLocalFallback());
      return;
    }
    if (this.index.has(path)) {
      this.index.discard(path);
    }
  }

  clear(): void {
    this.index = this.createIndex();
    this.documents.clear();
    if (this.workerClient) {
      void this.workerClient.reset().catch(() => this.enableLocalFallback());
    }
  }

  async clearAsync(): Promise<void> {
    this.index = this.createIndex();
    this.documents.clear();
    if (!this.workerClient) {
      return;
    }
    try {
      await this.workerClient.reset();
    } catch {
      await this.enableLocalFallback();
    }
  }

  createSnapshot(): SourceCatalogDocument[] {
    return [...this.documents.values()];
  }

  async restoreSnapshot(documents: SourceCatalogDocument[]): Promise<void> {
    await this.clearAsync();
    const batchSize = 100;
    for (let offset = 0; offset < documents.length; offset += batchSize) {
      const batch = documents.slice(offset, offset + batchSize).map((document) => ({
        path: document.path,
        title: document.title,
        aliases: document.aliases,
        tags: document.tags,
        headings: document.headings,
        role: document.role
      }));
      await this.replaceBatchAsync(batch);
    }
  }

  hasPath(path: string): boolean {
    return this.documents.has(path);
  }

  roleForPath(path: string): KnowledgeRole | undefined {
    return this.documents.get(path)?.role;
  }

  search(query: string, includePending: boolean, limit = 16): SourceCatalogHit[] {
    const broadResults = this.searchLocal(query);
    const identifiers = technicalIdentifierTokens(query);
    if (identifiers.length > 0) {
      const identifierResults = this.searchLocal(identifiers.join(" "));
      const exactHits = this.materializeIdentifierHits(
        identifiers,
        broadResults,
        identifierResults,
        includePending,
        limit
      );
      if (exactHits.length > 0) {
        return exactHits;
      }
    }
    return this.materializeHits(broadResults, includePending, limit);
  }

  async searchAsync(query: string, includePending: boolean, limit = 16): Promise<SourceCatalogHit[]> {
    if (this.workerClient) {
      try {
        const candidateLimit = Math.max(64, limit * 4);
        const broadResults = await this.workerClient.search(query, includePending, candidateLimit);
        const identifiers = technicalIdentifierTokens(query);
        if (identifiers.length > 0) {
          const identifierResults = await this.workerClient.search(
            identifiers.join(" "),
            includePending,
            candidateLimit
          );
          const exactHits = this.materializeIdentifierHits(
            identifiers,
            broadResults,
            identifierResults,
            includePending,
            limit
          );
          if (exactHits.length > 0) {
            return exactHits;
          }
        }
        return this.materializeHits(broadResults, includePending, limit);
      } catch {
        await this.enableLocalFallback();
      }
    }
    return this.search(query, includePending, limit);
  }

  destroy(): void {
    this.workerClient?.destroy();
    this.workerClient = null;
  }

  private searchLocal(query: string): SourceCatalogWorkerHit[] {
    return this.index.search(query, {
      boost: { title: 8, aliases: 7, headings: 5, tags: 4, path: 3 },
      combineWith: "OR",
      prefix: (term) => !containsCjk(term) && term.length >= 3,
      fuzzy: (term) => (!containsCjk(term) && term.length >= 5 ? 0.16 : false)
    }).map((result) => ({ id: String(result.id), score: result.score }));
  }

  private materializeHits(
    results: SourceCatalogWorkerHit[],
    includePending: boolean,
    limit: number
  ): SourceCatalogHit[] {
    const maximum = results[0]?.score ?? 1;
    const hits: SourceCatalogHit[] = [];
    for (const result of results) {
      const document = this.documents.get(result.id);
      if (!document || (document.role === "pending-source" && !includePending)) {
        continue;
      }
      hits.push({ ...document, score: result.score / maximum });
      if (hits.length >= limit) {
        break;
      }
    }
    return hits;
  }

  private materializeIdentifierHits(
    identifiers: string[],
    broadResults: SourceCatalogWorkerHit[],
    identifierResults: SourceCatalogWorkerHit[],
    includePending: boolean,
    limit: number
  ): SourceCatalogHit[] {
    const identifierSet = new Set(identifiers);
    const broadMaximum = broadResults[0]?.score ?? 1;
    const identifierMaximum = identifierResults[0]?.score ?? 1;
    const broadScores = new Map(broadResults.map((result) => [result.id, result.score / broadMaximum]));
    const identifierScores = new Map(
      identifierResults.map((result) => [result.id, result.score / identifierMaximum])
    );
    const union = new Map(
      [...identifierResults, ...broadResults].map((result) => [result.id, result])
    );
    const hits: SourceCatalogHit[] = [];

    for (const result of union.values()) {
      const document = this.documents.get(result.id);
      if (!document || (document.role === "pending-source" && !includePending)) {
        continue;
      }
      const documentIdentifiers = new Set(technicalIdentifierTokens(
        `${document.title} ${document.aliases} ${document.headings} ${document.path}`
      ));
      if (![...identifierSet].some((identifier) => documentIdentifiers.has(identifier))) {
        continue;
      }
      hits.push({
        ...document,
        score: 1 + (identifierScores.get(result.id) ?? 0) + (broadScores.get(result.id) ?? 0)
      });
    }

    return hits
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, limit);
  }

  private replaceLocal(document: SourceCatalogDocument): void {
    if (this.index.has(document.path)) {
      this.index.discard(document.path);
    }
    this.index.add(document);
  }

  private enableLocalFallback(): Promise<void> {
    if (this.fallbackPromise) {
      return this.fallbackPromise;
    }
    this.workerClient?.destroy();
    this.workerClient = null;
    this.fallbackPromise = this.rebuildLocalIndex().finally(() => {
      this.fallbackPromise = null;
    });
    return this.fallbackPromise;
  }

  private async rebuildLocalIndex(): Promise<void> {
    this.index = this.createIndex();
    const scheduler = new CooperativeScheduler();
    for (const document of this.documents.values()) {
      this.index.add(document);
      await scheduler.checkpoint();
    }
  }

  get size(): number {
    return this.documents.size;
  }
}
