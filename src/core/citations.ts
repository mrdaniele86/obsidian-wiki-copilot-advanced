import type { SourceReference } from "./types";

export interface CitationCheck {
  markdown: string;
  citedIds: string[];
  invalidIds: string[];
}

const CITATION = /\[S(\d+)\]/gu;

export function validateAnswerCitations(markdown: string, sources: SourceReference[]): CitationCheck {
  const validIds = new Set(sources.map((source) => source.id));
  const citedIds = new Set<string>();
  const invalidIds = new Set<string>();

  for (const match of markdown.matchAll(CITATION)) {
    const id = `S${match[1] ?? ""}`;
    if (validIds.has(id)) {
      citedIds.add(id);
    } else {
      invalidIds.add(id);
    }
  }

  const warnings: string[] = [];
  if (invalidIds.size > 0) {
    warnings.push(`模型使用了不存在的来源标记：${[...invalidIds].join("、")}。`);
  }
  if (sources.length > 0 && citedIds.size === 0) {
    warnings.push("模型回答未包含有效来源标记；请以来源列表为准。 ");
  }

  return {
    markdown: warnings.length > 0
      ? `${markdown.trim()}\n\n> [!warning] Wiki Copilot 引用检查\n> ${warnings.join(" ")}`
      : markdown,
    citedIds: [...citedIds],
    invalidIds: [...invalidIds]
  };
}

export function citationTarget(source: SourceReference): string {
  const path = source.path.replace(/\.md$/iu, "");
  const heading = source.heading.split(" › ").at(-1)?.trim();
  return heading ? `${path}#${heading}` : path;
}

export function citationIdFromText(text: string): string | null {
  return /^\[?(S\d+)\]?$/u.exec(text.trim())?.[1] ?? null;
}

/** Converts valid [S1] markers into superscript Obsidian links at render time. */
export function linkifyAnswerCitations(markdown: string, sources: SourceReference[]): string {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return markdown.replace(CITATION, (marker, digits: string) => {
    const id = `S${digits}`;
    const source = byId.get(id);
    if (!source || source.path.includes("]") || source.path.includes("|")) {
      return marker;
    }
    // Obsidian Markdown tables treat an unescaped Wikilink alias pipe as a
    // column separator. Escaping it is valid outside tables too and keeps
    // citations such as [S1] intact wherever the model places them.
    return `<sup class="wiki-copilot-citation-ref">[[${citationTarget(source)}\\|${id}]]</sup>`;
  });
}
