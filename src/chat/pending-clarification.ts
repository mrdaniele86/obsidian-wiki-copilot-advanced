const DIRECTIVE_PREFIX = "<!-- wiki-copilot-clarification ";
const MAX_FIELD_CHARACTERS = 2_000;
const MAX_DIRECTIVE_CHARACTERS = 7_000;
const QUESTION_PUNCTUATION = /[?？¿؟]/u;

export interface ClarificationDirective {
  goal: string;
  question: string;
  missing: string;
  requiresSummary: boolean;
}

export interface PendingClarification extends ClarificationDirective {
  originUserTurnIndex: number;
  originAssistantTurnIndex: number;
  userRepliesSinceRequest: number;
}

export interface ResolvedClarification extends PendingClarification {
  reply: string;
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function boundedText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && characterCount(trimmed) <= MAX_FIELD_CHARACTERS;
}

function clarificationDirective(value: unknown): ClarificationDirective | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 4 || !keys.every((key) => key === "goal" || key === "question" || key === "missing" || key === "requiresSummary")) return null;
  const { goal, question, missing, requiresSummary } = value as Record<string, unknown>;
  if (!boundedText(goal) || !boundedText(question) || !boundedText(missing) || typeof requiresSummary !== "boolean") return null;
  return {
    goal: goal.trim(),
    question: question.trim(),
    missing: missing.trim(),
    requiresSummary
  };
}

interface DirectiveMatch {
  start: number;
  end: number;
  payload: string;
}

function directiveMatches(markdown: string): DirectiveMatch[] {
  const matches: DirectiveMatch[] = [];
  let cursor = 0;
  while (true) {
    const start = markdown.indexOf(DIRECTIVE_PREFIX, cursor);
    if (start < 0) return matches;
    const payloadStart = start + DIRECTIVE_PREFIX.length;
    const closing = markdown.indexOf("-->", payloadStart);
    if (closing < 0) {
      matches.push({ start, end: markdown.length, payload: markdown.slice(payloadStart) });
      return matches;
    }
    matches.push({ start, end: closing + 3, payload: markdown.slice(payloadStart, closing) });
    cursor = closing + 3;
  }
}

function removeDirectives(markdown: string, matches: DirectiveMatch[]): string {
  let clean = "";
  let cursor = 0;
  for (const match of matches) {
    clean += markdown.slice(cursor, match.start);
    cursor = match.end;
  }
  return (clean + markdown.slice(cursor)).trimEnd();
}

export function extractClarificationDirective(markdown: string): {
  markdown: string;
  clarification?: ClarificationDirective;
} {
  const directives = directiveMatches(markdown);
  const cleanMarkdown = removeDirectives(markdown, directives);
  if (directives.length !== 1) return { markdown: cleanMarkdown };

  const directive = directives[0]!;
  if (markdown.slice(directive.end).trim().length > 0 || characterCount(directive.payload) > MAX_DIRECTIVE_CHARACTERS) return { markdown: cleanMarkdown };

  try {
    const clarification = clarificationDirective(JSON.parse(directive.payload));
    return clarification ? { markdown: cleanMarkdown, clarification } : { markdown: cleanMarkdown };
  } catch {
    return { markdown: cleanMarkdown };
  }
}

function validPendingClarification(pending: PendingClarification): boolean {
  return clarificationDirective({
    goal: pending.goal,
    question: pending.question,
    missing: pending.missing,
    requiresSummary: pending.requiresSummary
  }) !== null &&
    Number.isInteger(pending.originUserTurnIndex) && pending.originUserTurnIndex >= 0 &&
    Number.isInteger(pending.originAssistantTurnIndex) && pending.originAssistantTurnIndex >= 0 &&
    Number.isInteger(pending.userRepliesSinceRequest) && pending.userRepliesSinceRequest >= 0 && pending.userRepliesSinceRequest <= 2;
}

export function resolvePendingClarification(pending: PendingClarification, reply: string): ResolvedClarification | null {
  if (!validPendingClarification(pending) || reply.trim().length === 0 || QUESTION_PUNCTUATION.test(reply)) return null;
  return { ...pending, reply };
}

export function formatClarificationContinuation(resolution: ResolvedClarification): string {
  return "Original objective:\n" + resolution.goal + "\n\n" +
    "Clarification requested:\n" + resolution.question + "\n\n" +
    "Reply received:\n" + resolution.reply + "\n\n" +
    "Complete the original objective; the reply is not an independent question.";
}
