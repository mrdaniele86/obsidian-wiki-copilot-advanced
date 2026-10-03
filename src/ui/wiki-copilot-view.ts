import {
  Component,
  ConfirmationModal,
  ItemView,
  Modal,
  Notice,
  parseLinktext,
  Platform,
  setIcon,
  WorkspaceLeaf
} from "obsidian";
import { AnswerTimeoutError } from "../core/answer-error";
import {
  citationIdFromText,
  citationTarget,
  linkifyAnswerCitations
} from "../core/citations";
import { yieldToUi } from "../core/cooperative";
import { sourceReferencesFromRetrieval } from "../core/context-builder";
import type { RetrievalResult, SourceReference } from "../core/types";
import {
  StreamFallbackRequiredError
} from "../llm/openai-compatible";
import { localizeModelError } from "./model-response-localization";
import type { ChatTurn } from "../core/types";
import { assistantRenderState } from "../chat/conversation-types";
import type { Conversation, StoredConversation } from "../chat/conversation-types";
import { searchConversations } from "../chat/conversation-search";
import type { ModelResponseMode } from "../llm/openai-compatible";
import { RequestCancelledError } from "../llm/request-timeout";
import type WikiCopilotPlugin from "../main";
import type { IndexStatus } from "../obsidian/index-coordinator";
import {
  mobileNavigationClearance,
  nextMobileKeyboardVisible,
  shouldReserveMobileNavigationClearance,
  shouldDismissMobileKeyboardFromChat,
  syncComposerFocus
} from "./composer-focus";
import { findExpandedSourceButton } from "./source-highlight";
import { StreamingMarkdownRenderer } from "./streaming-markdown-renderer";

export const WIKI_COPILOT_VIEW_TYPE = "wiki-copilot-view";

interface AssistantMessageHandle {
  update(markdown: string): void;
  finish(markdown: string, sources: SourceReference[]): Promise<void>;
  interrupt(markdown: string, sources: SourceReference[], message: string): Promise<void>;
}

interface RunQuestionOptions {
  appendUserMessage: boolean;
  responseMode?: ModelResponseMode;
}

