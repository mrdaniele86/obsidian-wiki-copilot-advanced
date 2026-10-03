import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewSource = readFileSync(
  new URL("../src/ui/wiki-copilot-view.ts", import.meta.url),
  "utf8"
);
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const coordinatorSource = readFileSync(new URL("../src/obsidian/index-coordinator.ts", import.meta.url), "utf8");
const retrieverSource = readFileSync(new URL("../src/core/hybrid-retriever.ts", import.meta.url), "utf8");

describe("mobile view interactions", () => {
  it("keeps web sources as external links rather than vault citations", () => {
    expect(viewSource).toContain('cls: "wiki-copilot-web-sources"');
    expect(viewSource).toContain('target: "_blank", rel: "noopener noreferrer"');
  });
  it("keeps user-facing Chinese literals in the translation dictionaries", () => {
    expect(mainSource.replace(/console\.(warn|error)\([^\n]+/gu, "")).not.toMatch(/[\p{Script=Han}]/u);
    expect(settingsSource).not.toMatch(/[\p{Script=Han}]/u);
    expect(viewSource).not.toContain('text: "Wiki Copilot"');
  });
  it("maps coordinator status states through the UI translator", () => {
    expect(viewSource).toContain("this.plugin.localizedIndexStatus(status)");
    expect(mainSource).toContain("localizedIndexStatus(status: IndexStatus)");
    expect(mainSource).toContain('this.t("main.index.building")');
    expect(mainSource).toContain('this.localizedIndexStatus(diagnostics.status)');
  });

  it("opens citations in a dedicated tab instead of reusing a chat leaf", () => {
    expect(mainSource).toContain('() => this.app.workspace.getLeaf("tab")');
    expect(mainSource).toContain(
      "(candidate) => this.isReusableCitationPreviewLeaf(candidate)"
    );
    expect(mainSource).toContain("private isReusableCitationPreviewLeaf(candidate: WorkspaceLeaf): boolean");
    expect(mainSource).toContain(
      "candidate.view.getViewType() !== WIKI_COPILOT_VIEW_TYPE"
    );
    expect(mainSource).toContain("openCitation(file: TFile, subpath?: string, originLeaf?: WorkspaceLeaf)");
    expect(viewSource).toContain("this.plugin.openCitation(file, subpath, this.leaf)");
  });

  it("renders a citation-preview-only return control with a mobile touch target", () => {
    expect(mainSource).toContain('this.t("view.returnToChat")');
    expect(mainSource).toContain('this.t("view.returnToChatUnavailable")');
    expect(mainSource).toContain("this.app.workspace.revealLeaf(originLeaf)");
    expect(mainSource).toContain("originLeaf.view instanceof WikiCopilotView");
    expect(mainSource).toContain("addAction");
    expect(mainSource).toContain('action.addClass("wiki-copilot-citation-return")');
    expect(mainSource).not.toContain("returnToCitationOrigin() {\n    return this.activateView()");
  });
  it("passes typed retrieval progress semantics to the plugin translation boundary", () => {
    expect(coordinatorSource).not.toMatch(/onProgress\?\.\("[\p{Script=Han}]/u);
    expect(retrieverSource).not.toMatch(/onProgress\?\.\("[\p{Script=Han}]/u);
    expect(mainSource).toContain("localizeRetrievalProgress");
    expect(mainSource).toContain('"main.answerTimeout.precise"');
  });
  it("refreshes localized chrome in place without rebuilding the conversation shell", () => {
    expect(viewSource).toContain('const welcome = this.chatEl?.querySelector(".wiki-copilot-welcome")');
    expect(viewSource).not.toContain("refreshConfigurationState(): void {\n    if (this.containerEl.children[1]) this.renderShell()");
    expect(viewSource).toContain("refreshConversationChrome()");
    expect(viewSource).toContain('querySelectorAll<HTMLElement>(".wiki-copilot-message-label")');
    expect(viewSource).toContain('querySelectorAll<HTMLDetailsElement>(".wiki-copilot-sources")');
    expect(viewSource).toContain('querySelectorAll<HTMLAnchorElement>(".wiki-copilot-citation")');
  });

  it("dismisses the keyboard from the message region instead of intercepting the send button", () => {
    expect(viewSource).toContain('this.registerDomEvent(this.chatEl, "pointerdown"');
    expect(viewSource).not.toContain('this.registerDomEvent(container, "pointerdown"');
    expect(viewSource).toContain('this.registerDomEvent(this.askButton, "mousedown"');
    expect(viewSource).toContain("event.preventDefault();");
  });

  it("does not render response performance metrics", () => {
    expect(viewSource).not.toContain("wiki-copilot-response-timing");
    expect(viewSource).not.toContain("updateTiming");
    expect(viewSource).not.toContain("AnswerTimingTracker");
  });

  it("presents stable and pending source paths with one neutral label", () => {
    expect(viewSource).toContain('role === "stable-source" || role === "pending-source" ? "role.source"');
    expect(viewSource).not.toContain('"stable-source": "稳定原文"');
    expect(viewSource).not.toContain('"pending-source": "未验收"');
    expect(viewSource).not.toContain("可核对未验收资料");
    expect(viewSource).not.toContain("此结果包含 pending / 未验收资料");
    expect(viewSource).not.toContain("wiki-copilot-pending-chip");
    expect(viewSource).not.toContain("wiki-copilot-unverified-warning");
  });

  it("localizes welcome and composer labels without adding an Obsidian hover tooltip", () => {
    expect(viewSource).toContain('text: this.plugin.t("welcome.title")');
    expect(viewSource).toContain('text: this.plugin.t("welcome.description")');
    expect(viewSource).toContain('placeholder: this.plugin.t("composer.placeholder")');
    expect(viewSource).toContain('text: this.plugin.t("composer.shortcut")');
    expect(viewSource).toContain('text: this.plugin.t("composer.send")');
    expect(viewSource).not.toContain('"aria-label": "向 Wiki Copilot 提问"');
  });

  it("adds an explicit mobile-safe web search action and consent dialog", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

    expect(viewSource).toContain('this.requestWebSearchConsent()');
    expect(viewSource).toContain('cls: "wiki-copilot-web-search"');
    expect(viewSource).toContain('new Modal(this.app)');
    expect(viewSource).toContain('"view.webSearch.searchNow"');
    expect(viewSource).toContain('"view.webSearch.rememberSession"');
    expect(viewSource).toContain('"view.webSearch.cancel"');
    expect(styles).toContain('.wiki-copilot-web-search');
    expect(styles).toContain('min-height: 44px');
  });

  it("keeps consent decisions separate from web-search execution", () => {
    const consentMethod = viewSource.match(
      /private requestWebSearchConsent\(\): Promise<[\s\S]*?\{([\s\S]*?)\n  \}/u
    )?.[1] ?? "";

    expect(consentMethod).toContain('decide("cancel")');
    expect(consentMethod).toContain('decide("once")');
    expect(consentMethod).toContain('decide("session")');
    expect(consentMethod).not.toContain("this.plugin.searchWeb");
  });

  it("treats Escape, close, and backdrop dismissal as one cancel decision", () => {
    const consentMethod = viewSource.match(
      /private requestWebSearchConsent\(\): Promise<[\s\S]*?\{([\s\S]*?)\n  \}/u
    )?.[1] ?? "";

    expect(consentMethod).toContain('modal.onClose = () => decide("cancel")');
    expect(consentMethod).toContain("if (resolved)");
  });

  it("coalesces mobile textarea measurements to one animation frame", () => {
    expect(viewSource).toContain(
      'this.registerDomEvent(this.queryEl, "input", () => this.scheduleComposerResize())'
    );
    expect(viewSource).toContain("viewWindow.requestAnimationFrame");
    expect(viewSource).toContain("cancelAnimationFrame(this.composerResizeFrame)");
    expect(viewSource).not.toContain(
      'this.registerDomEvent(this.queryEl, "input", () => this.resizeComposer())'
    );
  });

  it("keeps the keyboard-open layout through the delayed iOS viewport close", () => {
    expect(viewSource).toContain('this.registerDomEvent(this.queryEl, "focus"');
    expect(viewSource).toContain('this.registerDomEvent(this.queryEl, "blur"');
    expect(viewSource).not.toContain("is-composer-focused");
    expect(viewSource).not.toContain("is-mobile-keyboard-visible");
    expect(viewSource).toContain("nextMobileKeyboardVisible(this.mobileKeyboardVisible");
    expect(viewSource).toContain('viewport?.addEventListener("resize"');
    expect(viewSource).toContain('viewport?.addEventListener("scroll"');
    expect(viewSource).toContain('querySelector<HTMLElement>(".mobile-navbar")');
    expect(viewSource).toContain("mobileNavigationClearance(");
    expect(viewSource).toContain('container.style.setProperty("--wiki-copilot-mobile-nav-clearance"');
  });

  it("keeps search input and result rows compact enough for mobile history", () => {
    expect(viewSource).toContain('cls: "wiki-copilot-history-search-input"');
    expect(viewSource).toContain('"wiki-copilot-history-search-item"');
  });
});
