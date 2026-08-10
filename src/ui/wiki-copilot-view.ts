import {
  Component,
  ItemView,
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
import type { ChatTurn } from "../core/types";
import type { ModelResponseMode } from "../llm/openai-compatible";
import { RequestCancelledError } from "../llm/request-timeout";
import type WikiCopilotPlugin from "../main";
import type { IndexStatus } from "../obsidian/index-coordinator";
import {
  mobileNavigationClearance,
  nextMobileKeyboardVisible,
  shouldDismissMobileKeyboardFromChat,
  syncComposerFocus
} from "./composer-focus";
import { findExpandedSourceButton } from "./source-highlight";
import { StreamingMarkdownRenderer } from "./streaming-markdown-renderer";

export const WIKI_COPILOT_VIEW_TYPE = "wiki-copilot-view";

const ROLE_LABELS: Readonly<Record<SourceReference["role"], string>> = {
  schema: "Schema",
  index: "导航",
  topic: "Topic",
  concept: "Concept",
  summary: "Summary",
  wiki: "Wiki",
  "stable-source": "原文",
  "pending-source": "原文",
  other: "普通笔记"
};

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
  private turns: ChatTurn[] = [];
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

  refreshConfigurationState(): void {
    const welcome = this.chatEl?.querySelector(".wiki-copilot-welcome");
    if (welcome) {
      welcome.remove();
      this.renderWelcome();
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
        placeholder: "询问当前知识库…"
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
    controls.createSpan({ cls: "wiki-copilot-shortcut", text: "Enter 发送 · Shift + Enter 换行" });
    const buttons = controls.createDiv({ cls: "wiki-copilot-composer-buttons" });
    this.askButton = buttons.createEl("button", { cls: "mod-cta", text: "发送" });
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
    if (profile && profile.warnings.length > 0) {
      const warning = this.statusEl.createEl("button", {
        cls: "clickable-icon wiki-copilot-profile-warning",
        attr: { "aria-label": profile.warnings.join(" ") }
      });
      setIcon(warning, "triangle-alert");
    }
  }

  private clearConversation(): void {
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.requestSequence += 1;
    this.turns = [];
    this.resetConversationComponent();
    this.chatEl.empty();
    this.renderWelcome();
    this.queryEl.value = "";
    this.resetComposerHeight();
    this.setBusy(false);
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
    const loading = this.appendLoading("正在准备本地检索…");
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
              ? "正在连接模型…"
              : "正在等待模型回答…");
          }
        },
        onModelActivity: (activity) => {
          if (sequence !== this.requestSequence) {
            return;
          }
          if (activity === "response-headers") {
            updateProgress(activeResponseMode === "stream"
              ? "模型已连接，等待回答…"
              : "模型已响应，正在读取回答…");
          } else {
            updateProgress("正在接收回答…");
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
              "回答已停止；部分内容未加入会话上下文。"
            );
          } else {
            this.appendStoppedMessage();
          }
        } else if (streamState.message && streamState.markdown) {
          await streamState.message.interrupt(
            streamState.markdown,
            sources,
            `回答中断：${error instanceof Error ? error.message : String(error)} 部分内容未加入会话上下文。`
          );
        } else if (error instanceof StreamFallbackRequiredError) {
          let errorContainer: HTMLElement | null = null;
          errorContainer = this.appendError(error, {
            label: "使用兼容模式重试",
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
    const message = this.appendStreamingAssistantMessage(knowledgeBaseHit);
    await message.finish(markdown, sources);
  }

  private appendStreamingAssistantMessage(knowledgeBaseHit: boolean): AssistantMessageHandle {
    const initiallyPinned = this.isNearBottom();
    const message = this.chatEl.createDiv({ cls: "wiki-copilot-message is-assistant" });
    message.addClass("is-streaming");
    const label = message.createDiv({ cls: "wiki-copilot-message-label", text: "Wiki Copilot" });
    if (!knowledgeBaseHit) {
      label.createSpan({
        cls: "wiki-copilot-general-answer-badge",
        text: " · 通用回答",
        attr: { title: "未命中当前知识库，此回答来自模型通用知识" }
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
      new Notice(`找不到引用文档：${source.path}`);
      return;
    }

    try {
      await this.plugin.openCitation(file, subpath);
    } catch (error) {
      console.error("Wiki Copilot failed to open citation", error);
      new Notice("无法打开引用文档。");
    }
  }

  private appendStoppedMessage(): void {
    const keepPinned = this.isNearBottom();
    const container = this.chatEl.createDiv({ cls: "wiki-copilot-message is-status" });
    container.createDiv({ cls: "wiki-copilot-message-label", text: "已停止" });
    container.createDiv({
      cls: "wiki-copilot-message-body",
      text: "回答已停止，未生成可加入会话上下文的内容。"
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
    this.askButton.setText(busy ? "停止" : "发送");
    this.askButton.setAttribute("aria-label", busy ? "停止当前回答" : "发送问题");
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
      visible
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
    this.askButton.setText("正在停止…");
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
}
