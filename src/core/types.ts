export type KnowledgeRole =
  | "schema"
  | "index"
  | "topic"
  | "concept"
  | "summary"
  | "wiki"
  | "stable-source"
  | "pending-source"
  | "other";

export type EvidenceTier = "navigation" | "synthesis" | "stable" | "unverified";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface KnowledgeProfileConfig {
  schemaFiles: string[];
  indexFiles: string[];
  wikiRoots: string[];
  stableSourceRoots: string[];
  pendingSourceRoots: string[];
  excludedRoots: string[];
}

export interface KnowledgeProfile extends KnowledgeProfileConfig {
  autoDetected: boolean;
  warnings: string[];
}

export interface NoteMetadata {
  path: string;
  basename: string;
  aliases: string[];
  tags: string[];
  role: KnowledgeRole;
}

export interface MarkdownChunk {
  id: string;
  path: string;
  title: string;
  heading: string;
  headingLevel: number;
  chunkIndex: number;
  text: string;
}

export interface SearchDocument extends MarkdownChunk {
  aliases: string;
  tags: string;
  role: KnowledgeRole;
  evidenceTier: EvidenceTier;
}

export type RetrievalOrigin = "lexical" | "wikilink";

export type RetrievalRange = "low" | "medium" | "high";

export interface RetrievedChunk extends SearchDocument {
  score: number;
  lexicalScore: number;
  origin: RetrievalOrigin;
  anchorPath?: string;
}

export interface RetrievalOptions {
  includePending: boolean;
  includeOtherNotes: boolean;
  activePath?: string;
  maxIndexResults: number;
  maxTopicConceptResults: number;
  maxSummaryResults: number;
  maxWikiResults: number;
  maxStableSourceResults: number;
  maxPendingResults: number;
  maxRetrievedPages: number;
  maxEvidenceFiles: number;
  maxContextCharacters: number;
  graphExpansion: boolean;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  totalCandidates: number;
  truncated: boolean;
}

export interface SourceReference {
  id: string;
  path: string;
  title: string;
  heading: string;
  role: KnowledgeRole;
  evidenceTier: EvidenceTier;
  score: number;
  origin: RetrievalOrigin;
}

export interface AnswerResult {
  markdown: string;
  sources: SourceReference[];
  knowledgeBaseHit: boolean;
}

export interface AnswerRetrievalMetrics {
  contextCharacters: number;
  sourceCount: number;
}

export const SYNTHESIS_ROLES: ReadonlySet<KnowledgeRole> = new Set([
  "topic",
  "concept",
  "summary",
  "wiki"
]);

export function roleToEvidenceTier(role: KnowledgeRole): EvidenceTier {
  switch (role) {
    case "index":
      return "navigation";
    case "topic":
    case "concept":
    case "summary":
    case "wiki":
      return "synthesis";
    case "stable-source":
      return "stable";
    case "pending-source":
      return "unverified";
    case "schema":
    case "other":
      return "navigation";
  }
}
