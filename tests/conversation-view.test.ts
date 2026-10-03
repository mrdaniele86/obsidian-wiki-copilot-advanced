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
    expect(viewSource).toContain("this.setHistoryOpen(false);");
  });

  it("offers localized, confirmed deletion from each history item", () => {
    expect(viewSource).toContain('this.plugin.t("view.deleteConversation"');
    expect(viewSource).toContain('this.plugin.t("view.deleteConversationConfirm"');
    expect(viewSource).toContain("await this.plugin.conversations.delete(path)");
    expect(viewSource).toContain("void this.renderConversationHistory()");
  });

  it("keeps history behind an accessible header toggle and closes it outside the panel", () => {
    expect(viewSource).toContain('cls: "clickable-icon wiki-copilot-history-toggle"');
    expect(viewSource).toContain('"aria-label": this.plugin.t("view.history")');
    expect(viewSource).toContain('"aria-expanded": "false"');
    expect(viewSource).toContain("setIcon(this.historyToggle, \"history\")");
    expect(viewSource).toContain("this.setHistoryBrowseOpen()");
    expect(viewSource).toContain('this.registerDomEvent(this.containerEl.ownerDocument, "pointerdown"');
    expect(viewSource).toContain("this.historyEl.contains(target) || this.historyToggle.contains(target)");
    expect(viewSource).toContain('querySelector(".modal-container")');
    expect(viewSource).toContain("this.setHistoryOpen(false);");
    expect(viewSource).not.toContain('history.createEl("summary"');
  });

  it("offers an accessible fuzzy search panel that restores a selected result", () => {
    expect(viewSource).toContain('setIcon(this.historySearchToggle, "search")');
    expect(viewSource).toContain("searchConversations(this.historyConversations, this.historySearchQuery)");
    expect(viewSource).toContain("this.historySearchInput?.focus()");
    expect(viewSource).toContain("await this.openConversation(stored.path)");
  });

  it("focuses the opened search input and keeps it mounted while typing", () => {
    expect(viewSource).toContain("await this.renderConversationHistory();");
    expect(viewSource).toContain("this.historySearchInput?.focus();");
    expect(viewSource).toContain("void this.renderConversationSearchResults()");
    expect(viewSource).not.toContain("void this.renderConversationHistory();\n      });");
  });

  it("uses ordinary history rows for a blank search query", () => {
    expect(viewSource).toContain("!this.historySearchQuery.trim()");
    expect(viewSource).toContain('"wiki-copilot-history-item"');
    expect(viewSource).toContain("if (this.historySearchQuery.trim() && excerpt)");
  });

  it("persists only complete model exchanges", () => {
    expect(viewSource).toContain("await this.saveConversation()");
    expect(viewSource).toContain("this.conversation.turns.push({ role: \"user\", content: question })");
    expect(viewSource).toContain("sources: answer.sources");
    expect(viewSource).toContain("knowledgeBaseHit: answer.knowledgeBaseHit");
    expect(viewSource).toContain("await this.saveConversation()");
  });

  it("renders stored web sources in their own external-link block", () => {
    expect(viewSource).toContain("this.renderWebSources(body, webSearch)");
    expect(viewSource).toContain('cls: "wiki-copilot-web-sources"');
    expect(viewSource).toContain('attr: { href: source.url, target: "_blank", rel: "noopener noreferrer" }');
  });

  it("uses a vault-backed store and configurable folder", () => {
    expect(mainSource).toContain("new ConversationStore(this.app.vault)");
    expect(settingsSource).toContain("conversationFolder");
  });
});
