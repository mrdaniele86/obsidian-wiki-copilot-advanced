import type { SourceReference } from "./types";

export interface CitationCheck {
  markdown: string;
  warning?: string;
  citedIds: string[];
  invalidIds: string[];
}

export interface CitationWarningText {
  title: string;
  invalidIds: (ids: string) => string;
  missingValidCitation: string;
}

const CITATION = /\[S(\d+)\]/giu;
const SOURCE_IDS = /S(\d+)/giu;
const COMBINED_SQUARE_CITATION = /\[((?:S\d+)(?:\s*(?:[/／、,，&＆]|和|及)\s*S\d+)+)\]/giu;
const PARENTHESIZED_CITATION_START = /([（(])(\s*)((?:S\d+)(?:\s*(?:[/／、,，&＆]|和|及)\s*S\d+)*)(?=\s*(?:[，,：:；;）)]|\s))/giu;
const BARE_COMBINED_CITATION = /(^|[^\p{L}\p{N}_[])((?:S\d+)(?:\s*(?:[/／、,，&＆]|和|及)\s*S\d+)+)(?=$|[^\p{L}\p{N}_\]])/gimu;
const PROTECTED_MARKDOWN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|!?\[[^\]\n]+\]\([^)]+\)|\[\[[^\]\n]+\]\])/gu;

function normalizeCitationGroup(group: string, validIds: ReadonlySet<string>): string | null {
  const ids = [...group.matchAll(SOURCE_IDS)].map((match) => `S${match[1] ?? ""}`);
  if (ids.length === 0 || ids.some((id) => !validIds.has(id))) {
    return null;
  }
  return ids.map((id) => `[${id}]`).join("");
}

function normalizeProseCitations(markdown: string, validIds: ReadonlySet<string>): string {
  return markdown
    .replace(COMBINED_SQUARE_CITATION, (marker, group: string) => (
      normalizeCitationGroup(group, validIds) ?? marker
    ))
    .replace(
      PARENTHESIZED_CITATION_START,
      (marker, opening: string, whitespace: string, group: string) => {
        const normalized = normalizeCitationGroup(group, validIds);
        return normalized ? `${opening}${whitespace}${normalized}` : marker;
      }
    )
    .replace(BARE_COMBINED_CITATION, (marker, prefix: string, group: string) => {
      const normalized = normalizeCitationGroup(group, validIds);
      return normalized ? `${prefix}${normalized}` : marker;
    });
}

/**
 * Repairs common model citation variants without touching unknown source IDs,
 * code, Wikilinks, or ordinary Markdown links.
 */
export function normalizeAnswerCitations(markdown: string, sources: SourceReference[]): string {
  const validIds = new Set(sources.map((source) => source.id));
  if (validIds.size === 0) {
    return markdown;
  }

  return markdown
    .split(PROTECTED_MARKDOWN)
    .map((segment, index) => index % 2 === 1 ? segment : normalizeProseCitations(segment, validIds))
    .join("");
}

export function validateAnswerCitations(
  markdown: string,
  sources: SourceReference[],
  warningText?: CitationWarningText
): CitationCheck {
  const normalizedMarkdown = normalizeAnswerCitations(markdown, sources);
  const validIds = new Set(sources.map((source) => source.id));
  const citedIds = new Set<string>();
  const invalidIds = new Set<string>();

  for (const match of normalizedMarkdown.matchAll(CITATION)) {
    const id = `S${match[1] ?? ""}`;
    if (validIds.has(id)) {
      citedIds.add(id);
    } else {
      invalidIds.add(id);
    }
  }

  const warnings: string[] = [];
  if (invalidIds.size > 0) {
    warnings.push(warningText
      ? warningText.invalidIds([...invalidIds].join(", "))
      : `模型使用了不存在的来源标记：${[...invalidIds].join("、")}。`);
  }
  if (sources.length > 0 && citedIds.size === 0) {
    warnings.push(warningText?.missingValidCitation ?? "模型回答未包含有效来源标记；请以来源列表为准。 ");
  }

  return {
    markdown: warnings.length > 0
      ? `${normalizedMarkdown.trim()}\n\n> [!warning] Wiki Copilot ${warningText?.title ?? "引用检查"}\n> ${warnings.join(" ")}`
      : normalizedMarkdown,
    citedIds: [...citedIds],
    invalidIds: [...invalidIds],
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {})
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
  return normalizeAnswerCitations(markdown, sources).replace(CITATION, (marker, digits: string) => {
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
