import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewSource = readFileSync(
  new URL("../src/ui/wiki-copilot-view.ts", import.meta.url),
  "utf8"
);
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");

describe("persistent conversation view", () => {
  it("offers new-chat and history controls", () => {
    expect(viewSource).toContain("startNewConversation");
    expect(viewSource).toContain("renderConversationHistory");
    expect(viewSource).toContain('this.plugin.t("view.history")');
  });

  it("loads a saved conversation and rebuilds its visible turns", () => {
    expect(viewSource).toContain("openConversation(path: string)");
    expect(viewSource).toContain("await this.plugin.conversations.load(path)");
    expect(viewSource).toContain("this.renderConversationTurns()");
  });

  it("persists only complete model exchanges", () => {
    expect(viewSource).toContain("await this.saveConversation()");
    expect(viewSource).toContain("this.conversation.turns.push({ role: \"user\", content: question })");
    expect(viewSource).toContain("sources: answer.sources");
    expect(viewSource).toContain("knowledgeBaseHit: answer.knowledgeBaseHit");
    expect(viewSource).toContain("await this.saveConversation()");
  });

  it("uses a vault-backed store and configurable folder", () => {
    expect(mainSource).toContain("new ConversationStore(this.app.vault)");
    expect(settingsSource).toContain("conversationFolder");
  });
});
