import MiniSearch from "minisearch";
import type { AsPlainObject, Options } from "minisearch";
import { CooperativeScheduler, yieldToUi } from "./cooperative";
import type { YieldControl } from "./cooperative";
import { chunkMarkdown } from "./markdown-chunker";
import { containsCjk, technicalIdentifierTokens, tokenizeForSearch } from "./tokenizer";
import { roleToEvidenceTier } from "./types";
import type { MarkdownChunk, NoteMetadata, SearchDocument } from "./types";

export interface RawSearchHit {
  document: SearchDocument;
  score: number;
}

export interface SearchIndexStats {
  documents: number;
  files: number;
}

export interface WikiSearchIndexSnapshot {
  index: AsPlainObject;
  documents: SearchDocument[];
}

const SEARCH_FIELDS = ["title", "aliases", "heading", "tags", "path", "text"] as const;

export class WikiSearchIndex {
  private index: MiniSearch<SearchDocument>;
  private readonly documents = new Map<string, SearchDocument>();
  private readonly pathToDocumentIds = new Map<string, string[]>();

  constructor() {
    this.index = this.createIndex();
  }

  private indexOptions(): Options<SearchDocument> {
    return {
      idField: "id",
      fields: [...SEARCH_FIELDS],
      storeFields: [],
      tokenize: tokenizeForSearch,
      processTerm: (term) => term
    };
  }

  private createIndex(): MiniSearch<SearchDocument> {
    return new MiniSearch<SearchDocument>(this.indexOptions());
  }

  replaceNote(metadata: NoteMetadata, markdown: string): SearchDocument[] {
    return this.replaceChunks(metadata, chunkMarkdown(metadata.path, markdown));
  }

  replaceChunks(metadata: NoteMetadata, chunks: MarkdownChunk[]): SearchDocument[] {
    this.removePath(metadata.path);
    const documents = chunks.map((chunk): SearchDocument => ({
      ...chunk,
      aliases: metadata.aliases.join(" "),
      tags: metadata.tags.join(" "),
      role: metadata.role,
      evidenceTier: roleToEvidenceTier(metadata.role)
    }));

    for (const document of documents) {
      this.index.add(document);
      this.documents.set(document.id, document);
    }
    this.pathToDocumentIds.set(metadata.path, documents.map((document) => document.id));
    return documents;
  }

  async replaceNoteAsync(
    metadata: NoteMetadata,
    markdown: string,
    yieldControl: YieldControl = yieldToUi
  ): Promise<SearchDocument[]> {
    return this.replaceChunksAsync(metadata, chunkMarkdown(metadata.path, markdown), yieldControl);
  }

  async replaceChunksAsync(
    metadata: NoteMetadata,
    chunks: MarkdownChunk[],
    yieldControl: YieldControl = yieldToUi
  ): Promise<SearchDocument[]> {
    await this.removePathAsync(metadata.path, yieldControl);
    const documents = chunks.map((chunk): SearchDocument => ({
      ...chunk,
      aliases: metadata.aliases.join(" "),
      tags: metadata.tags.join(" "),
      role: metadata.role,
      evidenceTier: roleToEvidenceTier(metadata.role)
    }));
    const scheduler = new CooperativeScheduler(8, 8, yieldControl);

    for (const document of documents) {
      this.index.add(document);
      this.documents.set(document.id, document);
      await scheduler.checkpoint();
    }
    this.pathToDocumentIds.set(metadata.path, documents.map((document) => document.id));
    return documents;
  }

  removePath(path: string): void {
    const ids = this.pathToDocumentIds.get(path);
    if (!ids) {
      return;
    }
    for (const id of ids) {
      this.index.discard(id);
      this.documents.delete(id);
    }
    this.pathToDocumentIds.delete(path);
  }

  async removePathAsync(path: string, yieldControl: YieldControl = yieldToUi): Promise<void> {
    const ids = this.pathToDocumentIds.get(path);
    if (!ids) {
      return;
    }
    const scheduler = new CooperativeScheduler(8, 16, yieldControl);
    for (const id of ids) {
      this.index.discard(id);
      this.documents.delete(id);
      await scheduler.checkpoint();
    }
    this.pathToDocumentIds.delete(path);
  }

