import type { MarkdownChunk } from "./types";

export interface MarkdownChunkOptions {
  maxCharacters: number;
  overlapCharacters: number;
}

const DEFAULT_OPTIONS: MarkdownChunkOptions = {
  maxCharacters: 2_400,
  overlapCharacters: 240
};

interface Section {
  heading: string;
  level: number;
  lines: string[];
}

function stripFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return normalized;
  }

  const closing = normalized.indexOf("\n---\n", 4);
  return closing === -1 ? normalized : normalized.slice(closing + 5);
}

function cleanHeading(value: string): string {
  return value
    .replace(/\s+#+\s*$/u, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_match, target: string, alias?: string) => alias ?? target)
    .trim();
}

function extractSections(markdown: string): { title: string; sections: Section[] } {
  const lines = stripFrontmatter(markdown).split("\n");
  const headingStack: string[] = [];
  const sections: Section[] = [];
  let title = "";
  let current: Section = { heading: "", level: 0, lines: [] };
  let inFence = false;

  const flush = (): void => {
    if (current.lines.some((line) => line.trim().length > 0)) {
      sections.push(current);
    }
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      current.lines.push(line);
      continue;
    }

    const headingMatch = inFence ? null : /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (!headingMatch) {
      current.lines.push(line);
      continue;
    }

    flush();
    const level = headingMatch[1]?.length ?? 1;
    const headingText = cleanHeading(headingMatch[2] ?? "");
    if (level === 1 && !title) {
      title = headingText;
    }
    headingStack.splice(level - 1);
    headingStack[level - 1] = headingText;
    current = {
      heading: headingStack.filter(Boolean).join(" › "),
      level,
      lines: []
    };
  }
  flush();

  return { title, sections };
}

function splitOversizedText(text: string, maxCharacters: number): string[] {
  if (text.length <= maxCharacters) {
    return [text];
  }

  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > maxCharacters) {
    const window = remaining.slice(0, maxCharacters + 1);
    const candidates = [window.lastIndexOf("。"), window.lastIndexOf(". "), window.lastIndexOf("；"), window.lastIndexOf("; "), window.lastIndexOf(" ")];
    const best = Math.max(...candidates);
    const cut = best >= Math.floor(maxCharacters * 0.55) ? best + 1 : maxCharacters;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.trim()) {
    pieces.push(remaining.trim());
  }
  return pieces;
}

function sectionParts(section: Section, options: MarkdownChunkOptions): string[] {
  const paragraphs = section.lines
    .join("\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitOversizedText(paragraph, options.maxCharacters));

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= options.maxCharacters) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    const overlap = current.slice(-options.overlapCharacters).trim();
    current = overlap && `${overlap}\n\n${paragraph}`.length <= options.maxCharacters
      ? `${overlap}\n\n${paragraph}`
      : paragraph;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export function chunkMarkdown(
  path: string,
  markdown: string,
  options: Partial<MarkdownChunkOptions> = {}
): MarkdownChunk[] {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { title: headingTitle, sections } = extractSections(markdown);
  const basename = path.split("/").pop()?.replace(/\.md$/iu, "") ?? path;
  const title = headingTitle || basename;
  const chunks: MarkdownChunk[] = [];

  for (const section of sections) {
    for (const text of sectionParts(section, resolvedOptions)) {
      const chunkIndex = chunks.length;
      chunks.push({
        id: `${path}::${chunkIndex}`,
        path,
        title,
        heading: section.heading,
        headingLevel: section.level,
        chunkIndex,
        text
      });
    }
  }

  if (chunks.length === 0 && title) {
    chunks.push({
      id: `${path}::0`,
      path,
      title,
      heading: "",
      headingLevel: 0,
      chunkIndex: 0,
      text: title
    });
  }

  return chunks;
}
