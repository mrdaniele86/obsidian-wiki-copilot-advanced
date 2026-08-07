import { ItemView, MarkdownRenderer, Notice, parseLinktext, setIcon, WorkspaceLeaf } from "obsidian";
import { AnswerTimeoutError } from "../core/answer-error";
import {
  citationIdFromText,
  citationTarget,
  linkifyAnswerCitations
} from "../core/citations";
import { sourceReferencesFromRetrieval } from "../core/context-builder";
import type { RetrievalResult, SourceReference } from "../core/types";
import type { ChatTurn } from "../llm/openai-compatible";
import type WikiCopilotPlugin from "../main";
import type { IndexStatus } from "../obsidian/index-coordinator";
import { citationOpenState } from "./citation-open-state";
import { findExpandedSourceButton } from "./source-highlight";
import { TemporaryLeafController } from "./temporary-leaf-controller";

export const WIKI_COPILOT_VIEW_TYPE = "wiki-copilot-view";

const ROLE_LABELS: Readonly<Record<SourceReference["role"], string>> = {
  schema: "Schema",
  index: "导航",
  topic: "Topic",
  concept: "Concept",
  summary: "Summary",
  wiki: "Wiki",
  "stable-source": "稳定原文",
  "pending-source": "未验收",
  other: "普通笔记"
};