  clear(): void {
    this.index = this.createIndex();
    this.documents.clear();
    this.pathToDocumentIds.clear();
  }

  createSnapshot(): WikiSearchIndexSnapshot {
    return {
      index: this.index.toJSON(),
      documents: [...this.documents.values()]
    };
  }

  async restoreSnapshot(snapshot: WikiSearchIndexSnapshot): Promise<void> {
    const restoredIndex = await MiniSearch.loadJSAsync<SearchDocument>(
      snapshot.index,
      this.indexOptions()
    );
    const documents = new Map<string, SearchDocument>();
    const pathToDocumentIds = new Map<string, string[]>();
    for (const document of snapshot.documents) {
      if (documents.has(document.id) || !restoredIndex.has(document.id)) {
        throw new Error("Wiki 索引缓存中的文档映射不一致");
      }
      documents.set(document.id, document);
      const ids = pathToDocumentIds.get(document.path) ?? [];
      ids.push(document.id);
      pathToDocumentIds.set(document.path, ids);
    }
    if (restoredIndex.documentCount !== documents.size) {
      throw new Error("Wiki 索引缓存中的文档数量不一致");
    }
    this.index = restoredIndex;
    this.documents.clear();
    this.pathToDocumentIds.clear();
    for (const [id, document] of documents) {
      this.documents.set(id, document);
    }
    for (const [path, ids] of pathToDocumentIds) {
      this.pathToDocumentIds.set(path, ids);
    }
  }

  search(query: string, limit = 120): RawSearchHit[] {
    const broadResults = this.searchDocuments(query);
    const technicalIdentifiers = technicalIdentifierTokens(query);
    let results = broadResults;

    if (technicalIdentifiers.length > 0) {
      const identifierSet = new Set(technicalIdentifiers);
      const identifierResults = this.searchDocuments(technicalIdentifiers.join(" "));
      const broadScores = new Map(broadResults.map((result) => [String(result.id), result.score]));
      const identifierScores = new Map(identifierResults.map((result) => [String(result.id), result.score]));
      const union = new Map([...identifierResults, ...broadResults].map((result) => [String(result.id), result]));
      const exactResults = [...union.values()]
        .filter((result) => {
          const document = this.documents.get(String(result.id));
          if (!document) {
            return false;
          }
          const documentIdentifiers = technicalIdentifierTokens(
            `${document.title} ${document.aliases} ${document.heading} ${document.tags} ${document.path}`
          );
          return documentIdentifiers.some((identifier) => identifierSet.has(identifier));
        })
        .map((result) => ({
          ...result,
          score: (identifierScores.get(String(result.id)) ?? 0) +
            (broadScores.get(String(result.id)) ?? 0)
        }))
        .sort((left, right) => right.score - left.score);
      if (exactResults.length > 0) {
        results = exactResults;
      }
    }

    const firstPerPath: RawSearchHit[] = [];
    const remaining: RawSearchHit[] = [];
    const seenPaths = new Set<string>();
    for (const result of results) {
      const document = this.documents.get(String(result.id));
      if (!document) {
        continue;
      }
      const hit = { document, score: result.score };
      if (seenPaths.has(document.path)) {
        remaining.push(hit);
      } else {
        seenPaths.add(document.path);
        firstPerPath.push(hit);
      }
    }
    return [...firstPerPath, ...remaining].slice(0, limit);
  }

  private searchDocuments(query: string) {
    return this.index.search(query, {
      boost: {
        title: 8,
        aliases: 7,
        heading: 5,
        tags: 4,
        path: 2,
        text: 1
      },
      combineWith: "OR",
      prefix: (term) => !containsCjk(term) && term.length >= 3,
      fuzzy: (term) => (!containsCjk(term) && term.length >= 5 ? 0.16 : false)
    });
  }

  getChunksForPath(path: string): SearchDocument[] {
    return (this.pathToDocumentIds.get(path) ?? [])
      .map((id) => this.documents.get(id))
      .filter((document): document is SearchDocument => document !== undefined);
  }

  hasPath(path: string): boolean {
    return this.pathToDocumentIds.has(path);
  }

  get stats(): SearchIndexStats {
    return {
      documents: this.documents.size,
      files: this.pathToDocumentIds.size
    };
  }
}
