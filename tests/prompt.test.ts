import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/llm/prompt";

describe("Wiki Copilot system prompt", () => {
  it("keeps knowledge-base answers evidence-only and citation-first", () => {
    const prompt = buildSystemPrompt("", true);
    expect(prompt).toContain("Answer only from the evidence");
    expect(prompt).toContain("[S1]");
    expect(prompt).not.toContain("No relevant knowledge-base evidence was retrieved");
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
});
