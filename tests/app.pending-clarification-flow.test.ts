import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Component: class {},
  ItemView: class {},
  Modal: class {},
  ConfirmationModal: class {},
  Notice: class {},
  Platform: { isMobile: false },
  parseLinktext: (value: string) => ({ path: value, subpath: "" }),
  setIcon: () => undefined
}));

import { WikiCopilotView } from "../src/ui/wiki-copilot-view";

const tempoPending = {
  goal: "recommend the next workout after Tempo",
  question: "Which workout came immediately before Tempo?",
  missing: "the workout before Tempo",
  requiresSummary: true,
  originUserTurnIndex: 0,
  originAssistantTurnIndex: 1,
  userRepliesSinceRequest: 0
};

function viewFor(answer: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const view = Object.create(WikiCopilotView.prototype) as Record<string, unknown>;
  view.busy = false;
  view.requestSequence = 0;
  view.activeRequest = null;
  view.turns = [];
  view.conversation = null;
  view.queryEl = { value: "" };
  view.plugin = { isModelConfigured: () => true, answer, t: (key: string) => key };
  view.setBusy = vi.fn();
  view.appendLoading = vi.fn(() => ({ remove: vi.fn(), setText: vi.fn() }));
  view.appendUserMessage = vi.fn();
  view.appendAssistantMessage = vi.fn().mockResolvedValue(undefined);
  view.appendStreamingAssistantMessage = vi.fn();
  view.saveConversation = vi.fn().mockResolvedValue(undefined);
  view.resetComposerHeight = vi.fn();
  view.yieldToPaint = vi.fn().mockResolvedValue(undefined);
  view.chatEl = { querySelector: vi.fn(() => null) };
  return view;
}

describe("pending clarification in the chat view", () => {
  it("persists a model clarification then sends the raw Soglia reply with anchored clarification metadata", async () => {
    const answer = vi.fn()
      .mockResolvedValueOnce({
        markdown: "Which workout came immediately before Tempo?",
        sources: [],
        knowledgeBaseHit: false,
        pendingClarification: tempoPending
      })
      .mockResolvedValueOnce({ markdown: "Ho identificato Soglia.", sources: [], knowledgeBaseHit: true });
    const view = viewFor(answer);

    await (view.runQuestion as (question: string, history: unknown[], options: { appendUserMessage: boolean }) => Promise<void>)(
      "What next after Tempo?", [], { appendUserMessage: true }
    );
    (view.queryEl as { value: string }).value = "Soglia";
    await (view.ask as () => Promise<void>)();

    expect(answer).toHaveBeenLastCalledWith(
      "Soglia",
      expect.any(Array),
      expect.objectContaining({
        clarification: expect.objectContaining({ ...tempoPending, reply: "Soglia" })
      })
    );
    const conversation = view.conversation as { turns: Array<{ pendingClarification?: unknown }> };
    expect(conversation.turns[1]?.pendingClarification).toBeUndefined();
  });

  it("treats a new explicit question as a replacement and clears the pending clarification", async () => {
    const answer = vi.fn().mockResolvedValue({ markdown: "A new answer", sources: [], knowledgeBaseHit: true });
    const view = viewFor(answer);
    const turns = [
      { role: "user" as const, content: "What next after Tempo?" },
      { role: "assistant" as const, content: "Which workout came immediately before Tempo?", pendingClarification: tempoPending }
    ];
    view.turns = turns.map((turn) => ({ ...turn }));
    view.conversation = { id: "saved", createdAt: "now", updatedAt: "now", title: "Tempo", turns };
    (view.queryEl as { value: string }).value = "What should I do tomorrow?";

    await (view.ask as () => Promise<void>)();

    expect(answer).toHaveBeenCalledWith(
      "What should I do tomorrow?",
      expect.any(Array),
      expect.objectContaining({ clarification: undefined })
    );
    expect(turns[1]?.pendingClarification).toBeUndefined();
  });

  it("uses valid pending clarification restored from a loaded conversation", async () => {
    const answer = vi.fn().mockResolvedValue({ markdown: "Ho identificato Soglia.", sources: [], knowledgeBaseHit: true });
    const view = viewFor(answer);
    const turns = [
      { role: "user" as const, content: "What next after Tempo?" },
      { role: "assistant" as const, content: "Which workout came immediately before Tempo?", pendingClarification: tempoPending }
    ];
    view.turns = turns.map((turn) => ({ ...turn }));
    view.conversation = { id: "saved", createdAt: "now", updatedAt: "now", title: "Tempo", turns };
    (view.queryEl as { value: string }).value = "Soglia";

    await (view.ask as () => Promise<void>)();

    expect(answer).toHaveBeenCalledWith(
      "Soglia",
      expect.any(Array),
      expect.objectContaining({ clarification: expect.objectContaining({ reply: "Soglia" }) })
    );
  });
});
