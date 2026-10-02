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
    { role: "assistant", content: "Use quoted values.\n\nThey preserve punctuation." },
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