export class WikiCopilotView extends ItemView {
  private chatEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private queryEl!: HTMLTextAreaElement;
  private askButton!: HTMLButtonElement;
  private turns: ChatTurn[] = [];
  private unsubscribeStatus: (() => void) | null = null;
  private readonly citationPreview = new TemporaryLeafController<WorkspaceLeaf>();
  private requestSequence = 0;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WikiCopilotPlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return WIKI_COPILOT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Wiki Copilot";
  }

  override getIcon(): string {
    return "message-circle";
  }

  override async onOpen(): Promise<void> {
    this.renderShell();
    this.unsubscribeStatus = this.plugin.indexCoordinator.subscribe((status) => this.renderStatus(status));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      this.citationPreview.handleActiveLeafChange(leaf);
    }));
  }

  override async onClose(): Promise<void> {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    this.citationPreview.close();
    this.requestSequence += 1;
  }

  focusInput(): void {
    this.queryEl?.focus();
  }

  refreshConfigurationState(): void {
    const welcome = this.chatEl?.querySelector(".wiki-copilot-welcome");
    if (welcome) {
      welcome.remove();
      this.renderWelcome();
    }
  }

  private renderShell(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("wiki-copilot-view");

    const header = container.createDiv({ cls: "wiki-copilot-header" });
    const titleGroup = header.createDiv({ cls: "wiki-copilot-title-group" });
    titleGroup.createEl("h2", { text: "Wiki Copilot" });
    this.statusEl = titleGroup.createDiv({ cls: "wiki-copilot-status wiki-copilot-header-status" });

    const actions = header.createDiv({ cls: "wiki-copilot-header-actions" });
    const rebuild = actions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "重建知识索引" }
    });
    setIcon(rebuild, "refresh-cw");
    this.registerDomEvent(rebuild, "click", () => void this.plugin.rebuildIndex());

    const clear = actions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "新对话" }
    });
    setIcon(clear, "square-pen");
    this.registerDomEvent(clear, "click", () => this.clearConversation());

    this.chatEl = container.createDiv({ cls: "wiki-copilot-chat" });
    this.renderWelcome();

    const composer = container.createDiv({ cls: "wiki-copilot-composer" });
    this.queryEl = composer.createEl("textarea", {
      cls: "wiki-copilot-input",
      attr: {
        rows: "3",
        placeholder: "询问当前知识库…",
        "aria-label": "向 Wiki Copilot 提问"
      }
    });
    this.registerDomEvent(this.queryEl, "keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.ask();
      }
    });

    const controls = composer.createDiv({ cls: "wiki-copilot-composer-controls" });
    controls.createSpan({ cls: "wiki-copilot-shortcut", text: "Enter 发送 · Shift + Enter 换行" });
    const buttons = controls.createDiv({ cls: "wiki-copilot-composer-buttons" });
    this.askButton = buttons.createEl("button", { cls: "mod-cta", text: "发送" });
    this.registerDomEvent(this.askButton, "click", () => void this.ask());
  }

  private renderWelcome(): void {
    const welcome = this.chatEl.createDiv({ cls: "wiki-copilot-welcome" });
    const icon = welcome.createDiv({ cls: "wiki-copilot-welcome-icon" });
    setIcon(icon, "message-circle");
    welcome.createEl("h3", { text: "向 Wiki 提问" });
    welcome.createEl("p", {
      text: "输入问题，开始与你的知识库对话。"
    });
    if (!this.plugin.isModelConfigured()) {
      welcome.createEl("p", {
        cls: "wiki-copilot-callout",
        text: "模型尚未完整配置。直接提问会显示本地检索结果；配置服务商、模型和 API Key 后会自动生成回答。"
      });
    }
  }

  private renderStatus(status: IndexStatus): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.empty();
    const dot = this.statusEl.createSpan({ cls: `wiki-copilot-status-dot is-${status.state}` });
    dot.setAttribute("aria-hidden", "true");
    this.statusEl.createSpan({ text: status.state === "ready" ? "索引就绪" : status.message });
    const profile = this.plugin.indexCoordinator.profile;
    if (this.plugin.settings.retrieval.includePending) {
      this.statusEl.createSpan({ cls: "wiki-copilot-pending-chip", text: "包含未验收资料" });
    }
    if (profile && profile.warnings.length > 0) {
      const warning = this.statusEl.createEl("button", {
        cls: "clickable-icon wiki-copilot-profile-warning",
        attr: { "aria-label": profile.warnings.join(" ") }
      });
      setIcon(warning, "triangle-alert");
    }
  }

  private clearConversation(): void {
    this.requestSequence += 1;
    this.turns = [];
    this.chatEl.empty();
    this.renderWelcome();
    this.queryEl.value = "";
    this.setBusy(false);
    this.focusInput();
  }

  private async ask(): Promise<void> {
    if (this.busy) {
      new Notice("上一条问题仍在处理中。你可以先编辑下一条问题。 ");
      return;
    }
    const question = this.queryEl.value.trim();
    if (!question) {
      new Notice("请输入问题。 ");
      return;
    }
    const sequence = ++this.requestSequence;
    const history = [...this.turns];
    const useModel = this.plugin.isModelConfigured();
    this.setBusy(true);
    this.chatEl.querySelector(".wiki-copilot-welcome")?.remove();
    this.appendUserMessage(question);
    if (useModel) {
      this.turns.push({ role: "user", content: question });
    }
    this.queryEl.value = "";
    const loading = this.appendLoading("正在准备本地检索…");
    let progressText = "正在准备本地检索…";
    const startedAt = Date.now();
    const elapsedTimer = window.setInterval(() => {
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1_000));
      loading.setText(`${progressText} · ${seconds} 秒`);
    }, 1_000);
    await this.yieldToPaint();
    try {
      const updateProgress = (message: string): void => {
        if (sequence === this.requestSequence) {
          progressText = message;
          loading.setText(message);
        }
      };
      if (!useModel) {
        const result = await this.plugin.retrieve(question, history, updateProgress);
        if (sequence !== this.requestSequence) {
          return;
        }
        loading.remove();
        this.appendRetrievalResult(result);
        return;
      }

      const answer = await this.plugin.answer(question, history, updateProgress);
      if (sequence !== this.requestSequence) {
        return;
      }
      loading.remove();
      await this.appendAssistantMessage(answer.markdown, answer.sources, answer.knowledgeBaseHit);
      this.turns.push({ role: "assistant", content: answer.markdown });
    } catch (error) {
      if (sequence === this.requestSequence) {
        const lastTurn = this.turns.at(-1);
        if (lastTurn?.role === "user" && lastTurn.content === question) {
          this.turns.pop();
        }
        loading.remove();
        this.appendError(error);
      }
    } finally {
      window.clearInterval(elapsedTimer);
      if (sequence === this.requestSequence) {
        this.setBusy(false);
      }
    }
  }

  private appendUserMessage(text: string): void {
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-user" });
    message.createDiv({ cls: "wiki-copilot-message-label", text: "你" });
    message.createDiv({ cls: "wiki-copilot-message-body", text });
    this.scrollToBottom();
  }

  private appendLoading(text: string): { remove: () => void; setText: (value: string) => void } {
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant wiki-copilot-loading" });
    message.createDiv({ cls: "wiki-copilot-message-label", text: "Wiki Copilot" });
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
    const keepPinned = this.isNearBottom();
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant" });
    const label = message.createDiv({ cls: "wiki-copilot-message-label", text: "Wiki Copilot" });
    if (!knowledgeBaseHit) {
      label.createSpan({
        cls: "wiki-copilot-general-answer-badge",
        text: " · 通用回答",
        attr: { title: "未命中当前知识库，此回答来自模型通用知识" }
      });
    }
    const body = message.createDiv({ cls: "wiki-copilot-message-body markdown-rendered" });
    await MarkdownRenderer.render(this.app, linkifyAnswerCitations(markdown, sources), body, "", this);
    this.registerCitationLinks(body, sources);
    this.renderSources(body, sources);
    if (keepPinned) {
      this.scrollToBottom();
    }
  }

  private appendRetrievalResult(result: RetrievalResult): void {
    const keepPinned = this.isNearBottom();
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant" });
    message.createDiv({ cls: "wiki-copilot-message-label", text: "本地检索" });
    const body = message.createDiv({ cls: "wiki-copilot-message-body" });
    if (result.chunks.length === 0) {
      body.setText("没有找到可用片段。可尝试更具体的术语，或检查 Vault 中是否存在 Wiki 知识层。 ");
      if (keepPinned) {
        this.scrollToBottom();
      }
      return;
    }
    body.createEl("p", {
      text: `选出 ${result.chunks.length} 个上下文片段（候选 ${result.totalCandidates} 个${result.truncated ? "，受上下文上限截断" : ""}）。`
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
    const hasPending = sources.some((source) => source.evidenceTier === "unverified");
    if (hasPending) {
      container.createDiv({
        cls: "wiki-copilot-unverified-warning",
        text: "此结果包含 pending / 未验收资料，相关结论不能视为稳定事实。"
      });
    }
    const details = container.createEl("details", { cls: "wiki-copilot-sources" });
    details.createEl("summary", { text: `来源与检索依据（${sources.length}）` });
    const list = details.createDiv({ cls: "wiki-copilot-source-list" });

    sources.forEach((source, index) => {
      const sourceButton = list.createEl("button", {
        cls: "wiki-copilot-source",
        attr: { "data-source-id": source.id }
      });
      const top = sourceButton.createDiv({ cls: "wiki-copilot-source-top" });
      top.createSpan({ cls: "wiki-copilot-source-id", text: `[${source.id}]` });
      top.createSpan({ cls: `wiki-copilot-role is-${source.role}`, text: ROLE_LABELS[source.role] });
      if (source.origin === "wikilink") {
        top.createSpan({ cls: "wiki-copilot-origin", text: "Wikilink" });
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
      link.setAttribute("aria-label", `打开来源 ${id}：${source.title}`);
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
    window.setTimeout(() => {
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
      new Notice(`找不到引用文档：${source.path}`);
      return;
    }

    const previewLeaf = this.app.workspace.getLeaf("tab");
    this.citationPreview.track(previewLeaf);
    try {
      await previewLeaf.openFile(file, citationOpenState(subpath));
    } catch (error) {
      this.citationPreview.close();
      console.error("Wiki Copilot failed to open citation", error);
      new Notice("无法打开引用文档。");
    }
  }

  private appendError(error: unknown): void {
    const keepPinned = this.isNearBottom();
    const isTimeout = error instanceof AnswerTimeoutError;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const container = this.chatEl.createDiv({ cls: "wiki-copilot-message is-error" });
    container.createDiv({
      cls: "wiki-copilot-message-label",
      text: isTimeout ? "回答超时" : "无法完成"
    });
    const body = container.createDiv({ cls: "wiki-copilot-message-body" });
    body.createDiv({ text: errorMessage });
    if (isTimeout && error.retrieval.chunks.length > 0) {
      body.createEl("p", {
        cls: "wiki-copilot-timeout-sources-note",
        text: `本次检索到的 ${error.retrieval.chunks.length} 个知识页面已保留，可展开查看。`
      });
      this.renderSources(
        body,
        sourceReferencesFromRetrieval(error.retrieval),
        error.retrieval
      );
    }
    if (keepPinned) {
      this.scrollToBottom();
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.askButton.disabled = busy;
    this.askButton.setText(busy ? "处理中…" : "发送");
    this.queryEl.setAttribute("aria-busy", String(busy));
    if (!busy) {
      this.focusInput();
    }
  }

  private scrollToBottom(): void {
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }

  private isNearBottom(): boolean {
    const distance = this.chatEl.scrollHeight - this.chatEl.scrollTop - this.chatEl.clientHeight;
    return distance <= 48;
  }

  private yieldToPaint(): Promise<void> {
    return new Promise((resolve) => window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    }));
  }
}