export class WikiCopilotView extends ItemView {
  private chatEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private queryEl!: HTMLTextAreaElement;
  private askButton!: HTMLButtonElement;
  private webSearchButton!: HTMLButtonElement;
  private historyEl!: HTMLElement;
  private historyToggle!: HTMLButtonElement;
  private historySearchToggle!: HTMLButtonElement;
  private historySearchInput: HTMLInputElement | null = null;
  private historyResultsEl: HTMLElement | null = null;
  private historyConversations: StoredConversation[] = [];
  private historyOpen = false;
  private historySearchOpen = false;
  private historySearchQuery = "";
  private turns: ChatTurn[] = [];
  private conversation: Conversation | null = null;
  private conversationPath: string | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private conversationComponent: Component | null = null;
  private activeRequest: AbortController | null = null;
  private composerResizeFrame: number | null = null;
  private mobileViewportFrame: number | null = null;
  private mobileViewportCleanup: (() => void) | null = null;
  private mobileViewportBaselineHeight = 0;
  private mobileViewportWidth = 0;
  private mobileKeyboardVisible = false;
  private mobileNavAnimationFrames = 0;
  private requestSequence = 0;
  private busy = false;
  private lastStatus: IndexStatus | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WikiCopilotPlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return WIKI_COPILOT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.plugin.t("view.title");
  }

  override getIcon(): string {
    return "message-circle";
  }

  override async onOpen(): Promise<void> {
    this.renderShell();
    this.unsubscribeStatus = this.plugin.indexCoordinator.subscribe((status) => this.renderStatus(status));
  }

  override async onClose(): Promise<void> {
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.cancelComposerResize();
    this.stopMobileViewportTracking();
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    this.requestSequence += 1;
    this.conversationComponent = null;
  }

  focusInput(): void {
    this.queryEl?.focus();
  }

  setProtocolQuery(query: string, send = false): void {
    this.queryEl.value = query;
    this.scheduleComposerResize();
    if (send) void this.ask();
  }

  refreshConfigurationState(): void {
    const container = this.containerEl.children[1] as HTMLElement | undefined;
    if (!container || !this.queryEl || !this.askButton) return;
    container.querySelector(".wiki-copilot-title-group h2")?.setText(this.plugin.t("view.title"));
    const actionButtons = container.querySelectorAll<HTMLButtonElement>(".wiki-copilot-header-actions button");
    actionButtons[0]?.setAttribute("aria-label", this.plugin.t("view.rebuild"));
    actionButtons[1]?.setAttribute("aria-label", this.plugin.t("view.historySearch"));
    actionButtons[2]?.setAttribute("aria-label", this.plugin.t("view.history"));
    actionButtons[3]?.setAttribute("aria-label", this.plugin.t("view.newConversation"));
    this.queryEl.setAttribute("placeholder", this.plugin.t("composer.placeholder"));
    container.querySelector(".wiki-copilot-shortcut")?.setText(this.plugin.t("composer.shortcut"));
    this.setBusy(this.busy);
    const welcome = this.chatEl?.querySelector(".wiki-copilot-welcome");
    if (welcome) {
      welcome.remove();
      this.renderWelcome();
    }
    if (this.lastStatus) this.renderStatus(this.lastStatus);
    this.refreshConversationChrome();
  }

  private refreshConversationChrome(): void {
    if (!this.chatEl) return;
    for (const label of this.chatEl.querySelectorAll<HTMLElement>(".wiki-copilot-message-label")) {
      const message = label.parentElement;
      if (message?.hasClass("is-user")) label.setText(this.plugin.t("view.user"));
      else if (message?.hasClass("wiki-copilot-loading") || message?.hasClass("is-streaming")) label.setText(this.plugin.t("view.title"));
      else if (message?.hasClass("is-status")) label.setText(this.plugin.t("view.stopped"));
      else if (message?.hasClass("is-error")) label.setText(this.plugin.t(message.dataset.errorKind === "timeout" ? "view.timeout" : "view.failed"));
      else if (message?.dataset.messageKind === "retrieval") label.setText(this.plugin.t("view.localRetrieval"));
      else label.setText(this.plugin.t("view.title"));
    }
    for (const badge of this.chatEl.querySelectorAll<HTMLElement>(".wiki-copilot-general-answer-badge")) {
      badge.setText(this.plugin.t("view.generalAnswer"));
      badge.setAttribute("title", this.plugin.t("view.generalAnswerTitle"));
    }
    for (const role of this.chatEl.querySelectorAll<HTMLElement>(".wiki-copilot-role")) {
      const sourceRole = role.dataset.role as SourceReference["role"] | undefined;
      if (sourceRole) role.setText(this.roleLabel(sourceRole));
    }
    for (const origin of this.chatEl.querySelectorAll<HTMLElement>(".wiki-copilot-origin")) origin.setText(this.plugin.t("view.wikiLink"));
    for (const details of this.chatEl.querySelectorAll<HTMLDetailsElement>(".wiki-copilot-sources")) {
      details.querySelector("summary")?.setText(this.plugin.t("view.sources", { count: details.querySelectorAll(".wiki-copilot-source").length }));
    }
    for (const source of this.chatEl.querySelectorAll<HTMLButtonElement>(".wiki-copilot-source")) {
      const id = source.dataset.sourceId;
      const title = source.querySelector(".wiki-copilot-source-title")?.textContent ?? "";
      if (id) source.setAttribute("aria-label", this.plugin.t("view.openSource", { id, title }));
    }
    for (const citation of this.chatEl.querySelectorAll<HTMLAnchorElement>(".wiki-copilot-citation")) {
      const id = citation.dataset.sourceId;
      const title = citation.dataset.sourceTitle;
      if (id && title) citation.setAttribute("aria-label", this.plugin.t("view.openSource", { id, title }));
    }
  }

  private renderShell(): void {
    this.cancelComposerResize();
    this.stopMobileViewportTracking();
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("wiki-copilot-view");
    this.resetConversationComponent();

    const header = container.createDiv({ cls: "wiki-copilot-header" });
    const titleGroup = header.createDiv({ cls: "wiki-copilot-title-group" });
    titleGroup.createEl("h2", { text: this.plugin.t("view.title") });
    this.statusEl = titleGroup.createDiv({ cls: "wiki-copilot-status wiki-copilot-header-status" });

    const actions = header.createDiv({ cls: "wiki-copilot-header-actions" });
    const rebuild = actions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": this.plugin.t("view.rebuild") }
    });
    setIcon(rebuild, "refresh-cw");
    this.registerDomEvent(rebuild, "click", () => void this.plugin.rebuildIndex());

    this.historySearchToggle = actions.createEl("button", {
      cls: "clickable-icon wiki-copilot-history-search-toggle",
      attr: {
        "aria-label": this.plugin.t("view.historySearch"),
        "aria-expanded": "false"
      }
    });
    setIcon(this.historySearchToggle, "search");
    this.registerDomEvent(this.historySearchToggle, "click", () => void this.setHistorySearchOpen(!this.historySearchOpen));

    this.historyToggle = actions.createEl("button", {
      cls: "clickable-icon wiki-copilot-history-toggle",
      attr: {
        "aria-label": this.plugin.t("view.history"),
        "aria-expanded": "false"
      }
    });
    setIcon(this.historyToggle, "history");
    this.registerDomEvent(this.historyToggle, "click", () => this.setHistoryBrowseOpen());

    const clear = actions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": this.plugin.t("view.newConversation") }
    });
    setIcon(clear, "square-pen");
    this.registerDomEvent(clear, "click", () => this.startNewConversation());

    this.historyEl = container.createDiv({ cls: "wiki-copilot-history" });
    this.registerDomEvent(this.containerEl.ownerDocument, "pointerdown", (event) => {
      const target = event.target;
      if (!this.historyOpen || !(target instanceof Node) ||
        this.historyEl.contains(target) || this.historyToggle.contains(target) ||
        this.historySearchToggle.contains(target) ||
        this.containerEl.ownerDocument.querySelector(".modal-container")) {
        return;
      }
      this.setHistoryOpen(false);
    });

    this.chatEl = container.createDiv({ cls: "wiki-copilot-chat" });
    this.registerDomEvent(this.chatEl, "pointerdown", (event) => {
      if (Platform.isMobile && shouldDismissMobileKeyboardFromChat(event.target)) {
        this.queryEl?.blur();
      }
    });
    this.renderWelcome();

    const composer = container.createDiv({ cls: "wiki-copilot-composer" });
    this.queryEl = composer.createEl("textarea", {
      cls: "wiki-copilot-input",
      attr: {
        rows: Platform.isMobile ? "1" : "3",
        placeholder: this.plugin.t("composer.placeholder")
      }
    });
    this.registerDomEvent(this.queryEl, "keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.ask();
      }
    });
    this.registerDomEvent(this.queryEl, "input", () => this.scheduleComposerResize());
    this.registerDomEvent(this.queryEl, "focus", () => {
      if (Platform.isMobile) {
        this.setMobileKeyboardVisible(true);
        this.trackMobileNavbarAnimation(container);
      }
    });
    this.registerDomEvent(this.queryEl, "blur", () => {
      this.trackMobileNavbarAnimation(container);
      this.scheduleMobileViewportSync(container);
    });
    this.resizeComposerNow();
    this.startMobileViewportTracking(container);

    const controls = composer.createDiv({ cls: "wiki-copilot-composer-controls" });
    controls.createSpan({ cls: "wiki-copilot-shortcut", text: this.plugin.t("composer.shortcut") });
    const buttons = controls.createDiv({ cls: "wiki-copilot-composer-buttons" });
    this.webSearchButton = buttons.createEl("button", {
      cls: "wiki-copilot-web-search",
      text: this.plugin.t("view.webSearch.action"),
      attr: { "aria-label": this.plugin.t("view.webSearch.action") }
    });
    this.webSearchButton.disabled = this.plugin.settings.webSearch.mode === "disabled";
    this.registerDomEvent(this.webSearchButton, "click", () => void this.openWebSearchConsent());
    this.askButton = buttons.createEl("button", { cls: "mod-cta", text: this.plugin.t("composer.send") });
    this.registerDomEvent(this.askButton, "mousedown", (event) => {
      if (Platform.isMobile) {
        // Keep the textarea focused until click fires so iOS cannot move the
        // composer during the same tap and cancel the button activation.
        event.preventDefault();
      }
    });
    this.registerDomEvent(this.askButton, "click", () => {
      if (this.busy) {
        this.cancelActiveRequest();
      } else {
        void this.ask();
      }
    });
  }

  private async openWebSearchConsent(): Promise<void> {
    const question = this.queryEl.value.trim();
    if (!question) {
      new Notice(this.plugin.t("view.emptyQuestion"));
      return;
    }
    if (this.plugin.settings.webSearch.mode !== "dedicated-gemini") {
      new Notice(this.plugin.t("view.webSearch.unavailable"));
      return;
    }
    const decision = this.plugin.webSearchConsent.has("gemini", this.plugin.settings.webSearch.geminiModel)
      ? "session"
      : await this.requestWebSearchConsent();
    if (decision === "session") {
      this.plugin.webSearchConsent.remember("gemini", this.plugin.settings.webSearch.geminiModel);
    }
  }

  private requestWebSearchConsent(): Promise<"cancel" | "once" | "session"> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      let resolved = false;
      const decide = (decision: "cancel" | "once" | "session"): void => {
        if (!resolved) {
          resolved = true;
          resolve(decision);
        }
        modal.close();
      };
      modal.setTitle(this.plugin.t("view.webSearch.consent.title"));
      modal.contentEl.createEl("p", { text: this.plugin.t("view.webSearch.consent.questionOnly") });
      modal.contentEl.createEl("p", { text: this.plugin.t("view.webSearch.consent.dataHandling") });
      const actions = modal.contentEl.createDiv({ cls: "wiki-copilot-web-search-consent-actions" });
      const searchNow = actions.createEl("button", { cls: "mod-cta", text: this.plugin.t("view.webSearch.searchNow") });
      this.registerDomEvent(searchNow, "click", () => decide("once"));
      const remember = actions.createEl("button", { text: this.plugin.t("view.webSearch.rememberSession") });
      this.registerDomEvent(remember, "click", () => decide("session"));
      const cancel = actions.createEl("button", { text: this.plugin.t("view.webSearch.cancel") });
      this.registerDomEvent(cancel, "click", () => decide("cancel"));
      modal.open();
    });
  }

  private renderWelcome(): void {
    const welcome = this.chatEl.createDiv({ cls: "wiki-copilot-welcome" });
    const icon = welcome.createDiv({ cls: "wiki-copilot-welcome-icon" });
    setIcon(icon, "message-circle");
    welcome.createEl("h3", { text: this.plugin.t("welcome.title") });
    welcome.createEl("p", {
      text: this.plugin.t("welcome.description")
    });
    if (!this.plugin.isModelConfigured()) {
      welcome.createEl("p", {
        cls: "wiki-copilot-callout",
        text: this.plugin.t("welcome.unconfigured")
      });
    }
  }

  private renderStatus(status: IndexStatus): void {
    this.lastStatus = status;
    if (!this.statusEl) {
      return;
    }
    this.statusEl.empty();
    const dot = this.statusEl.createSpan({ cls: `wiki-copilot-status-dot is-${status.state}` });
    dot.setAttribute("aria-hidden", "true");
    this.statusEl.createSpan({ text: this.plugin.localizedIndexStatus(status) });
    const profile = this.plugin.indexCoordinator.profile;
    if (profile && profile.warnings.length > 0) {
      const warning = this.statusEl.createEl("button", {
        cls: "clickable-icon wiki-copilot-profile-warning",
        attr: { "aria-label": profile.warnings.join(" ") }
      });
      setIcon(warning, "triangle-alert");
    }
  }

  private startNewConversation(): void {
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.requestSequence += 1;
    this.turns = [];
    this.conversation = null;
    this.conversationPath = null;
    this.resetConversationComponent();
    this.chatEl.empty();
    this.renderWelcome();
    this.queryEl.value = "";
    this.resetComposerHeight();
    this.setBusy(false);
  }

  private async renderConversationHistory(): Promise<void> {
    if (!this.historyEl) return;
    this.historyEl.empty();
    const history = this.historyEl.createDiv({ cls: "wiki-copilot-history-panel" });
    if (this.historySearchOpen) {
      this.historySearchInput = history.createEl("input", {
        cls: "wiki-copilot-history-search-input",
        type: "search",
        value: this.historySearchQuery,
        attr: {
          "aria-label": this.plugin.t("view.historySearch"),
          placeholder: this.plugin.t("view.historySearchPlaceholder")
        }
      });
      this.registerDomEvent(this.historySearchInput, "input", () => {
        this.historySearchQuery = this.historySearchInput?.value ?? "";
        void this.renderConversationSearchResults();
      });
    } else {
      this.historySearchInput = null;
    }
    try {
      this.historyConversations = await this.plugin.conversations.list(this.plugin.settings.conversationFolder);
      if (this.historyConversations.length === 0) {
        history.createDiv({ cls: "wiki-copilot-history-empty", text: this.plugin.t("view.historyEmpty") });
        return;
      }
      this.historyResultsEl = history.createDiv({ cls: "wiki-copilot-history-list" });
      this.renderConversationSearchResults();
    } catch (error) {
      console.error("Wiki Copilot: failed to list conversations.", error);
      history.createDiv({ cls: "wiki-copilot-history-error", text: this.plugin.t("view.historyLoadFailed") });
    }
  }

  private async openConversation(path: string): Promise<void> {
    try {
      const conversation = await this.plugin.conversations.load(path);
      if (!conversation) {
        new Notice(this.plugin.t("view.historyLoadFailed"));
        return;
      }
      this.activeRequest?.abort();
      this.activeRequest = null;
      this.requestSequence += 1;
      this.conversation = conversation;
      this.conversationPath = path;
      this.turns = conversation.turns.map((turn) => ({ ...turn }));
      this.setHistoryOpen(false);
      this.renderConversationTurns();
    } catch (error) {
      console.error("Wiki Copilot: failed to open conversation.", error);
      new Notice(this.plugin.t("view.historyLoadFailed"));
    }
  }

  private renderConversationSearchResults(): void {
    if (!this.historyResultsEl) return;
    this.historyResultsEl.empty();
    if (!this.historySearchOpen || !this.historySearchQuery.trim()) {
      for (const stored of this.historyConversations) {
        this.renderConversationHistoryEntry(stored);
      }
      return;
    }

    const results = searchConversations(this.historyConversations, this.historySearchQuery);
    if (results.length === 0) {
      this.historyResultsEl.createDiv({ cls: "wiki-copilot-history-empty", text: this.plugin.t("view.historySearchNoResults") });
      return;
    }
    for (const result of results) {
      this.renderConversationHistoryEntry(result.stored, result.excerpt);
    }
  }

  private renderConversationHistoryEntry(stored: StoredConversation, excerpt?: string): void {
    if (!this.historyResultsEl) return;
    const isSearchResult = this.historySearchQuery.trim() && excerpt;
    const item = this.historyResultsEl.createDiv({ cls: "wiki-copilot-history-entry" });
    const button = item.createEl("button", {
      cls: isSearchResult ? "wiki-copilot-history-search-item" : "wiki-copilot-history-item",
      attr: { "aria-label": this.plugin.t("view.openConversation", { title: stored.conversation.title }) }
    });
    button.createDiv({ cls: "wiki-copilot-history-title", text: stored.conversation.title });
    if (this.historySearchQuery.trim() && excerpt) {
      button.createDiv({
        cls: "wiki-copilot-history-excerpt",
        text: excerpt,
        attr: { "aria-label": this.plugin.t("view.historySearchExcerpt", { excerpt }) }
      });
    }
    this.registerDomEvent(button, "click", () => {
      if (isSearchResult) {
        void (async () => {
          await this.openConversation(stored.path);
        })();
      } else {
        void this.openConversation(stored.path);
      }
    });
    const remove = item.createEl("button", {
      cls: "clickable-icon wiki-copilot-history-delete",
      attr: { "aria-label": this.plugin.t("view.deleteConversation", { title: stored.conversation.title }) }
    });
    setIcon(remove, "trash-2");
    this.registerDomEvent(remove, "click", () => this.confirmDeleteConversation(stored.path, stored.conversation.title));
  }

  private setHistoryOpen(open: boolean): void {
    this.historyOpen = open;
    if (!open) {
      this.historySearchOpen = false;
      this.historySearchQuery = "";
      this.historySearchInput = null;
    }
    this.historyEl.toggleClass("is-open", open);
    this.historyToggle.setAttribute("aria-expanded", String(open && !this.historySearchOpen));
    this.historySearchToggle.setAttribute("aria-expanded", String(open && this.historySearchOpen));
    if (open) void this.renderConversationHistory();
  }

  private async setHistorySearchOpen(open: boolean): Promise<void> {
    this.historySearchOpen = open;
    if (open) {
      this.historySearchQuery = "";
      this.historyOpen = true;
      this.historyEl.toggleClass("is-open", true);
      this.historyToggle.setAttribute("aria-expanded", "false");
      this.historySearchToggle.setAttribute("aria-expanded", "true");
      await this.renderConversationHistory();
      this.historySearchInput?.focus();
      return;
    }
    this.setHistoryOpen(false);
  }

  private setHistoryBrowseOpen(): void {
    const shouldOpen = !this.historyOpen || this.historySearchOpen;
    this.historySearchOpen = false;
    this.setHistoryOpen(shouldOpen);
  }

  private confirmDeleteConversation(path: string, title: string): void {
    const modal = new ConfirmationModal(this.app);
    modal.setTitle(this.plugin.t("view.deleteConversation", { title }));
    modal.setContent(this.plugin.t("view.deleteConversationConfirm", { title }));
    modal.addCancelButton(this.plugin.t("view.cancel"));
    modal.addButton((button) => button
      .setButtonText(this.plugin.t("view.delete"))
      .setDestructive()
      .setCta()
      .onClick(async () => {
        try {
          await this.plugin.conversations.delete(path);
          if (this.conversationPath === path) {
            this.startNewConversation();
          }
          void this.renderConversationHistory();
        } catch (error) {
          console.error("Wiki Copilot: failed to delete conversation.", error);
          new Notice(this.plugin.t("view.historyLoadFailed"));
        }
      }));
    modal.open();
  }

  private renderConversationTurns(): void {
    this.resetConversationComponent();
    this.chatEl.empty();
    for (const turn of this.conversation?.turns ?? []) {
      if (turn.role === "user") this.appendUserMessage(turn.content);
      else {
        const state = assistantRenderState(turn);
        void this.appendAssistantMessage(turn.content, state.sources, state.knowledgeBaseHit);
      }
    }
    this.queryEl.value = "";
    this.resetComposerHeight();
    this.setBusy(false);
  }

  private async saveConversation(): Promise<void> {
    if (!this.conversation?.turns.length) return;
    try {
      this.conversationPath = await this.plugin.conversations.save(this.plugin.settings.conversationFolder, this.conversation);
      void this.renderConversationHistory();
    } catch (error) {
      console.error("Wiki Copilot: failed to save conversation.", error);
      new Notice(this.plugin.t("view.historySaveFailed"));
    }
  }

  private async ask(): Promise<void> {
    if (this.busy) {
      new Notice(this.plugin.t("view.busy"));
      return;
    }
    const question = this.queryEl.value.trim();
    if (!question) {
      new Notice(this.plugin.t("view.emptyQuestion"));
      return;
    }
    const history = [...this.turns];
    this.queryEl.value = "";
    this.resetComposerHeight();
    await this.runQuestion(question, history, { appendUserMessage: true });
  }

  private async runQuestion(
    question: string,
    history: ChatTurn[],
    options: RunQuestionOptions
  ): Promise<void> {
    const sequence = ++this.requestSequence;
    const useModel = this.plugin.isModelConfigured();
    const requestController = new AbortController();
    this.activeRequest = requestController;
    this.setBusy(true);
    this.chatEl.querySelector(".wiki-copilot-welcome")?.remove();
    if (options.appendUserMessage) {
      this.appendUserMessage(question);
    }
    if (useModel) {
      this.turns.push({ role: "user", content: question });
    }
    const loading = this.appendLoading(this.plugin.t("view.preparing"));
    let waitingForFirstContent = true;
    const streamState: {
      markdown: string;
      message: AssistantMessageHandle | null;
    } = { markdown: "", message: null };
    let sources: SourceReference[] = [];
    let knowledgeBaseHit = true;
    let activeResponseMode: "stream" | "non-stream" | null = null;
    await this.yieldToPaint();
    try {
      const updateProgress = (message: string): void => {
        if (sequence === this.requestSequence) {
          if (waitingForFirstContent) {
            loading.setText(message);
          }
        }
      };
      if (!useModel) {
        const result = await this.plugin.retrieve(
          question,
          history,
          updateProgress,
          requestController.signal
        );
        if (requestController.signal.aborted) {
          throw new RequestCancelledError();
        }
        if (sequence !== this.requestSequence) {
          return;
        }
        loading.remove();
        this.appendRetrievalResult(result);
        return;
      }

      const answer = await this.plugin.answer(question, history, {
        signal: requestController.signal,
        responseMode: options.responseMode,
        onProgress: updateProgress,
        onRetrieved: (retrievedSources, hit) => {
          if (sequence === this.requestSequence) {
            sources = retrievedSources;
            knowledgeBaseHit = hit;
          }
        },
        onResponseMode: (mode, detail) => {
          if (sequence !== this.requestSequence) {
            return;
          }
          activeResponseMode = mode;
          if (!detail) {
            updateProgress(mode === "stream"
              ? this.plugin.t("view.connecting")
              : this.plugin.t("view.waiting"));
          }
        },
        onModelActivity: (activity) => {
          if (sequence !== this.requestSequence) {
            return;
          }
          if (activity === "response-headers") {
            updateProgress(activeResponseMode === "stream"
              ? this.plugin.t("view.connected")
              : this.plugin.t("view.reading"));
          } else {
            updateProgress(this.plugin.t("view.receiving"));
          }
        },
        onDelta: (delta) => {
          if (sequence !== this.requestSequence || requestController.signal.aborted) {
            return;
          }
          streamState.markdown += delta;
          if (!streamState.message) {
            waitingForFirstContent = false;
            loading.remove();
            streamState.message = this.appendStreamingAssistantMessage(knowledgeBaseHit);
          }
          streamState.message.update(streamState.markdown);
        }
      });
      if (sequence !== this.requestSequence) {
        return;
      }
      if (requestController.signal.aborted) {
        throw new RequestCancelledError();
      }
      waitingForFirstContent = false;
      if (streamState.message) {
        await streamState.message.finish(answer.markdown, answer.sources);
      } else {
        loading.remove();
        await this.appendAssistantMessage(
          answer.markdown,
          answer.sources,
          answer.knowledgeBaseHit
        );
      }
      this.turns.push({ role: "assistant", content: answer.markdown });
      const now = new Date().toISOString();
      this.conversation ??= {
        id: this.newConversationId(),
        createdAt: now,
        updatedAt: now,
        title: question.slice(0, 80),
        turns: []
      };
      this.conversation.turns.push({ role: "user", content: question });
      this.conversation.turns.push({
        role: "assistant",
        content: answer.markdown,
        sources: answer.sources,
        knowledgeBaseHit: answer.knowledgeBaseHit
      });
      this.conversation.updatedAt = now;
      await this.saveConversation();
    } catch (error) {
      if (sequence === this.requestSequence) {
        const lastTurn = this.turns.at(-1);
        if (lastTurn?.role === "user" && lastTurn.content === question) {
          this.turns.pop();
        }
        waitingForFirstContent = false;
        loading.remove();
        if (error instanceof RequestCancelledError) {
          if (streamState.message && streamState.markdown) {
            await streamState.message.interrupt(
              streamState.markdown,
              sources,
              this.plugin.t("view.stoppedPartial")
            );
          } else {
            this.appendStoppedMessage();
          }
        } else if (streamState.message && streamState.markdown) {
          await streamState.message.interrupt(
            streamState.markdown,
            sources,
            this.plugin.t("view.interrupted", {
              message: localizeModelError(this.plugin.t.bind(this.plugin), error)
            })
          );
        } else if (error instanceof StreamFallbackRequiredError) {
          let errorContainer: HTMLElement | null = null;
          errorContainer = this.appendError(error, {
            label: this.plugin.t("view.retryCompatibility"),
            action: () => {
              errorContainer?.remove();
              void this.runQuestion(question, history, {
                appendUserMessage: false,
                responseMode: "non-stream"
              });
            }
          });
        } else {
          this.appendError(error);
        }
      }
    } finally {
      if (this.activeRequest === requestController) {
        this.activeRequest = null;
      }
      if (sequence === this.requestSequence) {
        this.setBusy(false);
      }
    }
  }

  private appendUserMessage(text: string): void {
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-user" });
    message.createDiv({ cls: "wiki-copilot-message-label", text: this.plugin.t("view.user") });
    message.createDiv({ cls: "wiki-copilot-message-body", text });
    this.scrollToBottom();
  }

  private appendLoading(text: string): { remove: () => void; setText: (value: string) => void } {
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant wiki-copilot-loading" });
    message.createDiv({ cls: "wiki-copilot-message-label", text: this.plugin.t("view.title") });
    const body = message.createDiv({ cls: "wiki-copilot-message-body" });
    body.createSpan({ cls: "wiki-copilot-spinner" });
    const label = body.createSpan({ text });
    this.scrollToBottom();
    return {
      remove: () => message.remove(),
      setText: (value) => {
        const keepPinned = this.isNearBottom();
        label.setText(value);
        if (keepPinned) {
          this.scrollToBottom();
        }
      }
    };
  }

  private async appendAssistantMessage(
    markdown: string,
    sources: SourceReference[],
    knowledgeBaseHit: boolean
  ): Promise<void> {
    const message = this.appendStreamingAssistantMessage(knowledgeBaseHit);
    await message.finish(markdown, sources);
  }

  private appendStreamingAssistantMessage(knowledgeBaseHit: boolean): AssistantMessageHandle {
    const initiallyPinned = this.isNearBottom();
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant" });
    message.addClass("is-streaming");
    const label = message.createDiv({ cls: "wiki-copilot-message-label", text: this.plugin.t("view.title") });
    if (!knowledgeBaseHit) {
      label.createSpan({
        cls: "wiki-copilot-general-answer-badge",
        text: this.plugin.t("view.generalAnswer"),
        attr: { title: this.plugin.t("view.generalAnswerTitle") }
      });
    }
    const body = message.createDiv({ cls: "wiki-copilot-message-body markdown-rendered" });
    const owner = this.ensureConversationComponent();
    const renderer = owner.addChild(new StreamingMarkdownRenderer(this.app, body, "", {
      shouldKeepPinned: () => this.isNearBottom(),
      onRendered: (keepPinned) => {
        if (keepPinned) {
          this.scrollToBottom();
        }
      }
    }));
    let finalized = false;

    if (initiallyPinned) {
      this.scrollToBottom();
    }
    return {
      update: (streamedMarkdown) => {
        if (!finalized) {
          renderer.update(streamedMarkdown);
        }
      },
      finish: async (finalMarkdown, finalSources) => {
        if (finalized) {
          return;
        }
        finalized = true;
        message.removeClass("is-streaming");
        await renderer.finalize(linkifyAnswerCitations(finalMarkdown, finalSources));
        const keepPinned = this.isNearBottom();
        this.registerCitationLinks(body, finalSources);
        this.renderSources(body, finalSources);
        if (keepPinned) {
          this.scrollToBottom();
        }
      },
      interrupt: async (partialMarkdown, partialSources, statusMessage) => {
        if (finalized) {
          return;
        }
        finalized = true;
        message.removeClass("is-streaming");
        message.addClass("is-interrupted");
        await renderer.finalize(linkifyAnswerCitations(partialMarkdown, partialSources));
        const keepPinned = this.isNearBottom();
        this.registerCitationLinks(body, partialSources);
        body.createDiv({ cls: "wiki-copilot-stream-status", text: statusMessage });
        this.renderSources(body, partialSources);
        if (keepPinned) {
          this.scrollToBottom();
        }
      }
    };
  }

  private appendRetrievalResult(result: RetrievalResult): void {
    const keepPinned = this.isNearBottom();
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant", attr: { "data-message-kind": "retrieval" } });
    message.createDiv({ cls: "wiki-copilot-message-label", text: this.plugin.t("view.localRetrieval") });
    const body = message.createDiv({ cls: "wiki-copilot-message-body" });
    if (result.chunks.length === 0) {
      body.setText(this.plugin.t("view.noChunks"));
      if (keepPinned) {
        this.scrollToBottom();
      }
      return;
    }
    body.createEl("p", {
      text: this.plugin.t("view.selectedChunks", { count: result.chunks.length, candidates: result.totalCandidates, truncated: result.truncated ? this.plugin.t("view.truncated") : "" })
    });
    const sources = sourceReferencesFromRetrieval(result);
    this.renderSources(body, sources, result);
    if (keepPinned) {
      this.scrollToBottom();
    }
  }

  private renderSources(
    container: HTMLElement,
    sources: SourceReference[],
    retrieval?: RetrievalResult
  ): void {
    if (sources.length === 0) {
      return;
    }
    const details = container.createEl("details", { cls: "wiki-copilot-sources" });
    details.createEl("summary", { text: this.plugin.t("view.sources", { count: sources.length }) });
    const list = details.createDiv({ cls: "wiki-copilot-source-list" });

    sources.forEach((source, index) => {
      const sourceButton = list.createEl("button", {
        cls: "wiki-copilot-source",
        attr: { "data-source-id": source.id, "aria-label": this.plugin.t("view.openSource", { id: source.id, title: source.title }) }
      });
      const top = sourceButton.createDiv({ cls: "wiki-copilot-source-top" });
      top.createSpan({ cls: "wiki-copilot-source-id", text: `[${source.id}]` });
      top.createSpan({ cls: `wiki-copilot-role is-${source.role}`, text: this.roleLabel(source.role), attr: { "data-role": source.role } });
      if (source.origin === "wikilink") {
        top.createSpan({ cls: "wiki-copilot-origin", text: this.plugin.t("view.wikiLink") });
      }
      sourceButton.createDiv({ cls: "wiki-copilot-source-title", text: source.title });
      sourceButton.createDiv({
        cls: "wiki-copilot-source-path",
        text: source.heading ? `${source.path} › ${source.heading}` : source.path
      });
      const chunk = retrieval?.chunks[index];
      if (chunk) {
        sourceButton.createDiv({
          cls: "wiki-copilot-source-preview",
          text: chunk.text.replace(/\s+/gu, " ").slice(0, 220)
        });
      }
      this.registerDomEvent(sourceButton, "click", () => {
        void this.openCitation(source);
      });
    });
  }

  private registerCitationLinks(container: HTMLElement, sources: SourceReference[]): void {
    const byId = new Map(sources.map((source) => [source.id, source]));
    for (const link of container.querySelectorAll<HTMLAnchorElement>("a")) {
      const id = citationIdFromText(link.textContent ?? "");
      const source = id ? byId.get(id) : undefined;
      if (!id || !source) {
        continue;
      }
      link.addClass("wiki-copilot-citation");
      link.dataset.sourceId = id;
      link.dataset.sourceTitle = source.title;
      link.setAttribute("aria-label", this.plugin.t("view.openSource", { id, title: source.title }));
      this.registerDomEvent(link, "click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.highlightExpandedSource(container, source.id);
        void this.openCitation(source);
      }, { capture: true });
    }
  }

  private highlightExpandedSource(container: HTMLElement, sourceId: string): void {
    const sourceButton = findExpandedSourceButton(container, sourceId);
    if (!sourceButton) {
      return;
    }
    for (const previous of container.querySelectorAll<HTMLElement>(".wiki-copilot-source.is-citation-target")) {
      previous.removeClass("is-citation-target");
      previous.removeAttribute("aria-current");
      delete previous.dataset.highlightToken;
    }

    const highlightToken = `${Date.now()}-${sourceId}`;
    sourceButton.dataset.highlightToken = highlightToken;
    sourceButton.addClass("is-citation-target");
    sourceButton.setAttribute("aria-current", "true");
    sourceButton.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    const sourceWindow = sourceButton.ownerDocument.defaultView ?? window;
    sourceWindow.setTimeout(() => {
      if (sourceButton.dataset.highlightToken !== highlightToken) {
        return;
      }
      sourceButton.removeClass("is-citation-target");
      sourceButton.removeAttribute("aria-current");
      delete sourceButton.dataset.highlightToken;
    }, 2_200);
  }

  private async openCitation(source: SourceReference): Promise<void> {
    const { path, subpath } = parseLinktext(citationTarget(source));
    const file = this.app.metadataCache.getFirstLinkpathDest(path, "");
    if (!file) {
      new Notice(this.plugin.t("view.sourceMissing", { path: source.path }));
      return;
    }

    try {
      await this.plugin.openCitation(file, subpath, this.leaf);
    } catch (error) {
      console.error("Wiki Copilot failed to open citation", error);
      new Notice(this.plugin.t("view.sourceOpenFailed"));
    }
  }

  private appendStoppedMessage(): void {
    const keepPinned = this.isNearBottom();
    const container = this.chatEl.createDiv({ cls: "wiki-copilot-message is-status" });
    container.createDiv({ cls: "wiki-copilot-message-label", text: this.plugin.t("view.stopped") });
    container.createDiv({
      cls: "wiki-copilot-message-body",
      text: this.plugin.t("view.stoppedEmpty")
    });
    if (keepPinned) {
      this.scrollToBottom();
    }
  }

  private appendError(
    error: unknown,
    recovery?: { label: string; action: () => void }
  ): HTMLElement {
    const keepPinned = this.isNearBottom();
    const isTimeout = error instanceof AnswerTimeoutError;
    const errorMessage = localizeModelError(this.plugin.t.bind(this.plugin), error);
    const container = this.chatEl.createDiv({ cls: "wiki-copilot-message is-error", attr: { "data-error-kind": isTimeout ? "timeout" : "failed" } });
    container.createDiv({
      cls: "wiki-copilot-message-label",
      text: isTimeout ? this.plugin.t("view.timeout") : this.plugin.t("view.failed")
    });
    const body = container.createDiv({ cls: "wiki-copilot-message-body" });
    body.createDiv({ text: errorMessage });
    if (isTimeout && error.retrieval.chunks.length > 0) {
      body.createEl("p", {
        cls: "wiki-copilot-timeout-sources-note",
        text: this.plugin.t("view.timeoutSources", { count: error.retrieval.chunks.length })
      });
      this.renderSources(
        body,
        sourceReferencesFromRetrieval(error.retrieval),
        error.retrieval
      );
    }
    if (recovery) {
      const actions = body.createDiv({ cls: "wiki-copilot-error-actions" });
      const retry = actions.createEl("button", { text: recovery.label });
      this.registerDomEvent(retry, "click", recovery.action);
    }
    if (keepPinned) {
      this.scrollToBottom();
    }
    return container;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.askButton.disabled = false;
    this.askButton.setText(busy ? this.plugin.t("composer.stop") : this.plugin.t("composer.send"));
    this.askButton.setAttribute("aria-label", busy ? this.plugin.t("composer.stopAria") : this.plugin.t("composer.sendAria"));
    if (busy) {
      this.askButton.addClass("wiki-copilot-stop-button");
    } else {
      this.askButton.removeClass("wiki-copilot-stop-button");
    }
    this.queryEl.setAttribute("aria-busy", String(busy));
    syncComposerFocus(this.queryEl, busy, Platform.isMobile);
  }

  private scheduleComposerResize(): void {
    if (!Platform.isMobile || !this.queryEl || this.composerResizeFrame !== null) {
      return;
    }
    const viewWindow = this.viewWindow();
    this.composerResizeFrame = viewWindow.requestAnimationFrame(() => {
      this.composerResizeFrame = null;
      this.resizeComposerNow();
    });
  }

  private resizeComposerNow(): void {
    if (!Platform.isMobile || !this.queryEl) {
      return;
    }
    this.queryEl.setCssProps({ "--wiki-copilot-input-height": "auto" });
    this.queryEl.setCssProps({
      "--wiki-copilot-input-height": `${Math.min(120, Math.max(44, this.queryEl.scrollHeight))}px`
    });
  }

  private resetComposerHeight(): void {
    if (Platform.isMobile && this.queryEl) {
      this.queryEl.setCssProps({ "--wiki-copilot-input-height": "44px" });
    }
  }

  private cancelComposerResize(): void {
    if (this.composerResizeFrame === null) {
      return;
    }
    this.viewWindow().cancelAnimationFrame(this.composerResizeFrame);
    this.composerResizeFrame = null;
  }

  private startMobileViewportTracking(container: HTMLElement): void {
    if (!Platform.isMobile) {
      return;
    }
    const viewWindow = this.viewWindow();
    const viewport = viewWindow.visualViewport;
    const onViewportChange = (): void => this.scheduleMobileViewportSync(container);
    const onNavbarTransition = (event: Event): void => {
      const target = event.target as Partial<Element> | null;
      if (target && typeof target.closest === "function" && target.closest(".mobile-navbar")) {
        this.trackMobileNavbarAnimation(container);
      }
    };
    const observerWindow = viewWindow as Window & { MutationObserver: typeof MutationObserver };
    const bodyObserver = new observerWindow.MutationObserver(() => {
      this.trackMobileNavbarAnimation(container);
    });
    viewWindow.addEventListener("resize", onViewportChange, { passive: true });
    viewport?.addEventListener("resize", onViewportChange, { passive: true });
    viewport?.addEventListener("scroll", onViewportChange, { passive: true });
    this.containerEl.ownerDocument.addEventListener("transitionrun", onNavbarTransition, true);
    this.containerEl.ownerDocument.addEventListener("transitionend", onNavbarTransition, true);
    bodyObserver.observe(this.containerEl.ownerDocument.body, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });
    this.mobileViewportCleanup = () => {
      viewWindow.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
      this.containerEl.ownerDocument.removeEventListener("transitionrun", onNavbarTransition, true);
      this.containerEl.ownerDocument.removeEventListener("transitionend", onNavbarTransition, true);
      bodyObserver.disconnect();
    };
    this.syncMobileViewportState(container);
  }

  private scheduleMobileViewportSync(container: HTMLElement): void {
    if (!Platform.isMobile || this.mobileViewportFrame !== null) {
      return;
    }
    const viewWindow = this.viewWindow();
    this.mobileViewportFrame = viewWindow.requestAnimationFrame(() => {
      this.mobileViewportFrame = null;
      this.syncMobileViewportState(container);
      if (this.mobileNavAnimationFrames > 0) {
        this.mobileNavAnimationFrames -= 1;
        this.scheduleMobileViewportSync(container);
      }
    });
  }

  private syncMobileViewportState(container: HTMLElement): void {
    const viewWindow = this.viewWindow();
    const viewport = viewWindow.visualViewport;
    const viewportHeight = viewport?.height ?? viewWindow.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? viewWindow.innerWidth;
    const currentLayoutHeight = Math.max(
      viewportHeight + offsetTop,
      viewWindow.innerHeight,
      this.containerEl.ownerDocument.documentElement.clientHeight
    );
    const composerFocused = this.containerEl.ownerDocument.activeElement === this.queryEl;
    const widthChanged = this.mobileViewportWidth > 0 &&
      Math.abs(viewportWidth - this.mobileViewportWidth) > 48;

    if (this.mobileViewportBaselineHeight === 0 || widthChanged ||
      (!composerFocused && !this.mobileKeyboardVisible)) {
      this.mobileViewportBaselineHeight = currentLayoutHeight;
    } else {
      this.mobileViewportBaselineHeight = Math.max(
        this.mobileViewportBaselineHeight,
        currentLayoutHeight
      );
    }
    this.mobileViewportWidth = viewportWidth;

    const visible = composerFocused || nextMobileKeyboardVisible(this.mobileKeyboardVisible, {
      layoutHeight: this.mobileViewportBaselineHeight,
      viewportHeight,
      offsetTop
    });
    this.setMobileKeyboardVisible(visible);
    this.syncMobileNavbarClearance(container);
  }

  private syncMobileNavbarClearance(container: HTMLElement): void {
    const viewWindow = this.viewWindow();
    const navbar = this.containerEl.ownerDocument.querySelector<HTMLElement>(".mobile-navbar");
    if (!navbar) {
      container.style.removeProperty("--wiki-copilot-mobile-nav-clearance");
      return;
    }
    const style = viewWindow.getComputedStyle(navbar);
    const visible = style.display !== "none" && style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0.02;
    const clearance = mobileNavigationClearance(
      container.getBoundingClientRect(),
      navbar.getBoundingClientRect(),
      shouldReserveMobileNavigationClearance(this.mobileKeyboardVisible, visible)
    );
    container.style.setProperty("--wiki-copilot-mobile-nav-clearance", `${clearance}px`);
  }

  private trackMobileNavbarAnimation(container: HTMLElement): void {
    if (!Platform.isMobile) {
      return;
    }
    this.mobileNavAnimationFrames = Math.max(this.mobileNavAnimationFrames, 24);
    this.scheduleMobileViewportSync(container);
  }

  private setMobileKeyboardVisible(visible: boolean): void {
    this.mobileKeyboardVisible = visible;
  }

  private stopMobileViewportTracking(): void {
    if (this.mobileViewportFrame !== null) {
      this.viewWindow().cancelAnimationFrame(this.mobileViewportFrame);
      this.mobileViewportFrame = null;
    }
    this.mobileViewportCleanup?.();
    this.mobileViewportCleanup = null;
    this.mobileViewportBaselineHeight = 0;
    this.mobileViewportWidth = 0;
    this.mobileKeyboardVisible = false;
    this.mobileNavAnimationFrames = 0;
  }

  private scrollToBottom(): void {
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }

  private isNearBottom(): boolean {
    const distance = this.chatEl.scrollHeight - this.chatEl.scrollTop - this.chatEl.clientHeight;
    return distance <= 48;
  }

  private cancelActiveRequest(): void {
    if (!this.activeRequest || this.activeRequest.signal.aborted) {
      return;
    }
    this.activeRequest.abort();
    this.askButton.disabled = true;
    this.askButton.setText(this.plugin.t("composer.stopping"));
  }

  private ensureConversationComponent(): Component {
    if (!this.conversationComponent) {
      this.conversationComponent = this.addChild(new Component());
    }
    return this.conversationComponent;
  }

  private resetConversationComponent(): void {
    if (this.conversationComponent) {
      this.removeChild(this.conversationComponent);
    }
    this.conversationComponent = this.addChild(new Component());
  }

  private viewWindow(): Window {
    return this.containerEl.ownerDocument.defaultView ?? window;
  }

  private yieldToPaint(): Promise<void> {
    return yieldToUi(this.viewWindow());
  }

  private newConversationId(): string {
    return typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private roleLabel(role: SourceReference["role"]): string {
    const key = role === "stable-source" || role === "pending-source" ? "role.source" : `role.${role}` as const;
    return this.plugin.t(key);
  }
}
