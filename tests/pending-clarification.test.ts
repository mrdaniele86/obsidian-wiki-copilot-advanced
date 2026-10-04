import { describe, expect, it, vi } from "vitest";
import {
  extractClarificationDirective,
  formatClarificationContinuation,
  resolvePendingClarification
} from "../src/chat/pending-clarification";
import type { PendingClarification } from "../src/chat/pending-clarification";

const pendingTempo: PendingClarification = {
  goal: "recommend the next workout after Tempo",
  question: "Which workout came immediately before Tempo?",
  missing: "the workout before Tempo",
  requiresSummary: true,
  originUserTurnIndex: 4,
  originAssistantTurnIndex: 5,
  userRepliesSinceRequest: 0
};

const directive = "<!-- wiki-copilot-clarification {\"goal\":\"recommend the next workout after Tempo\",\"question\":\"Which workout came immediately before Tempo?\",\"missing\":\"the workout before Tempo\",\"requiresSummary\":true} -->";

describe("pending clarification", () => {
  it("extracts a single final hidden clarification directive without exposing it", () => {
    const parsed = extractClarificationDirective(`Which workout came immediately before Tempo?\n\n${directive}`);

    expect(parsed).toEqual({
      markdown: "Which workout came immediately before Tempo?",
      clarification: {
        goal: "recommend the next workout after Tempo",
        question: "Which workout came immediately before Tempo?",
        missing: "the workout before Tempo",
        requiresSummary: true
      }
    });
  });

  it("measures directive fields after trimming surrounding whitespace", () => {
    const directiveFor = (goal: string) => `Answer\n\n<!-- wiki-copilot-clarification ${JSON.stringify({
      goal,
      question: "Question",
      missing: "Missing",
      requiresSummary: false
    })} -->`;

    expect(extractClarificationDirective(directiveFor(` ${"g".repeat(2_000)} `)).clarification?.goal).toBe("g".repeat(2_000));
    expect(extractClarificationDirective(directiveFor(` ${"g".repeat(2_001)} `)).clarification).toBeUndefined();
  });

  it("uses Unicode code points for directive field limits", () => {
    const directiveFor = (goal: string) => `<!-- wiki-copilot-clarification ${JSON.stringify({
      goal,
      question: "Question",
      missing: "Missing",
      requiresSummary: false
    })} -->`;

    expect(extractClarificationDirective(directiveFor("😀".repeat(1_000))).clarification?.goal).toBe("😀".repeat(1_000));
    expect(extractClarificationDirective(directiveFor("😀".repeat(1_001))).clarification?.goal).toBe("😀".repeat(1_001));
    expect(extractClarificationDirective(directiveFor("😀".repeat(2_001))).clarification).toBeUndefined();
  });

  it("rejects unknown directive properties even when their raw payload is bounded", () => {
    const parsed = extractClarificationDirective(`<!-- wiki-copilot-clarification ${JSON.stringify({
      goal: "Goal",
      question: "Question",
      missing: "Missing",
      requiresSummary: false,
      ignored: "x".repeat(6_000)
    })} -->`);

    expect(parsed).toEqual({ markdown: "" });
  });

  it("rejects a multi-megabyte raw directive before parsing JSON", () => {
    const parse = vi.spyOn(JSON, "parse");
    const parsed = extractClarificationDirective(`<!-- wiki-copilot-clarification {"ignored":"${"x".repeat(1_000_000)}"} -->`);

    expect(parsed).toEqual({ markdown: "" });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("accepts valid fields whose JSON escaping expands their raw directive", () => {
    const goal = "\u0000".repeat(2_000);
    const parsed = extractClarificationDirective(`<!-- wiki-copilot-clarification ${JSON.stringify({
      goal,
      question: "Question",
      missing: "Missing",
      requiresSummary: false
    })} -->`);

    expect(parsed.clarification?.goal).toBe(goal);
  });

  it.each([
    ["duplicate directives", `${directive}\n${directive}`],
    ["invalid JSON", "Answer\n\n<!-- wiki-copilot-clarification {oops} -->"],
    ["a non-final directive", `${directive}\n\nMore answer`],
    ["an empty field", "Answer\n\n<!-- wiki-copilot-clarification {\"goal\":\" \",\"question\":\"Question\",\"missing\":\"Missing\",\"requiresSummary\":false} -->"],
    ["an overlong field", `Answer\n\n<!-- wiki-copilot-clarification {\"goal\":\"${"g".repeat(2_001)}\",\"question\":\"Question\",\"missing\":\"Missing\",\"requiresSummary\":false} -->`]
  ])("rejects %s", (_case, markdown) => {
    const parsed = extractClarificationDirective(markdown);

    expect(parsed.clarification).toBeUndefined();
    expect(parsed.markdown).not.toContain("wiki-copilot-clarification");
  });

  it("resolves a reply into continuity for the original objective", () => {
    const resolution = resolvePendingClarification(pendingTempo, "Before it I did Soglia.");

    expect(resolution).toMatchObject({ ...pendingTempo, reply: "Before it I did Soglia." });
    expect(formatClarificationContinuation(resolution!)).toBe(
      "Original objective:\nrecommend the next workout after Tempo\n\n" +
      "Clarification requested:\nWhich workout came immediately before Tempo?\n\n" +
      "Reply received:\nBefore it I did Soglia.\n\n" +
      "Complete the original objective; the reply is not an independent question."
    );
  });

  it.each(["What did I do last week?", "What did I do last week？", "¿Qué hice la semana pasada", "ماذا فعلت الأسبوع الماضي؟", "  Is that enough?  ", "   "])
  ("does not resolve an explicit replacement or empty reply: %j", (reply) => {
    expect(resolvePendingClarification(pendingTempo, reply)).toBeNull();
  });
});
