import { LinkGraph } from "./link-graph";
import {
  maxRetrievalQueriesForMode,
  mergeRetrievalResults,
  normalizeRetrievalQueries
} from "./retrieval-plan";
import { DEFAULT_RETRIEVAL_OPTIONS, WikiRetriever } from "./retriever";
import { WikiSearchIndex } from "./search-index";
import type { RetrievalProgress } from "./retrieval-progress";
import type { KnowledgeRole, RetrievalOptions, RetrievalResult } from "./types";

const CURATED_WIKI_ROLES: ReadonlySet<KnowledgeRole> = new Set([
  "index",
  "topic",
  "concept",
  "summary",
  "wiki"
]);

function keepCuratedWikiChunks(result: RetrievalResult): RetrievalResult {
  const chunks = result.chunks.filter((chunk) => CURATED_WIKI_ROLES.has(chunk.role));
  return {
    ...result,
    chunks,
    truncated: result.truncated || chunks.length < result.chunks.length
  };
}

/**
 * Fast-mode retriever. Its scope is intentionally limited to the persistent
 * Wiki index: Index, Topic, Concept, Summary, and other curated Wiki pages.
 * Precise mode uses IndexCoordinator.retrieveAllMarkdown instead.
 */
export class HybridWikiRetriever {
  private readonly primaryRetriever: WikiRetriever;

  constructor(primaryIndex: WikiSearchIndex, graph: LinkGraph) {
    this.primaryRetriever = new WikiRetriever(primaryIndex, graph);
  }

  retrieve(
    query: string,
    options: Partial<RetrievalOptions> = {},
    onProgress?: RetrievalProgress
  ): Promise<RetrievalResult> {
    onProgress?.("fast");
    return Promise.resolve(keepCuratedWikiChunks(this.primaryRetriever.retrieve(query, {
      ...options,
      includePending: false,
      maxStableSourceResults: 0,
      maxPendingResults: 0
    })));
  }

  retrievePlannedQueries(
    query: string,
    plannedQueries: readonly string[],
    overrides: Partial<RetrievalOptions> = {},
    onProgress?: RetrievalProgress
  ): Promise<RetrievalResult> {
    onProgress?.("fast");
    const options: RetrievalOptions = {
      ...DEFAULT_RETRIEVAL_OPTIONS,
      ...overrides,
      includePending: false,
      maxStableSourceResults: 0,
      maxPendingResults: 0
    };
    const searchQueries = normalizeRetrievalQueries(
      query,
      plannedQueries,
      maxRetrievalQueriesForMode("fast")
    );
    const results = searchQueries.map((searchQuery) =>
      keepCuratedWikiChunks(this.primaryRetriever.retrieve(searchQuery, options)));
    return Promise.resolve(mergeRetrievalResults(
      query,
      searchQueries,
      results,
      false,
      options.maxRetrievedPages,
      options.maxContextCharacters
    ));
  }
}
