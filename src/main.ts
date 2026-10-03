import { MarkdownView, normalizePath, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { AnswerTimeoutError, answerTimeoutDetails } from "./core/answer-error";
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
  ModelCompletionWarning,
  ModelResponseDetail,
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
import { createTranslator, resolveUiLanguage } from "./i18n";
import type { TranslationKey, TranslationVariables } from "./i18n";
import { ReusableLeafController } from "./ui/temporary-leaf-controller";
import { planMobileRootView } from "./ui/view-leaf-placement";
import { ConversationStore } from "./chat/conversation-store";
import { WikiCopilotView, WIKI_COPILOT_VIEW_TYPE } from "./ui/wiki-copilot-view";
import type { IndexStatus } from "./obsidian/index-coordinator";
import type { RetrievalProgressStage } from "./core/retrieval-progress";
import { WebSearchService } from "./web-search/web-search-service";
import type { WebSearchHistoryTurn, WebSearchResult } from "./web-search/types";
import { SessionWebSearchConsent } from "./web-search/session-consent";

const RETRIEVAL_PLANNER_TIMEOUT_MS = 15_000;
export const WEB_SEARCH_API_KEY_ID = "wiki-copilot-advanced-web-search-api-key";

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
  onResponseMode?: (mode: ActiveCompletionMode, detail?: ModelResponseDetail) => void;
  onModelActivity?: (activity: CompletionActivity) => void;
  onModelWarning?: (warning: ModelCompletionWarning) => void;
}

export default class WikiCopilotPlugin extends Plugin {
  override settings: WikiCopilotSettings = DEFAULT_SETTINGS;
  indexCoordinator!: IndexCoordinator;
  conversations!: ConversationStore;
  readonly webSearchConsent = new SessionWebSearchConsent();

  private llmClient!: OpenAICompatibleClient;
  private manualRebuildPromise: Promise<void> | null = null;
  private readonly citationPreview = new ReusableLeafController<WorkspaceLeaf>();
  private citationOpenQueue: Promise<void> = Promise.resolve();
  private citationReturnAction: HTMLElement | null = null;

  t(key: TranslationKey, variables?: TranslationVariables): string {
    return createTranslator(resolveUiLanguage(this.settings.language, window.navigator.language))(key, variables);
  }

  localizedIndexStatus(status: IndexStatus): string {
    if (status.state === "ready") return this.t("view.ready");
    if (status.state === "building") return this.t("main.index.building");
    if (status.state === "error") return this.t("main.index.error");
    return this.t("main.index.idle");
  }

  private localizeRetrievalProgress(stage: RetrievalProgressStage): string {
    const keys: Readonly<Record<RetrievalProgressStage, TranslationKey>> = {
      fast: "main.progress.fast",
      enumerating: "main.progress.enumerating",
      scanning: "main.progress.scanning",
      extracting: "main.progress.extracting"
    };
    return this.t(keys[stage]);
  }

  private localizeModelResponseDetail(detail: ModelResponseDetail): string {
    const keys: Readonly<Record<ModelResponseDetail, TranslationKey>> = {
      "streaming-unavailable": "view.model.streamingUnavailable",
      "streaming-unsupported": "view.model.streamingUnsupported",
      "complete-response": "view.model.completeResponse"
    };
    return this.t(keys[detail]);
  }

  private localizeModelWarning(warning: ModelCompletionWarning): string {
    const keys: Readonly<Record<ModelCompletionWarning, TranslationKey>> = {
      length: "view.model.lengthWarning",
      "content-filter": "view.model.contentFilterWarning"
    };
    return this.t(keys[warning]);
  }

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
    this.conversations = new ConversationStore(this.app.vault);
    this.llmClient = new OpenAICompatibleClient(() => this.getApiKey());

    this.registerView(
      WIKI_COPILOT_VIEW_TYPE,
      (leaf) => new WikiCopilotView(leaf, this)
    );
    this.addRibbonIcon("message-circle", this.t("command.open"), () => void this.activateView());
    this.addSettingTab(new WikiCopilotSettingTab(this.app, this));

