import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/llm/prompt";

describe("Wiki Copilot system prompt", () => {
  it("keeps knowledge-base answers evidence-only and citation-first", () => {
    const prompt = buildSystemPrompt("", true);
    expect(prompt).toContain("Answer only from the evidence");
    expect(prompt).toContain("Cover all evidence that is relevant to the requested scope");
    expect(prompt).toContain("instead of stopping after the first match");
    expect(prompt).toContain("[S1]");
    expect(prompt).not.toContain("No relevant knowledge-base evidence was retrieved");
    expect(prompt).not.toContain("unverified");
    expect(prompt).not.toContain("pending area");
  });

  it("allows a clearly labeled general answer when retrieval has no hit", () => {
    const prompt = buildSystemPrompt("", false);
    expect(prompt).toContain("general knowledge and normal generative capabilities");
    expect(prompt).toContain("Never imply that this answer came from the current Vault or Wiki");
    expect(prompt).toContain("do not use [S1]");
  });

  it("asks for compact Markdown in both modes", () => {
    expect(buildSystemPrompt("", true)).toContain("Use compact Markdown");
    expect(buildSystemPrompt("", false)).toContain("Use compact Markdown");
  });

  it("keeps source metadata out of answer tables", () => {
    const prompt = buildSystemPrompt("", true);
    expect(prompt).toContain("Never add a source/reference column");
    expect(prompt).toContain("interface renders source metadata separately");
  });

  it("defines an unambiguous multi-source citation format", () => {
    const prompt = buildSystemPrompt("", true);
    expect(prompt).toContain("[S1][S2]");
    expect(prompt).toContain("S1/S2");
    expect(prompt).toContain("invalid citations");
  });

  it("uses one fixed cross-domain entity and scope policy", () => {
    const prompt = buildSystemPrompt("", true);
    expect(prompt).toContain("same reasoning rules to every domain");
    expect(prompt).toContain("Treat recent conversation as active context");
    expect(prompt).toContain("established subjects, scope, comparisons, filters, definitions");
    expect(prompt).toContain("explicit scope or named entities in the current question");
    expect(prompt).toContain("Preserve entity fidelity");
    expect(prompt).toContain("never transfer facts, attributes, conditions, or conclusions");
    expect(prompt).not.toMatch(/MS6/iu);
    expect(prompt).not.toMatch(/\b(?:board|port|power consumption)\b/iu);
  });
});
