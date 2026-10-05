import { describe, expect, it } from "vitest";
import { conversationFileName, parseConversation, serializeConversation } from "../src/chat/conversation-markdown";
import type { Conversation } from "../src/chat/conversation-types";

const conversation: Conversation = {
  id: "conversation-123",
  createdAt: "2026-10-02T10:20:30.000Z",
  updatedAt: "2026-10-02T10:21:30.000Z",
  title: "How do I use YAML: safely?",
  turns: [
    { role: "user", content: "How do I use YAML: safely?" },
    {
      role: "assistant",
      content: "Use quoted values.\n\nThey preserve punctuation.",
      sources: [{
        id: "1", path: "Wiki/YAML.md", title: "YAML", heading: "Quoting",
        role: "wiki", evidenceTier: "synthesis", score: 0.91, origin: "lexical"
      }],
      knowledgeBaseHit: false
    },
    { role: "user", content: "Thanks." }
  ]
};

describe("conversation Markdown", () => {
  it("round-trips typed frontmatter and ordered conversation turns", () => {
    const markdown = serializeConversation(conversation);

    expect(markdown).toContain("type: \"wiki-copilot-conversation\"");
    expect(markdown).toContain("## User");
    expect(markdown).toContain("## Assistant");
    expect(parseConversation(markdown)).toEqual(conversation);
  });

  it("losslessly round-trips empty final turns, trailing whitespace, and section-like content", () => {
    const preciseConversation: Conversation = {
      ...conversation,
      turns: [
        { role: "user", content: "A top-level heading:\n\n## Assistant\n\nnot a new turn.  \n" },
        { role: "assistant", content: "" }
      ]
    };

    expect(parseConversation(serializeConversation(preciseConversation))).toEqual(preciseConversation);
  });

  it("keeps legacy turns readable when assistant rendering state is absent", () => {
    const legacy = serializeConversation({
      ...conversation,
      turns: [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }]
    });

    expect(parseConversation(legacy)?.turns[1]).toEqual({ role: "assistant", content: "Answer" });
  });

  it("round-trips optional web search state without affecting vault sources", () => {
    const webConversation: Conversation = {
      ...conversation,
      turns: [{
        role: "user",
        content: "What changed?"
      }, {
        role: "assistant",
        content: "Current answer.",
        webSearch: {
          provider: "gemini",
          question: "What changed?",
          model: "gemini-2.5-flash",
          answer: "Current answer.",
          sources: [{ title: "Gemini", url: "https://example.com/current" }]
        }
      }]
    };

    expect(parseConversation(serializeConversation(webConversation))).toEqual(webConversation);
  });

  it("round-trips pending clarification metadata on an assistant turn", () => {
    const clarification = {
      goal: "Recommend my next workout after Tempo.",
      question: "Which workout did you complete immediately before Tempo?",
      missing: "The workout immediately before Tempo.",
      requiresSummary: true,
      originUserTurnIndex: 0,
      originAssistantTurnIndex: 1,
      userRepliesSinceRequest: 0
    };
    const clarificationConversation: Conversation = {
      ...conversation,
      turns: [{ role: "user", content: "I did Tempo today; what should I do next?" }, {
        role: "assistant",
        content: "Which workout did you complete immediately before Tempo?",
        pendingClarification: clarification
      }]
    };

    expect(parseConversation(serializeConversation(clarificationConversation))).toEqual(clarificationConversation);
  });

  it("round-trips an assistant citation warning without changing its answer or sources", () => {
    const warningConversation: Conversation = {
      ...conversation,
      turns: [{ role: "user", content: "Question" }, {
        role: "assistant",
        content: "Uncited answer.",
        sources: conversation.turns[1]?.role === "assistant" ? conversation.turns[1].sources : [],
        knowledgeBaseHit: false,
        citationWarning: "The response contains no valid source references; use the source list."
      }]
    };

    expect(parseConversation(serializeConversation(warningConversation))).toEqual(warningConversation);
  });

  it.each([
    ["an empty goal", { goal: "" }],
    ["an overlong question", { question: "q".repeat(2_001) }],
    ["a negative origin user index", { originUserTurnIndex: -1 }],
    ["a fractional origin assistant index", { originAssistantTurnIndex: 1.5 }],
    ["too many user replies", { userRepliesSinceRequest: 3 }]
  ])("discards invalid pending clarification metadata with %s while retaining other assistant state", (_case, invalid) => {
    const serialized = serializeConversation({
      ...conversation,
      turns: [{ role: "assistant", content: "Answer", sources: conversation.turns[1]?.role === "assistant" ? conversation.turns[1].sources : [], knowledgeBaseHit: false, webSearch: {
        provider: "gemini", question: "Question", model: "gemini-2.5-flash", answer: "Answer", sources: [{ title: "Source", url: "https://example.com" }]
      }, pendingClarification: ({
        goal: "Recommend a workout.",
        question: "What was immediately before Tempo?",
        missing: "The workout before Tempo.",
        requiresSummary: false,
        originUserTurnIndex: 0,
        originAssistantTurnIndex: 1,
        userRepliesSinceRequest: 0,
        ...invalid
      } as never) }]
    });

    expect(parseConversation(serialized)?.turns).toEqual([{ role: "assistant", content: "Answer", sources: conversation.turns[1]?.role === "assistant" ? conversation.turns[1].sources : [], knowledgeBaseHit: false, webSearch: {
      provider: "gemini", question: "Question", model: "gemini-2.5-flash", answer: "Answer", sources: [{ title: "Source", url: "https://example.com" }]
    } }]);
  });

  it.each([
    ["an empty question", ""],
    ["an overlong question", "q".repeat(20_001)]
  ])("discards persisted web metadata with %s", (_case, question) => {
    const serialized = serializeConversation({
      ...conversation,
      turns: [{
        role: "user",
        content: "A valid paired question"
      }, {
        role: "assistant",
        content: "Answer",
        webSearch: ({
          provider: "gemini",
          question,
          model: "gemini-2.5-flash",
          answer: "Answer",
          sources: [{ title: "Source", url: "https://example.com" }]
        } as never)
      }]
    });

    expect(parseConversation(serialized)?.turns).toEqual([
      { role: "user", content: "A valid paired question" },
      { role: "assistant", content: "Answer" }
    ]);
  });

  it("keeps legacy web metadata only when its immediately preceding user question is valid", () => {
    const legacyWithPair = serializeConversation({
      ...conversation,
      turns: [{ role: "user", content: "A valid legacy question" }, {
        role: "assistant",
        content: "Answer",
        webSearch: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          answer: "Answer",
          sources: [{ title: "Source", url: "https://example.com" }]
        }
      }]
    });

    expect(parseConversation(legacyWithPair)?.turns[1]).toMatchObject({
      webSearch: { provider: "gemini", answer: "Answer" }
    });
  });

  it("discards malformed web search metadata while preserving its assistant turn", () => {
    const serialized = serializeConversation({
      ...conversation,
      turns: [{ role: "assistant", content: "Answer", webSearch: ({
        provider: "invalid", model: "gemini-2.5-flash", answer: "Answer", sources: []
      } as never) }]
    });

    expect(parseConversation(serialized)?.turns).toEqual([{ role: "assistant", content: "Answer" }]);
  });

  it.each([
    ["an HTTP source URL", { title: "Source", url: "http://example.com" }],
    ["an empty source title", { title: "", url: "https://example.com" }],
    ["an overlong source title", { title: "a".repeat(501), url: "https://example.com" }],
    ["an overlong source URL", { title: "Source", url: `https://example.com/${"a".repeat(2_049)}` }]
  ])("discards persisted web metadata with %s while retaining Vault sources", (_case, source) => {
    const serialized = serializeConversation({
      ...conversation,
      turns: [{
        role: "assistant",
        content: "Answer",
        sources: conversation.turns[1]?.role === "assistant" ? conversation.turns[1].sources : [],
        webSearch: { provider: "gemini", model: "gemini-2.5-flash", answer: "Answer", sources: [source] }
      }]
    });

    expect(parseConversation(serialized)?.turns).toEqual([{
      role: "assistant",
      content: "Answer",
      sources: conversation.turns[1]?.role === "assistant" ? conversation.turns[1].sources : []
    }]);
  });

  it.each([
    ["an empty model", { model: "", answer: "Answer", sources: [{ title: "Source", url: "https://example.com" }] }],
    ["an overlong model", { model: "m".repeat(201), answer: "Answer", sources: [{ title: "Source", url: "https://example.com" }] }],
    ["an empty answer", { model: "gemini-2.5-flash", answer: "", sources: [{ title: "Source", url: "https://example.com" }] }],
    ["more than twelve sources", {
      model: "gemini-2.5-flash",
      answer: "Answer",
      sources: Array.from({ length: 13 }, (_, index) => ({ title: `Source ${index}`, url: `https://example.com/${index}` }))
    }],
    ["an overlong answer", {
      model: "gemini-2.5-flash",
      answer: "a".repeat(20_001),
      sources: [{ title: "Source", url: "https://example.com" }]
    }]
  ])("discards persisted web metadata with %s", (_case, webSearch) => {
    const serialized = serializeConversation({
      ...conversation,
      turns: [{ role: "assistant", content: "Answer", webSearch: ({ provider: "gemini", ...webSearch } as never) }]
    });

    expect(parseConversation(serialized)?.turns).toEqual([{ role: "assistant", content: "Answer" }]);
  });

  it("does not treat ordinary notes or malformed conversation notes as conversations", () => {
    expect(parseConversation("# ordinary note")).toBeNull();
    expect(parseConversation("---\ntype: \"wiki-copilot-conversation\"\n---\n## User\nHello")).toBeNull();
  });

  it("creates a portable filename from a timestamp and sanitized abbreviated title", () => {
    expect(conversationFileName(conversation)).toMatch(/^2026-10-02-102030-how-do-i-use-yaml-safely-id-[0-9a-f]{16}\.md$/u);
  });

  it("uses a case-insensitive-safe suffix for IDs whose Base64 encodings collide by case", () => {
    const first = { ...conversation, id: "\u0000\u0080" };
    const second = { ...conversation, id: "\u0000\u009a" };

    expect(conversationFileName(first).toLocaleLowerCase()).not.toBe(conversationFileName(second).toLocaleLowerCase());
  });
});
