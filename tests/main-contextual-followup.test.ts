import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Component: class {},
  ItemView: class {},
  Modal: class {},
  Notice: class {},
  Plugin: class {},
  PluginSettingTab: class {},
  Platform: { isMobile: false },
  parseLinktext: (value: string) => ({ path: value, subpath: "" }),
  setIcon: () => undefined
}));

import WikiCopilotPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("contextual answer follow-ups", () => {
  it("marks a retrieved answer without a valid citation as ungrounded while retaining its markdown and sources", async () => {
    const rawMarkdown = "Use recovery tomorrow.";
    const llmAnswer = vi.fn().mockResolvedValue(rawMarkdown);
    const plugin = Object.create(WikiCopilotPlugin.prototype) as WikiCopilotPlugin & Record<string, unknown>;
    plugin.settings = DEFAULT_SETTINGS;
    plugin.t = ((key: string) => key) as WikiCopilotPlugin["t"];
    plugin.indexCoordinator = { queryGuidance: "" } as WikiCopilotPlugin["indexCoordinator"];
    plugin.retrieve = vi.fn().mockResolvedValue({
      query: "what next",
      chunks: [{
        id: "workout",
        path: "workouts.md",
        title: "Workouts",
        heading: "Tempo",
        headingLevel: 1,
        chunkIndex: 0,
        text: "Tempo should be followed by recovery.",
        aliases: "",
        tags: "",
        role: "wiki",
        evidenceTier: "synthesis",
        score: 1,
        lexicalScore: 1,
        origin: "lexical"
      }],
      totalCandidates: 1,
      truncated: false
    });
    (plugin as unknown as { llmClient: { answer: typeof llmAnswer } }).llmClient = { answer: llmAnswer };

    const answer = await plugin.answer("what next", []);

    expect(answer).toMatchObject({
      markdown: rawMarkdown,
      sources: [expect.objectContaining({ id: "S1", path: "workouts.md" })],
      knowledgeBaseHit: false,
      citationWarning: "view.citationWarningMissing"
    });
  });

  it("keeps a retrieved answer grounded when it contains a valid citation", async () => {
    const llmAnswer = vi.fn().mockResolvedValue("Use recovery tomorrow. [S1]");
    const plugin = Object.create(WikiCopilotPlugin.prototype) as WikiCopilotPlugin & Record<string, unknown>;
    plugin.settings = DEFAULT_SETTINGS;
    plugin.t = ((key: string) => key) as WikiCopilotPlugin["t"];
    plugin.indexCoordinator = { queryGuidance: "" } as WikiCopilotPlugin["indexCoordinator"];
    plugin.retrieve = vi.fn().mockResolvedValue({
      query: "what next",
      chunks: [{
        id: "workout",
        path: "workouts.md",
        title: "Workouts",
        heading: "Tempo",
        headingLevel: 1,
        chunkIndex: 0,
        text: "Tempo should be followed by recovery.",
        aliases: "",
        tags: "",
        role: "wiki",
        evidenceTier: "synthesis",
        score: 1,
        lexicalScore: 1,
        origin: "lexical"
      }],
      totalCandidates: 1,
      truncated: false
    });
    (plugin as unknown as { llmClient: { answer: typeof llmAnswer } }).llmClient = { answer: llmAnswer };

    await expect(plugin.answer("what next", [])).resolves.toMatchObject({ knowledgeBaseHit: true });
  });

  it("sends an unmatched 8x300 query to the model without conversation context", async () => {
    const llmAnswer = vi.fn().mockResolvedValue("The recommendation is recovery.");
    const plugin = Object.create(WikiCopilotPlugin.prototype) as WikiCopilotPlugin & Record<string, unknown>;
    plugin.settings = DEFAULT_SETTINGS;
    plugin.t = ((key: string) => key) as WikiCopilotPlugin["t"];
    plugin.indexCoordinator = { queryGuidance: "" } as WikiCopilotPlugin["indexCoordinator"];
    plugin.retrieve = vi.fn().mockResolvedValue({ query: "8x300", chunks: [], totalCandidates: 0, truncated: false });
    (plugin as unknown as { llmClient: { answer: typeof llmAnswer } }).llmClient = { answer: llmAnswer };

    const answer = await plugin.answer("8x300", []);

    expect(llmAnswer).toHaveBeenCalledOnce();
    expect(answer).toMatchObject({
      markdown: "The recommendation is recovery.",
      sources: [],
      knowledgeBaseHit: false
    });
  });

  it("sends an unmatched 8x300 follow-up to the model when recent context is enabled", async () => {
    const llmAnswer = vi.fn().mockResolvedValue("The recommendation is recovery.");
    const plugin = Object.create(WikiCopilotPlugin.prototype) as WikiCopilotPlugin & Record<string, unknown>;
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      model: { ...DEFAULT_SETTINGS.model, includeRecentConversationContext: true }
    };
    plugin.t = ((key: string) => key) as WikiCopilotPlugin["t"];
    plugin.indexCoordinator = { queryGuidance: "" } as WikiCopilotPlugin["indexCoordinator"];
    plugin.retrieve = vi.fn().mockResolvedValue({ query: "Ho fatto 8x300 e poi Tempo", chunks: [], totalCandidates: 0, truncated: false });
    (plugin as unknown as { llmClient: { answer: typeof llmAnswer } }).llmClient = { answer: llmAnswer };
    const history = [
      { role: "user" as const, content: "Oggi ho fatto un allenamento a tempo, che allenamento devo fare successivo?" },
      { role: "assistant" as const, content: "Dopo Tempo consiglio recupero." }
    ];

    const answer = await plugin.answer("Ho fatto un allenamento 8x300 e poi un allenamento tempo", history);

    expect(llmAnswer).toHaveBeenCalledWith(
      "Ho fatto un allenamento 8x300 e poi un allenamento tempo",
      expect.anything(),
      history,
      "",
      plugin.settings.model,
      expect.any(Number),
      expect.anything()
    );
    expect(answer.markdown).toBe("The recommendation is recovery.");
  });
});