    this.addCommand({
      id: "open-chat",
      name: this.t("command.open"),
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "rebuild-knowledge-index",
      name: this.t("command.rebuild"),
      callback: () => void this.rebuildIndex()
    });
    this.addCommand({
      id: "show-detected-profile",
      name: this.t("command.profile"),
      callback: () => this.showProfileNotice()
    });
    this.addCommand({
      id: "show-index-diagnostics",
      name: this.t("command.diagnostics"),
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

  openCitation(file: TFile, subpath?: string, originLeaf?: WorkspaceLeaf): Promise<void> {
    const operation = this.citationOpenQueue.then(() => this.openCitationNow(file, subpath, originLeaf));
    this.citationOpenQueue = operation.catch(() => undefined);
    return operation;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshOpenViews();
  }

  private async openCitationNow(
    file: TFile,
    subpath?: string,
    originLeaf?: WorkspaceLeaf
  ): Promise<void> {
    const { leaf, created } = this.citationPreview.acquire(
      () => this.app.workspace.getLeaf("tab"),
      (candidate) => this.isReusableCitationPreviewLeaf(candidate),
      originLeaf
    );

    try {
      await leaf.openFile(file, citationOpenState(subpath));
      this.installCitationReturnAction(leaf);
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

  private isReusableCitationPreviewLeaf(candidate: WorkspaceLeaf): boolean {
    return this.isAttachedLeaf(candidate)
      && candidate.view.getViewType() !== WIKI_COPILOT_VIEW_TYPE;
  }

  private installCitationReturnAction(previewLeaf: WorkspaceLeaf): void {
    this.citationReturnAction?.remove();
    this.citationReturnAction = null;
    if (!(previewLeaf.view instanceof MarkdownView)) {
      return;
    }

    const action = previewLeaf.view.addAction(
      "message-circle",
      this.t("view.returnToChat"),
      () => this.returnToCitationOrigin(previewLeaf)
    );
    action.addClass("wiki-copilot-citation-return");
    this.citationReturnAction = action;
  }

  private returnToCitationOrigin(previewLeaf: WorkspaceLeaf): void {
    const originLeaf = this.citationPreview.originFor(
      previewLeaf,
      (candidate) => this.isAttachedLeaf(candidate)
    );
    if (!originLeaf || !(originLeaf.view instanceof WikiCopilotView)) {
      new Notice(this.t("view.returnToChatUnavailable"));
      return;
    }
    void this.app.workspace.revealLeaf(originLeaf);
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

  getWebSearchApiKey(): string | null {
    return this.app.secretStorage.getSecret(WEB_SEARCH_API_KEY_ID);
  }

  async setWebSearchApiKey(value: string): Promise<void> {
    this.app.secretStorage.setSecret(WEB_SEARCH_API_KEY_ID, value.trim());
    this.refreshOpenViews();
  }

  async searchWeb(question: string, history?: WebSearchHistoryTurn[]): Promise<WebSearchResult> {
    const apiKey = this.getWebSearchApiKey() ?? "";
    const service = new WebSearchService({
      settings: this.settings.webSearch,
      apiKey
    });
    return service.search({
      question,
      model: this.settings.webSearch.geminiModel,
      apiKey,
      ...(history?.length ? { history } : {})
    });
  }

  async rebuildIndex(): Promise<void> {
    if (this.manualRebuildPromise) {
      return;
    }
    const operation = this.indexCoordinator.forceRebuild();
    this.manualRebuildPromise = operation;
    try {
      await operation;
      new Notice(this.t("main.index.rebuilt"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(this.t("main.index.failed", { message }));
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
    const reportRetrievalProgress = (stage: RetrievalProgressStage): void => {
      reportProgress(this.localizeRetrievalProgress(stage));
    };
    if (this.indexCoordinator.currentStatus.state !== "ready") {
      reportProgress(this.t("main.progress.preparing"));
    }
    await withAbortSignal(this.indexCoordinator.ensureReady(), signal);
    const retrievalQuery = retrievalQueryForQuestion(question, history);
    const precise = this.settings.retrievalMode === "precise";
    let searchQueries = [retrievalQuery];
    if (this.isModelConfigured()) {
      reportProgress(this.t("main.progress.planning"));
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
      reportProgress(this.t("main.progress.checking"));
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
          reportRetrievalProgress,
          signal
        )
        : this.indexCoordinator.retriever.retrievePlannedQueries(
          retrievalQuery,
          searchQueries,
          { ...this.settings.retrieval, activePath },
          reportRetrievalProgress
        );

    const hasExactIdentifiers = technicalIdentifierTokens(retrievalQuery).length > 0;
    let identifierRepairAttempted = false;
    if (!precise && Platform.isMobile && hasExactIdentifiers) {
      reportProgress(this.t("main.progress.identifier"));
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
      reportProgress(this.t("main.progress.identifier"));
      const repaired = await withAbortSignal(
        this.indexCoordinator.repairTechnicalIdentifierCoverage(retrievalQuery),
        signal
      );
      if (repaired > 0) {
        reportProgress(this.t("main.progress.identifierRepaired", { count: repaired }));
        result = await withAbortSignal(
          runRetrieval(),
          signal
        );
      }
    }
    let guardedResult = discardUnanchoredTechnicalResult(retrievalQuery, result);
    if (!precise && Platform.isMobile && guardedResult.chunks.length === 0) {
      reportProgress(this.t("main.progress.files"));
      const repaired = await withAbortSignal(
        this.indexCoordinator.repairLexicalCoverage(searchQueries.join(" ")),
        signal
      );
      if (repaired > 0) {
        reportProgress(this.t("main.progress.filesRepaired", { count: repaired }));
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
      options.onProgress?.(this.t("main.progress.missingIdentifier"));
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
      ? this.t("main.progress.hit", { count: retrieval.chunks.length, service: modelServiceName })
      : this.t("main.progress.miss", { service: modelServiceName }));
    const retrievalRange = this.settings.retrievalRange;
    const retrievalMode = this.settings.retrievalMode;
    const timeoutMilliseconds = modelTimeoutMsForRange(retrievalRange);
    let rawMarkdown: string;
    const modelWarnings: string[] = [];
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
          onWarning: (warning) => {
            modelWarnings.push(this.localizeModelWarning(warning));
            options.onModelWarning?.(warning);
          },
          onResponseMode: (mode, detail) => {
            options.onResponseMode?.(mode, detail);
            if (detail) {
              options.onProgress?.(this.localizeModelResponseDetail(detail));
            } else if (mode === "non-stream") {
              options.onProgress?.(this.t("main.progress.compatibility", { service: modelServiceName }));
            }
          }
        }
      );
      if (modelWarnings.length > 0) {
        rawMarkdown += modelWarnings.map((warning) => `\n\n> [!warning] ${warning}`).join("");
      }
    } catch (error) {
      if (error instanceof RequestTimeoutError) {
        const timeout = answerTimeoutDetails(
          modelServiceName,
          error.milliseconds,
          retrievalMode
        );
        const timeoutKey: TranslationKey = timeout.mode === "precise"
          ? "main.answerTimeout.precise"
          : "main.answerTimeout.fast";
        throw new AnswerTimeoutError(
          this.t(timeoutKey, {
            service: timeout.service,
            seconds: timeout.seconds
          }),
          retrieval
        );
      }
      throw error;
    }
    const citationCheck = validateAnswerCitations(rawMarkdown, context.sources, {
      title: this.t("view.citationWarningTitle"),
      invalidIds: (ids) => this.t("view.citationWarningInvalidIds", { ids }),
      missingValidCitation: this.t("view.citationWarningMissing")
    });
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
      new Notice(this.t("main.profile.pending"));
      return;
    }
    const sourceRoots = [...new Set([
      ...profile.stableSourceRoots,
      ...profile.pendingSourceRoots
    ])];
    new Notice([
      this.t("main.profile.schema", { value: profile.schemaFiles.join(", ") || this.t("main.unrecognized") }),
      this.t("main.profile.index", { value: profile.indexFiles.join(", ") || this.t("main.unrecognized") }),
      this.t("main.profile.wiki", { value: profile.wikiRoots.join(", ") || this.t("main.unrecognized") }),
      this.t("main.profile.sources", { value: sourceRoots.join(", ") || this.t("main.unrecognized") })
    ].join("\n"), 10_000);
  }

  private showIndexDiagnostics(): void {
    const activePath = this.app.workspace.getActiveFile()?.path;
    const diagnostics = this.indexCoordinator.getDiagnostics(activePath);
    const cacheLabel = diagnostics.cacheScope === "device"
      ? this.t("main.diagnostics.device")
      : diagnostics.cacheScope === "vault"
        ? this.t("main.diagnostics.vault") : this.t("main.diagnostics.disabled");
    const activeLine = diagnostics.activePath
      ? this.t("main.diagnostics.active", { indexed: this.t(diagnostics.activePath.indexed ? "main.indexed" : "main.notIndexed"), role: diagnostics.activePath.role, chunks: diagnostics.activePath.chunks })
      : this.t("main.diagnostics.noActive");
    new Notice([
      this.localizedIndexStatus(diagnostics.status),
      this.t("main.diagnostics.cache", { value: cacheLabel }),
      this.t("main.diagnostics.visible", { count: diagnostics.visibleMarkdownFiles }),
      this.t("main.diagnostics.tracked", { count: diagnostics.trackedMarkdownFiles }),
      this.t("main.diagnostics.wiki", { files: diagnostics.wikiFiles, chunks: diagnostics.wikiChunks }),
      this.t("main.diagnostics.sources", { count: diagnostics.sourceFiles }),
      activeLine,
      diagnostics.pendingUpdates > 0 ? this.t("main.diagnostics.pending", { count: diagnostics.pendingUpdates }) : this.t("main.diagnostics.clear")
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
