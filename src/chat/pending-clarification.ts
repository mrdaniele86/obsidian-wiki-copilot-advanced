const DIRECTIVE_PATTERN = /<!--\s*wiki-copilot-clarification\s+([\s\S]*?)\s*-->/gu;
const MAX_FIELD_CHARACTERS = 2_000;

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

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_FIELD_CHARACTERS;
}

function clarificationDirective(value: unknown): ClarificationDirective | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { goal, question, missing, requiresSummary } = value as Record<string, unknown>;
  if (!boundedText(goal) || !boundedText(question) || !boundedText(missing) || typeof requiresSummary !== "boolean") return null;
  return {
    goal: goal.trim(),
    question: question.trim(),
    missing: missing.trim(),
    requiresSummary
  };
}

export function extractClarificationDirective(markdown: string): {
  markdown: string;
  clarification?: ClarificationDirective;
} {
  const directives = [...markdown.matchAll(DIRECTIVE_PATTERN)];
  const cleanMarkdown = markdown.replace(DIRECTIVE_PATTERN, "").trimEnd();
  if (directives.length !== 1) return { markdown: cleanMarkdown };

  const directive = directives[0]!;
  if (markdown.slice((directive.index ?? 0) + directive[0].length).trim().length > 0) return { markdown: cleanMarkdown };

  try {
    const clarification = clarificationDirective(JSON.parse(directive[1]!));
    return clarification ? { markdown: cleanMarkdown, clarification } : { markdown: cleanMarkdown };
  } catch {
    return { markdown: cleanMarkdown };
  }
}

function validPendingClarification(pending: PendingClarification): boolean {
  return clarificationDirective(pending) !== null &&
    Number.isInteger(pending.originUserTurnIndex) && pending.originUserTurnIndex >= 0 &&
    Number.isInteger(pending.originAssistantTurnIndex) && pending.originAssistantTurnIndex >= 0 &&
    Number.isInteger(pending.userRepliesSinceRequest) && pending.userRepliesSinceRequest >= 0 && pending.userRepliesSinceRequest <= 2;
}

export function resolvePendingClarification(pending: PendingClarification, reply: string): ResolvedClarification | null {
  if (!validPendingClarification(pending) || reply.trim().length === 0 || reply.includes("?")) return null;
  return { ...pending, reply };
}

export function formatClarificationContinuation(resolution: ResolvedClarification): string {
  return "Original objective:\n" + resolution.goal + "\n\n" +
    "Clarification requested:\n" + resolution.question + "\n\n" +
    "Reply received:\n" + resolution.reply + "\n\n" +
    "Complete the original objective; the reply is not an independent question.";
}
