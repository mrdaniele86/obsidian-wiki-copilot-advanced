import { describe, expect, it } from "vitest";
import { estimatePromptTokens, groqPromptLimit, isGroqEndpoint, planPromptBudget } from "../src/llm/prompt-budget";

describe("prompt budget", () => {
  it("reserves Groq output tokens from the configurable account TPM before applying the prompt margin", () => {
    expect(groqPromptLimit(4_000, 4_000, "automatic")).toBe(4_000);
    expect(groqPromptLimit(12_000, 2_048, 12_000)).toBe(9_952);
    expect(groqPromptLimit(7_000, 8_000, 8_000)).toBe(0);
  });

  it("recognizes only the exact Groq API hostname", () => {
    expect(isGroqEndpoint("https://API.GROQ.COM/v1/")).toBe(true);
    expect(isGroqEndpoint("https://api.groq.com")).toBe(true);
    expect(isGroqEndpoint("https://api.groq.com.example.com/v1")).toBe(false);
    expect(isGroqEndpoint("https://not-api.groq.com/v1")).toBe(false);
    expect(isGroqEndpoint("not a URL")).toBe(false);
  });

  it("estimates CJK, emoji, and code more conservatively than ordinary ASCII prose", () => {
    const ascii = estimatePromptTokens([{ role: "user", content: "a".repeat(120) }]);
    const cjk = estimatePromptTokens([{ role: "user", content: "知".repeat(120) }]);
    const emoji = estimatePromptTokens([{ role: "user", content: "😀".repeat(120) }]);
    const codeText = "const x = `\\u{1F600}`;\n".repeat(12);
    const code = estimatePromptTokens([{ role: "user", content: codeText }]);

    expect(cjk).toBeGreaterThan(ascii);
    expect(emoji).toBeGreaterThan(ascii);
    expect(code).toBeGreaterThan(estimatePromptTokens([{ role: "user", content: "a".repeat(Array.from(codeText).length) }]));
  });

  it("does not exceed the safety budget when preserving a shortened source wrapper", () => {
    const plan = planPromptBudget({
      systemPrompt: "s",
      question: "q",
      evidence: [`<wiki-copilot-source id="S1" role="source">${"x".repeat(300)}</wiki-copilot-source>`],
      limitTokens: 80
    });

    expect(plan.messages.map((message) => message.content).join("\n")).toContain('<wiki-copilot-source id="S1" role="source">');
    expect(plan.usedTokens).toBeLessThanOrEqual(Math.floor(80 * 0.88));
  });

  it("reports an unavoidable excess when the preserved system and question exceed the budget", () => {
    const plan = planPromptBudget({
      systemPrompt: "System ".repeat(100),
      question: "Question ".repeat(100),
      limitTokens: 80
    });

    expect(plan.overBudget).toBe(true);
    expect(plan.messages.map((message) => message.content).join("\n")).toContain("Question ");
  });

  it("drops evidence that has no complete wrapper when it cannot fit", () => {
    const plan = planPromptBudget({
      systemPrompt: "s",
      question: "q",
      evidence: ["unwrapped evidence ".repeat(100)],
      limitTokens: 80
    });

    expect(plan.messages.map((message) => message.content).join("\n")).not.toContain("unwrapped evidence");
  });

  it("preserves the newest recent-workout pair 8x300 → Tempo before large retrieved evidence", () => {
    const systemPrompt = "Follow the source rules.";
    const question = "What was my latest workout?";
    const history = [
      { role: "user" as const, content: "8x300" },
      { role: "assistant" as const, content: "Tempo" }
    ];
    const evidence = Array.from(
      { length: 17 },
      (_, index) => `<wiki-copilot-source id="S${index + 1}" role="source">${"Large evidence ".repeat(500)}</wiki-copilot-source>`
    );
    const original = JSON.stringify({ systemPrompt, question, history, evidence });

    const plan = planPromptBudget({ systemPrompt, question, history, evidence, limitTokens: 7_000 });
    const serialized = plan.messages.map((message) => message.content).join("\n");

    expect(plan.messages).toEqual(expect.arrayContaining(history));
    expect(serialized).toContain('<wiki-copilot-source id="S1" role="source">');
    expect(serialized).toContain("</wiki-copilot-source>");
    expect(plan.usedTokens).toBeLessThanOrEqual(Math.floor(7_000 * 0.88));
    expect(estimatePromptTokens(plan.messages)).toBe(plan.usedTokens);
    expect(JSON.stringify({ systemPrompt, question, history, evidence })).toBe(original);
  });
});
