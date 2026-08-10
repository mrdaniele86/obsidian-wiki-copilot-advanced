import type { KnowledgeRole, RetrievalResult, SourceReference } from "./types";

export interface BuiltContext {
  context: string;
  sources: SourceReference[];
}

function cleanEvidenceText(text: string): string {
  return text
    .replace(/<\/?wiki-copilot-source[^>]*>/giu, "")
    .trim();
}

function modelContextRole(role: KnowledgeRole): string {
  return role === "stable-source" || role === "pending-source"
    ? "source"
    : role;
}

function presentedEvidenceTier(
  role: KnowledgeRole,
  tier: SourceReference["evidenceTier"]
): SourceReference["evidenceTier"] {
  return role === "stable-source" || role === "pending-source"
    ? "stable"
    : tier;
}

export function sourceReferencesFromRetrieval(result: RetrievalResult): SourceReference[] {
  return result.chunks.map((chunk, index) => ({
    id: `S${index + 1}`,
    path: chunk.path,
    title: chunk.title,
    heading: chunk.heading,
    role: chunk.role,
    evidenceTier: presentedEvidenceTier(chunk.role, chunk.evidenceTier),
    score: chunk.score,
    origin: chunk.origin
  }));
}

export function buildAnswerContext(result: RetrievalResult): BuiltContext {
  const sources = sourceReferencesFromRetrieval(result);
  const blocks: string[] = [];

  result.chunks.forEach((chunk, index) => {
    const id = sources[index]?.id ?? `S${index + 1}`;
    blocks.push([
      `<wiki-copilot-source id="${id}" role="${modelContextRole(chunk.role)}">`,
      `Title: ${chunk.title}`,
      chunk.heading ? `Heading: ${chunk.heading}` : "Heading: (document introduction)",
      "---",
      cleanEvidenceText(chunk.text),
      "</wiki-copilot-source>"
    ].join("\n"));
  });

  return { context: blocks.join("\n\n"), sources };
}
