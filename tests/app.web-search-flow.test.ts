import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWebSearchHistory } from "../src/web-search/history";

const viewSource = readFileSync(
  new URL("../src/ui/wiki-copilot-view.ts", import.meta.url),
  "utf8"
);
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("optional web-search flow", () => {
  it("keeps normal ask Vault-only and never starts web search", () => {
    const askMethod = viewSource.match(/private async ask\(\): Promise<void> \{[\s\S]*?\n  \}/u)?.[0] ?? "";

    expect(askMethod).toContain("this.runQuestion(question, history");
    expect(askMethod).not.toContain("searchWeb");
    expect(askMethod).not.toContain("openWebSearchConsent");
  });

  it("keeps the dedicated web flow outside retrieval and answer context", () => {
    expect(mainSource).toContain("async searchWeb(question: string, history?: WebSearchHistoryTurn[])");
    const webMethod = mainSource.match(/async searchWeb\([\s\S]*?\n  \}/u)?.[0] ?? "";

    expect(webMethod).not.toContain("retrieve(");
    expect(webMethod).not.toContain("buildAnswerContext");
  });

  it("keeps the provider request question-only by default", () => {
    expect(mainSource).toMatch(/return service\.search\(\{\r?\n\s+question,\r?\n\s+model/u);
    expect(mainSource).toContain("...(history?.length ? { history } : {})");
  });

  it("includes only bounded recent chat turns when explicitly requested", () => {
    const history = buildWebSearchHistory([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
      { role: "assistant", content: "fourth" },
      { role: "user", content: "fifth" },
      { role: "assistant", content: "sixth" },
      { role: "user", content: "seventh" }
    ]);

    expect(history).toHaveLength(6);
    expect(history[0]).toEqual({ role: "assistant", content: "second" });
    expect(history.at(-1)).toEqual({ role: "user", content: "seventh" });
  });

  it("bounds full long histories by both turns and characters", () => {
    const history = buildWebSearchHistory(Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: "x".repeat(2_000)
    })));

    expect(history.length).toBeLessThanOrEqual(6);
    expect(history.reduce((total, turn) => total + turn.content.length, 0)).toBeLessThanOrEqual(6_000);
  });
});
