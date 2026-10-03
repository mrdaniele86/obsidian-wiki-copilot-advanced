import { describe, expect, it, vi } from "vitest";
import { buildWebSearchHistory } from "../src/web-search/history";
import { WikiCopilotView } from "../src/ui/wiki-copilot-view";
import { WebSearchError } from "../src/web-search/gemini-grounding";

describe("optional web-search flow", () => {
  it("keeps a normal ask in the Vault flow without starting web search", async () => {
    const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
    const runQuestion = vi.fn().mockResolvedValue(undefined);
    const searchWeb = vi.fn();
    view.busy = false;
    view.turns = [{ role: "assistant", content: "Earlier Vault answer" }];
    view.queryEl = { value: "  Vault-only question  " };
    view.plugin = { searchWeb, t: (key: string) => key };
    view.resetComposerHeight = vi.fn();
    view.runQuestion = runQuestion;

    await (view.ask as () => Promise<void>)();

    expect(runQuestion).toHaveBeenCalledWith(
      "Vault-only question",
      [{ role: "assistant", content: "Earlier Vault answer" }],
      { appendUserMessage: true }
    );
    expect(searchWeb).not.toHaveBeenCalled();
    expect((view.queryEl as { value: string }).value).toBe("");
  });

  it("runs a normal question through Vault retrieval without calling web search", async () => {
    const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
    const retrieve = vi.fn().mockResolvedValue({ chunks: [], total: 0 });
    const searchWeb = vi.fn();
    const appendRetrievalResult = vi.fn();
    view.requestSequence = 0;
    view.activeRequest = null;
    view.plugin = {
      isModelConfigured: () => false,
      retrieve,
      searchWeb,
      t: (key: string) => key
    };
    view.setBusy = vi.fn();
    view.appendLoading = vi.fn(() => ({ remove: vi.fn(), setText: vi.fn() }));
    view.appendUserMessage = vi.fn();
    view.appendRetrievalResult = appendRetrievalResult;
    view.yieldToPaint = vi.fn().mockResolvedValue(undefined);
    view.chatEl = { querySelector: vi.fn(() => null) };

    await (view.runQuestion as (
      question: string,
      history: unknown[],
      options: { appendUserMessage: boolean; responseMode?: string }
    ) => Promise<void>)("Vault-only question", [], { appendUserMessage: true });

    expect(retrieve).toHaveBeenCalledWith("Vault-only question", [], expect.any(Function), expect.any(AbortSignal));
    expect(searchWeb).not.toHaveBeenCalled();
    expect(appendRetrievalResult).toHaveBeenCalledWith({ chunks: [], total: 0 });
  });

  it("uses the dedicated web path without calling Vault retrieval", async () => {
    const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
    const retrieve = vi.fn();
    const searchWeb = vi.fn().mockResolvedValue({
      provider: "gemini",
      model: "gemini-2.5-flash",
      question: "Current question",
      answer: "Web-only answer",
      sources: [{ title: "Source", url: "https://example.com" }]
    });
    const appendAssistantMessage = vi.fn().mockResolvedValue(undefined);
    view.busy = false;
    view.requestSequence = 0;
    view.activeRequest = null;
    view.turns = [];
    view.conversation = null;
    view.plugin = { searchWeb, retrieve, t: (key: string) => key };
    view.setBusy = vi.fn();
    view.appendLoading = vi.fn(() => ({ remove: vi.fn() }));
    view.appendUserMessage = vi.fn();
    view.appendAssistantMessage = appendAssistantMessage;
    view.saveConversation = vi.fn().mockResolvedValue(undefined);
    view.resetComposerHeight = vi.fn();
    view.queryEl = { value: "" };
    view.chatEl = { querySelector: vi.fn(() => null) };

    await (view.runWebSearch as (question: string) => Promise<void>)("Current question");

    expect(searchWeb).toHaveBeenCalledWith("Current question", undefined, expect.any(AbortSignal));
    expect(retrieve).not.toHaveBeenCalled();
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      "Web-only answer",
      [],
      false,
      expect.objectContaining({ provider: "gemini", sources: [{ title: "Source", url: "https://example.com" }] })
    );
    expect(view.saveConversation).toHaveBeenCalledOnce();
  });

  it("cancels the active web request when starting a new conversation", () => {
    const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
    const controller = new AbortController();
    view.activeRequest = controller;
    view.requestSequence = 4;
    view.turns = [{ role: "user", content: "Pending web question" }];
    view.conversation = { id: "existing" };
    view.conversationPath = "existing.md";
    view.chatEl = { empty: vi.fn() };
    view.queryEl = { value: "Pending web question" };
    view.resetConversationComponent = vi.fn();
    view.renderWelcome = vi.fn();
    view.resetComposerHeight = vi.fn();
    view.setBusy = vi.fn();

    (view.startNewConversation as () => void)();

    expect(controller.signal.aborted).toBe(true);
    expect(view.activeRequest).toBeNull();
    expect(view.requestSequence).toBe(5);
    expect(view.turns).toEqual([]);
    expect((view.queryEl as { value: string }).value).toBe("");
  });

  it("stops an in-flight web search without appending or persisting web sources", async () => {
    let requestSignal: AbortSignal | undefined;
    const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
    const appendUserMessage = vi.fn();
    const appendAssistantMessage = vi.fn();
    const saveConversation = vi.fn();
    const appendStoppedMessage = vi.fn();
    const loading = { remove: vi.fn() };
    view.busy = false;
    view.requestSequence = 0;
    view.activeRequest = null;
    view.turns = [];
    view.plugin = {
      t: (key: string) => key,
      searchWeb: vi.fn((_question: string, _history: unknown, signal: AbortSignal) => new Promise((_, reject) => {
        requestSignal = signal;
        signal.addEventListener("abort", () => reject(new WebSearchError("cancelled")), { once: true });
      }))
    };
    view.setBusy = vi.fn();
    view.appendLoading = vi.fn(() => loading);
    view.appendUserMessage = appendUserMessage;
    view.appendAssistantMessage = appendAssistantMessage;
    view.saveConversation = saveConversation;
    view.appendStoppedMessage = appendStoppedMessage;
    view.askButton = { disabled: false, setText: vi.fn() };

    const pending = (view.runWebSearch as (question: string) => Promise<void>)("Question");
    (view.cancelActiveRequest as () => void)();
    await pending;

    expect(requestSignal?.aborted).toBe(true);
    expect(appendUserMessage).not.toHaveBeenCalled();
    expect(appendAssistantMessage).not.toHaveBeenCalled();
    expect(saveConversation).not.toHaveBeenCalled();
    expect(appendStoppedMessage).toHaveBeenCalledOnce();
  });

  it("closes an in-flight web search without appending or persisting web sources", async () => {
    let requestSignal: AbortSignal | undefined;
    const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
    const appendUserMessage = vi.fn();
    const appendAssistantMessage = vi.fn();
    const saveConversation = vi.fn();
    const appendStoppedMessage = vi.fn();
    view.busy = false;
    view.requestSequence = 0;
    view.activeRequest = null;
    view.turns = [];
    view.plugin = {
      t: (key: string) => key,
      searchWeb: vi.fn((_question: string, _history: unknown, signal: AbortSignal) => new Promise((_, reject) => {
        requestSignal = signal;
        signal.addEventListener("abort", () => reject(new WebSearchError("cancelled")), { once: true });
      }))
    };
    view.setBusy = vi.fn();
    view.appendLoading = vi.fn(() => ({ remove: vi.fn() }));
    view.appendUserMessage = appendUserMessage;
    view.appendAssistantMessage = appendAssistantMessage;
    view.saveConversation = saveConversation;
    view.appendStoppedMessage = appendStoppedMessage;
    view.cancelComposerResize = vi.fn();
    view.stopMobileViewportTracking = vi.fn();
    view.unsubscribeStatus = null;
    view.conversationComponent = null;

    const pending = (view.runWebSearch as (question: string) => Promise<void>)("Question");
    await (view.onClose as () => Promise<void>)();
    await pending;

    expect(requestSignal?.aborted).toBe(true);
    expect(appendUserMessage).not.toHaveBeenCalled();
    expect(appendAssistantMessage).not.toHaveBeenCalled();
    expect(saveConversation).not.toHaveBeenCalled();
    expect(appendStoppedMessage).not.toHaveBeenCalled();
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
