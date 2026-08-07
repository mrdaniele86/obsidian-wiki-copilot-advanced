import { normalizePath, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { AnswerTimeoutError, answerTimeoutMessage } from "./core/answer-error";
import { validateAnswerCitations } from "./core/citations";
import { buildAnswerContext } from "./core/context-builder";
import type { AnswerResult, RetrievalResult } from "./core/types";
import { OpenAICompatibleClient } from "./llm/openai-compatible";
import type { ChatTurn } from "./llm/openai-compatible";
import { modelTimeoutMsForRange, RequestTimeoutError } from "./llm/request-timeout";
import {
  FIXED_API_KEY_ID,
  providerLabel,
  providerRequiresApiKey
} from "./model-presets";
import { IndexCoordinator } from "./obsidian/index-coordinator";
import { AdapterIndexCacheRepository } from "./obsidian/index-cache";
import {
  DEFAULT_SETTINGS,
  legacyApiKeySecretName,
  loadWikiCopilotSettings,
  WikiCopilotSettingTab
} from "./settings";
import type { WikiCopilotSettings } from "./settings";
import { WikiCopilotView, WIKI_COPILOT_VIEW_TYPE } from "./ui/wiki-copilot-view";

function isFollowUpQuestion(question: string): boolean {
  return question.length <= 36 || /(?:这个|这些|它|它们|上述|前面|继续|那|其|this|that|those|it|they|continue)/iu.test(question);
}

export default class WikiCopilotPlugin extends Plugin {
  override settings: WikiCopilotSettings = DEFAULT_SETTINGS;
  indexCoordinator!: IndexCoordinator;

  private llmClient!: OpenAICompatibleClient;
  private manualRebuildPromise: Promise<void> | null = null;

  override async onload(): Promise<void> {
    const savedData: unknown = await this.loadData();
    this.settings = loadWikiCopilotSettings(savedData);
    await this.migrateLegacyApiKey(savedData);
    const cacheRepository = this.manifest.dir
      ? new AdapterIndexCacheRepository(
        this.app.vault.adapter,
        normalizePath(`${this.manifest.dir}/index-cache.json`)
      )
      : null;
    this.indexCoordinator = new IndexCoordinator(
      this.app.vault,
      this.app.metadataCache,
      () => this.settings,
      cacheRepository
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

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      this.indexCoordinator.scheduleFileUpdate(file);
    }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.indexCoordinator.rebuildGraph();
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
      void this.indexCoordinator.initialize();
    });
  }

  override onunload(): void {
    this.indexCoordinator.destroy();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshOpenViews();
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
    onProgress?: (message: string) => void
  ): Promise<RetrievalResult> {
    if (this.indexCoordinator.currentStatus.state !== "ready") {
      onProgress?.("正在准备本地知识索引…");
    }
    await this.indexCoordinator.ensureReady();
    const previousQuestion = [...history].reverse().find((turn) => turn.role === "user")?.content;
    const retrievalQuery = previousQuestion && isFollowUpQuestion(question)
      ? `${previousQuestion}\n${question}`
      : question;
    const activePath = this.settings.prioritizeActiveNote
      ? this.app.workspace.getActiveFile()?.path
      : undefined;

    return this.indexCoordinator.retriever.retrieve(retrievalQuery, {
      ...this.settings.retrieval,
      activePath
    }, onProgress);
  }

  async answer(
    question: string,
    history: ChatTurn[],
    onProgress?: (message: string) => void
  ): Promise<AnswerResult> {
    const retrieval = await this.retrieve(question, history, onProgress);
    const knowledgeBaseHit = retrieval.chunks.length > 0;
    const context = buildAnswerContext(retrieval);
    const modelServiceName = providerLabel(
      this.settings.model.provider,
      this.settings.model.serviceName
    );
    onProgress?.(knowledgeBaseHit
      ? `已检索 ${retrieval.chunks.length} 个知识页面，${modelServiceName}思考中…`
      : `未命中当前知识库，${modelServiceName}思考中…`);
    const retrievalRange = this.settings.retrievalRange;
    const timeoutMilliseconds = modelTimeoutMsForRange(retrievalRange);
    let rawMarkdown: string;
    try {
      rawMarkdown = await this.llmClient.answer(
        question,
        context,
        history,
        this.indexCoordinator.queryGuidance,
        this.settings.model,
        timeoutMilliseconds
      );
    } catch (error) {
      if (error instanceof RequestTimeoutError) {
        throw new AnswerTimeoutError(
          answerTimeoutMessage(modelServiceName, error.milliseconds, retrievalRange),
          retrieval
        );
      }
      throw error;
    }
    const citationCheck = validateAnswerCitations(rawMarkdown, context.sources);
    return { markdown: citationCheck.markdown, sources: context.sources, knowledgeBaseHit };
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(WIKI_COPILOT_VIEW_TYPE)[0];
    let leaf: WorkspaceLeaf;
    if (existing) {
      leaf = existing;
    } else {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: WIKI_COPILOT_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof WikiCopilotView) {
      leaf.view.focusInput();
    }
  }

  private showProfileNotice(): void {
    const profile = this.indexCoordinator.profile;
    if (!profile) {
      new Notice("知识库结构尚未识别完成。 ");
      return;
    }
    new Notice([
      `Schema: ${profile.schemaFiles.join(", ") || "未识别"}`,
      `Index: ${profile.indexFiles.join(", ") || "未识别"}`,
      `Wiki: ${profile.wikiRoots.join(", ") || "未识别"}`,
      `Stable: ${profile.stableSourceRoots.join(", ") || "未识别"}`,
      `Pending: ${profile.pendingSourceRoots.join(", ") || "未识别"}`
    ].join("\n"), 10_000);
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
