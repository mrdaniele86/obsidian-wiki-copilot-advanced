import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Component {}
  class Plugin extends Component {}
  class PluginSettingTab { constructor(..._args: unknown[]) {} }
  class ItemView extends Component {}
  class Modal {}
  class ConfirmationModal extends Modal {}
  class Notice {}
  class MarkdownView {}
  class WorkspaceLeaf {}
  class TFile {}
  class Vault {}
  class MetadataCache {}
  return {
    Component, Plugin, PluginSettingTab, ItemView, Modal, ConfirmationModal, Notice, MarkdownView, WorkspaceLeaf, TFile, Vault, MetadataCache,
    Platform: { isMobile: false },
    normalizePath: (path: string) => path,
    parseLinktext: (value: string) => ({ path: value, subpath: "" }),
    setIcon: () => undefined,
    getAllTags: () => [],
    MarkdownRenderer: { render: async () => undefined },
    requestUrl: vi.fn()
  };
});

import WikiCopilotPlugin from "../src/main";
import type { RetrievalResult } from "../src/core/types";
import type { ResolvedClarification } from "../src/chat/pending-clarification";

const tempoClarification: ResolvedClarification = {
  goal: "recommend the next workout after Tempo",
  question: "Which workout came immediately before Tempo?",
  missing: "the workout before Tempo",
  requiresSummary: true,
  originUserTurnIndex: 0,
  originAssistantTurnIndex: 1,
  userRepliesSinceRequest: 0,
  reply: "Before it I did Soglia."
};

describe("pending clarification flow", () => {
  it("anchors retrieval and completion to Tempo when the reply is Soglia", async () => {
    const plugin = Object.create(WikiCopilotPlugin.prototype) as Record<string, unknown>;
    const retrieve = vi.fn(async (question: string): Promise<RetrievalResult> => ({
      query: question,
      chunks: [],
      totalCandidates: 0,
      truncated: false
    }));
    const answer = vi.fn(async (question: string, _context: unknown, _history: unknown, _guidance: unknown, _settings: unknown, _timeout: unknown, options: { onClarification?: (clarification: { goal: string; question: string; missing: string; requiresSummary: boolean }) => void }) => {
      expect(question).toContain("Original objective:\nrecommend the next workout after Tempo");
      expect(question).toContain("Reply received:\nBefore it I did Soglia.");
      options.onClarification?.({
        goal: "recommend the next workout after Tempo",
        question: "Which workout came immediately before Tempo?",
        missing: "the workout before Tempo",
        requiresSummary: true
      });
      return "Run easy tomorrow.";
    });
    plugin.retrieve = retrieve;
    plugin.llmClient = { answer };
    plugin.indexCoordinator = { queryGuidance: "" };
    plugin.settings = {
      model: { provider: "custom", serviceName: "Test", endpoint: "https://example.com/v1", model: "test" },
      retrievalRange: "medium",
      retrievalMode: "fast"
    };
    plugin.t = vi.fn((key: string) => key);

    await expect((plugin.answer as (
      question: string,
      history: [],
      options: { clarification: ResolvedClarification }
    ) => Promise<unknown>)("Before it I did Soglia.", [], {
      clarification: tempoClarification
    })).resolves.toMatchObject({
      markdown: "Run easy tomorrow.",
      pendingClarification: expect.objectContaining({
        goal: "recommend the next workout after Tempo",
        originUserTurnIndex: 0,
        originAssistantTurnIndex: 1
      })
    });

    expect(retrieve).toHaveBeenCalledWith(
      expect.stringContaining("recommend the next workout after Tempo"),
      [],
      undefined,
      undefined
    );
    expect(answer).toHaveBeenCalledOnce();
  });
});
