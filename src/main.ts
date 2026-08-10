import { normalizePath, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { AnswerTimeoutError, answerTimeoutMessage } from "./core/answer-error";
import { validateAnswerCitations } from "./core/citations";
import { buildAnswerContext } from "./core/context-builder";
import type {
  AnswerResult,
  AnswerRetrievalMetrics,
  ChatTurn,
  RetrievalResult,
  SourceReference
} from "./core/types";
import {
  discardUnanchoredTechnicalResult,
  exactIdentifierMissingMessage,
  hasTechnicalIdentifierAnchor,
  retrievalQueryForQuestion
} from "./core/retrieval-query";
import { technicalIdentifierTokens } from "./core/tokenizer";
import { OpenAICompatibleClient } from "./llm/openai-compatible";
import type {
  ActiveCompletionMode,
  CompletionActivity,
  ModelResponseMode
} from "./llm/openai-compatible";
import {
  modelTimeoutMsForRange,
  RequestCancelledError,
  RequestTimeoutError,
  withAbortSignal
} from "./llm/request-timeout";
import {
  FIXED_API_KEY_ID,
  providerLabel,
  providerRequiresApiKey
} from "./model-presets";
import { IndexCoordinator } from "./obsidian/index-coordinator";
import {
  AdapterIndexCacheRepository,
  IndexedDbIndexCacheRepository
} from "./obsidian/index-cache";
import type { IndexCacheRepository } from "./obsidian/index-cache";
import {
  DEFAULT_SETTINGS,
  legacyApiKeySecretName,
  loadWikiCopilotSettings,
  WikiCopilotSettingTab
} from "./settings";
import type { WikiCopilotSettings } from "./settings";
import { citationOpenState } from "./ui/citation-open-state";
import { ReusableLeafController } from "./ui/temporary-leaf-controller";
import { planMobileRootView } from "./ui/view-leaf-placement";
import { WikiCopilotView, WIKI_COPILOT_VIEW_TYPE } from "./ui/wiki-copilot-view";

const RETRIEVAL_PLANNER_TIMEOUT_MS = 15_000;

export interface AnswerOptions {
  signal?: AbortSignal;
  responseMode?: ModelResponseMode;
  onProgress?: (message: string) => void;
  onDelta?: (delta: string) => void;
  onRetrieved?: (
    sources: SourceReference[],
    knowledgeBaseHit: boolean,
    metrics: AnswerRetrievalMetrics
  ) => void;
  onResponseMode?: (mode: ActiveCompletionMode, detail?: string) => void;
  onModelActivity?: (activity: CompletionActivity) => void;
}

export default class WikiCopilotPlugin extends Plugin {
  override settings: WikiCopilotSettings = DEFAULT_SETTINGS;
  indexCoordinator!: IndexCoordinator;

  private llmClient!: OpenAICompatibleClient;
  private manualRebuildPromise: Promise<void> | null = null;
  private readonly citationPreview = new ReusableLeafController<WorkspaceLeaf>();
  private citationOpenQueue: Promise<void> = Promise.resolve();

  override async onload(): Promise<void> {
    const savedData: unknown = await this.loadData();
    this.settings = loadWikiCopilotSettings(savedData);
    await this.migrateLegacyApiKey(savedData);
    let cacheRepository: IndexCacheRepository | null = null;
    if (Platform.isMobile) {
      if (typeof window.indexedDB !== "undefined") {
        cacheRepository = new IndexedDbIndexCacheRepository(
          window.indexedDB,
          `${this.manifest.id}:${this.app.vault.getName()}`
        );
      } else {
        console.warn("Wiki Copilot: 当前移动端环境不支持设备本地索引缓存。");
      }
    } else if (this.manifest.dir) {
      cacheRepository = new AdapterIndexCacheRepository(
        this.app.vault.adapter,
        normalizePath(`${this.manifest.dir}/index-cache.json`)
      );
    }
    this.indexCoordinator = new IndexCoordinator(
      this.app.vault,
      this.app.metadataCache,
      () => this.settings,
      cacheRepository,
      { lowMemory: Platform.isMobile }
    );
    this.llmClient = new OpenAICompatibleClient(() => this.getApiKey());

    this.registerView(
      WIKI_COPILOT_VIEW_TYPE,
      (leaf) => new WikiCopilotView(leaf, this)
    );
    this.addRibbonIcon("message-circle", "打开 Wiki Copilot", () => void this.activateView());
    this.addSettingTab(new WikiCopilotSettingTab(this.app, this));

    this.addCommand({
      id: "open-chat",
      name: "打开问答侧栏",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "rebuild-knowledge-index",
      name: "重建知识索引",
      callback: () => void this.rebuildIndex()
    });
    this.addCommand({
      id: "show-detected-profile",
      name: "显示识别到的知识库结构",
      callback: () => this.showProfileNotice()
    });
    this.addCommand({
      id: "show-index-diagnostics",
      name: "显示知识索引诊断",
      callback: () => this.showIndexDiagnostics()
    });

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      this.indexCoordinator.scheduleFileUpdate(file);
    }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.indexCoordinator.rebuildGraph();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension.toLocaleLowerCase() === "md") {
        this.indexCoordinator.scheduleFileUpdate(file);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension.toLocaleLowerCase() === "md") {
        this.indexCoordinator.scheduleFileUpdate(null, file.path);
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension.toLocaleLowerCase() === "md") {
        this.indexCoordinator.scheduleFileUpdate(file, oldPath);
      }
    }));

    this.app.workspace.onLayoutReady(() => {
      void this.indexCoordinator.initialize().catch((error) => {
        console.error("Wiki Copilot: 初始化知识索引失败。", error);
      });
      if (
        Platform.isMobile &&
        this.app.workspace.getActiveViewOfType(WikiCopilotView) !== null
      ) {
        void this.activateView();
      }
    });
  }

  override onunload(): void {
    this.citationPreview.close();
    this.indexCoordinator.destroy();
  }

  openCitation(file: TFile, subpath?: string): Promise<void> {
    const operation = this.citationOpenQueue.then(() => this.openCitationNow(file, subpath));
    this.citationOpenQueue = operation.catch(() => undefined);
    return operation;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshOpenViews();
  }

  private async openCitationNow(file: TFile, subpath?: string): Promise<void> {
    const { leaf, created } = this.citationPreview.acquire(
      () => this.app.workspace.getLeaf("tab"),
      (candidate) => this.isAttachedLeaf(candidate)
    );

    try {
      await leaf.openFile(file, citationOpenState(subpath));
    } catch (error) {
      if (created) {
        this.citationPreview.discard(leaf);
      }
      throw error;
    }
  }

  private isAttachedLeaf(candidate: WorkspaceLeaf): boolean {
    let attached = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf === candidate) {
        attached = true;
      }
    });
    return attached;
  }

  isModelConfigured(): boolean {
    if (!this.llmClient.isConfigured(this.settings.model)) {
      return false;
    }
    return !providerRequiresApiKey(this.settings.model.provider) || Boolean(this.getApiKey()?.trim());
  }

  getApiKey(): string | null {
    return this.app.secretStorage.getSecret(FIXED_API_KEY_ID);
  }

  async setApiKey(value: string): Promise<void> {
    this.app.secretStorage.setSecret(FIXED_API_KEY_ID, value.trim());
    this.refreshOpenViews();
  }

  async rebuildIndex(): Promise<void> {
    if (this.manualRebuildPromise) {
      return;
    }
    const operation = this.indexCoordinator.forceRebuild();
    this.manualRebuildPromise = operation;
    try {
      await operation;
      new Notice("Wiki Copilot 索引已重建。 ");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Wiki Copilot 索引失败：${message}`);
    } finally {
      if (this.manualRebuildPromise === operation) {
        this.manualRebuildPromise = null;
      }
    }
  }

  async retrieve(
    question: string,
    history: ChatTurn[] = [],
    onProgress?: (message: string) => void,
    signal?: AbortSignal
  ): Promise<RetrievalResult> {
    const reportProgress = (message: string): void => {
      if (!signal?.aborted) {
        onProgress?.(message);
      }
    };
    if (this.indexCoordinator.currentStatus.state !== "ready") {
      reportProgress("正在准备本地知识索引…");
    }
    await withAbortSignal(this.indexCoordinator.ensureReady(), signal);
    const retrievalQuery = retrievalQueryForQuestion(question, history);
    const precise = this.settings.retrievalMode === "precise";
    let searchQueries = [retrievalQuery];
    if (this.isModelConfigured()) {
      reportProgress("正在生成检索关键词…");
      try {
        searchQueries = await this.llmClient.planRetrievalQueries(
          retrievalQuery,
          this.settings.model,
          RETRIEVAL_PLANNER_TIMEOUT_MS,
          {
            signal,
            mode: this.settings.retrievalMode,
            history,
            question
          }
        );
      } catch (error) {
        if (error instanceof RequestCancelledError) {
          throw error;
        }
        console.warn("Wiki Copilot: 检索关键词规划不可用，继续使用原始问题。", error);
      }
    }
    if (precise) {
      reportProgress("正在核对候选资料…");
    }
    const activePath = this.settings.prioritizeActiveNote
      ? this.app.workspace.getActiveFile()?.path
      : undefined;
    const runRetrieval = (): Promise<RetrievalResult> =>
      precise
        ? this.indexCoordinator.retrieveAllMarkdown(
          retrievalQuery,
          searchQueries,
          { ...this.settings.retrieval, activePath },
          reportProgress,
          signal
        )
        : this.indexCoordinator.retriever.retrievePlannedQueries(
          retrievalQuery,
          searchQueries,
          { ...this.settings.retrieval, activePath },
          reportProgress
        );

    const hasExactIdentifiers = technicalIdentifierTokens(retrievalQuery).length > 0;
    let identifierRepairAttempted = false;
    if (!precise && Platform.isMobile && hasExactIdentifiers) {
      reportProgress("正在校验本机精确标识符索引…");
      await withAbortSignal(
        this.indexCoordinator.repairTechnicalIdentifierCoverage(retrievalQuery),
        signal
      );
      identifierRepairAttempted = true;
    }

    let result = await withAbortSignal(
      runRetrieval(),
      signal
    );
    if (!precise && !identifierRepairAttempted && !hasTechnicalIdentifierAnchor(retrievalQuery, result)) {
      reportProgress("正在校验本机精确标识符索引…");
      const repaired = await withAbortSignal(
        this.indexCoordinator.repairTechnicalIdentifierCoverage(retrievalQuery),
        signal
      );
      if (repaired > 0) {
        reportProgress(`已补齐 ${repaired} 个标识符索引条目，正在重新检索…`);
        result = await withAbortSignal(
          runRetrieval(),
          signal
        );
      }
    }
    let guardedResult = discardUnanchoredTechnicalResult(retrievalQuery, result);
    if (!precise && Platform.isMobile && guardedResult.chunks.length === 0) {
      reportProgress("正在直接检查本机知识文件…");
      const repaired = await withAbortSignal(
        this.indexCoordinator.repairLexicalCoverage(searchQueries.join(" ")),
        signal
      );
      if (repaired > 0) {
        reportProgress(`已补齐 ${repaired} 个查询相关索引条目，正在重新检索…`);
        result = await withAbortSignal(
          runRetrieval(),
          signal
        );
        guardedResult = discardUnanchoredTechnicalResult(retrievalQuery, result);
      }
    }
    return guardedResult;
  }

  async answer(
    question: string,
    history: ChatTurn[],
    options: AnswerOptions = {}
  ): Promise<AnswerResult> {
    if (options.signal?.aborted) {
      throw new RequestCancelledError();
    }
    const retrieval = await this.retrieve(
      question,
      history,
      options.onProgress,
      options.signal
    );
    if (options.signal?.aborted) {
      throw new RequestCancelledError();
    }
    const knowledgeBaseHit = retrieval.chunks.length > 0;
    const context = buildAnswerContext(retrieval);
    options.onRetrieved?.(context.sources, knowledgeBaseHit, {
      contextCharacters: context.context.length,
      sourceCount: context.sources.length
    });
    const missingExactIdentifier = knowledgeBaseHit
      ? null
      : exactIdentifierMissingMessage(retrieval.query);
    if (missingExactIdentifier) {
      options.onProgress?.("未找到精确标识符依据");
      return {
        markdown: missingExactIdentifier,
        sources: [],
        knowledgeBaseHit: false
      };
    }
    const modelServiceName = providerLabel(
      this.settings.model.provider,
      this.settings.model.serviceName
    );
    options.onProgress?.(knowledgeBaseHit
      ? `已检索 ${retrieval.chunks.length} 个知识页面，${modelServiceName}思考中…`
      : `未命中当前知识库，${modelServiceName}思考中…`);
    const retrievalRange = this.settings.retrievalRange;
    const retrievalMode = this.settings.retrievalMode;
    const timeoutMilliseconds = modelTimeoutMsForRange(retrievalRange);
    let rawMarkdown: string;
    try {
      rawMarkdown = await this.llmClient.answer(
        question,
        context,
        history,
        this.indexCoordinator.queryGuidance,
        this.settings.model,
        timeoutMilliseconds,
        {
          signal: options.signal,
          responseMode: options.responseMode,
          onDelta: options.onDelta,
          onActivity: options.onModelActivity,
          onResponseMode: (mode, detail) => {
            options.onResponseMode?.(mode, detail);
            if (detail) {
              options.onProgress?.(detail);
            } else if (mode === "non-stream") {
              options.onProgress?.(`${modelServiceName}思考中（兼容模式）…`);
            }
          }
        }
      );
    } catch (error) {
      if (error instanceof RequestTimeoutError) {
        throw new AnswerTimeoutError(
          answerTimeoutMessage(modelServiceName, error.milliseconds, retrievalMode),
          retrieval
        );
      }
      throw error;
    }
    const citationCheck = validateAnswerCitations(rawMarkdown, context.sources);
    return { markdown: citationCheck.markdown, sources: context.sources, knowledgeBaseHit };
  }

  async activateView(): Promise<void> {
    const existingLeaves = this.app.workspace.getLeavesOfType(WIKI_COPILOT_VIEW_TYPE);
    let leaf: WorkspaceLeaf;
    if (Platform.isMobile) {
      const rootLeaves: WorkspaceLeaf[] = [];
      this.app.workspace.iterateRootLeaves((candidate) => rootLeaves.push(candidate));
      const plan = planMobileRootView(rootLeaves, existingLeaves);
      for (const drawerLeaf of plan.drawerLeaves) {
        drawerLeaf.detach();
      }
      leaf = plan.reusable ?? this.app.workspace.getLeaf("tab");
      if (!plan.reusable) {
        await leaf.setViewState({ type: WIKI_COPILOT_VIEW_TYPE, active: true });
      }
    } else if (existingLeaves[0]) {
      leaf = existingLeaves[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: WIKI_COPILOT_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!Platform.isMobile && leaf.view instanceof WikiCopilotView) {
      leaf.view.focusInput();
    }
  }

  private showProfileNotice(): void {
    const profile = this.indexCoordinator.profile;
    if (!profile) {
      new Notice("知识库结构尚未识别完成。 ");
      return;
    }
    const sourceRoots = [...new Set([
      ...profile.stableSourceRoots,
      ...profile.pendingSourceRoots
    ])];
    new Notice([
      `Schema: ${profile.schemaFiles.join(", ") || "未识别"}`,
      `Index: ${profile.indexFiles.join(", ") || "未识别"}`,
      `Wiki: ${profile.wikiRoots.join(", ") || "未识别"}`,
      `Sources: ${sourceRoots.join(", ") || "未识别"}`
    ].join("\n"), 10_000);
  }

  private showIndexDiagnostics(): void {
    const activePath = this.app.workspace.getActiveFile()?.path;
    const diagnostics = this.indexCoordinator.getDiagnostics(activePath);
    const cacheLabel = diagnostics.cacheScope === "device"
      ? "设备本地 IndexedDB"
      : diagnostics.cacheScope === "vault"
        ? "Vault 插件目录"
        : "未启用";
    const activeLine = diagnostics.activePath
      ? `当前笔记：${diagnostics.activePath.indexed ? "已索引" : "未索引"} · ${diagnostics.activePath.role} · ${diagnostics.activePath.chunks} 片段`
      : "当前笔记：未打开 Markdown";
    new Notice([
      diagnostics.status.message,
      `缓存：${cacheLabel}`,
      `Obsidian 当前可见：${diagnostics.visibleMarkdownFiles} 个 Markdown`,
      `索引跟踪：${diagnostics.trackedMarkdownFiles} 个 Markdown`,
      `Wiki：${diagnostics.wikiFiles} 页 / ${diagnostics.wikiChunks} 片段`,
      `原文目录：${diagnostics.sourceFiles} 页`,
      activeLine,
      diagnostics.pendingUpdates > 0 ? `等待增量更新：${diagnostics.pendingUpdates} 项` : "增量更新：无积压"
    ].join("\n"), 15_000);
  }

  private async migrateLegacyApiKey(savedData: unknown): Promise<void> {
    const legacyName = legacyApiKeySecretName(savedData);
    if (!legacyName) {
      return;
    }
    if (!this.app.secretStorage.getSecret(FIXED_API_KEY_ID)) {
      const legacyValue = this.app.secretStorage.getSecret(legacyName);
      if (legacyValue) {
        this.app.secretStorage.setSecret(FIXED_API_KEY_ID, legacyValue);
      }
    }
    await this.saveData(this.settings);
  }

  private refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(WIKI_COPILOT_VIEW_TYPE)) {
      if (leaf.view instanceof WikiCopilotView) {
        leaf.view.refreshConfigurationState();
      }
    }
  }
}
