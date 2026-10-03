import { describe, expect, it } from "vitest";
import { searchConversations } from "../src/chat/conversation-search";
import type { StoredConversation } from "../src/chat/conversation-types";

function stored(
  id: string,
  updatedAt: string,
  title: string,
  turns: StoredConversation["conversation"]["turns"] = []
): StoredConversation {
  return {
    path: `Conversations/${id}.md`,
    conversation: {
      id,
      createdAt: updatedAt,
      updatedAt,
      title,
      turns
    }
  };
}

describe("searchConversations", () => {
  const items = [
    stored("pancake-chat", "2026-10-03T10:00:00.000Z", "Pancake recipes"),
    stored("mustard-chat", "2026-10-03T11:00:00.000Z", "Lunch", [
      { role: "user", content: "What should I eat?" },
      { role: "assistant", content: "Try a sandwich with senape and cheese." }
    ])
  ];

  it("finds an ordered fuzzy title match", () => {
    expect(searchConversations(items, "pncake").map((item) => item.stored.conversation.id))
      .toEqual(["pancake-chat"]);
  });

  it("returns an excerpt from the strongest matching turn", () => {
    const [result] = searchConversations(items, "senape");

    expect(result?.matchedField).toBe("assistant");
    expect(result?.excerpt).toContain("senape");
  });

  it("keeps every matching neighborhood in excerpts for sparse fuzzy matches", () => {
    const title = `Alpha marker ${"x".repeat(200)} Bravo marker ${"y".repeat(200)} Zebra marker`;
    const [result] = searchConversations([stored("sparse", "2026-10-03T10:00:00.000Z", title)], "abz");

    expect(result?.excerpt).toContain("Alpha marker");
    expect(result?.excerpt).toContain("Bravo marker");
    expect(result?.excerpt).toContain("Zebra marker");
  });

  it("normalizes case, diacritics, punctuation, and whitespace", () => {
    const conversations = [stored("normalized", "2026-10-03T10:00:00.000Z", "Crème-brûlée   delights")];

    expect(searchConversations(conversations, "CREME brulee").map((item) => item.stored.conversation.id))
      .toEqual(["normalized"]);
  });

  it("prefers contiguous and word-start fuzzy matches", () => {
    const conversations = [
      stored("scattered", "2026-10-03T10:00:00.000Z", "A plain canoe keeps every letter apart"),
      stored("contiguous", "2026-10-03T09:00:00.000Z", "Pancake ideas")
    ];

    expect(searchConversations(conversations, "panc").map((item) => item.stored.conversation.id))
      .toEqual(["contiguous", "scattered"]);
  });

  it("keeps an empty query newest first", () => {
    const conversations = [
      stored("older", "2026-10-01T10:00:00.000Z", "Older"),
      stored("newest", "2026-10-03T10:00:00.000Z", "Newest")
    ];

    expect(searchConversations(conversations, "").map((item) => item.stored.conversation.id))
      .toEqual(["newest", "older"]);
  });

  it("breaks equal scores by most recent update", () => {
    const conversations = [
      stored("older", "2026-10-01T10:00:00.000Z", "Match"),
      stored("newest", "2026-10-03T10:00:00.000Z", "Match")
    ];

    expect(searchConversations(conversations, "match").map((item) => item.stored.conversation.id))
      .toEqual(["newest", "older"]);
  });

  it("does not return conversations without a fuzzy match", () => {
    expect(searchConversations(items, "missing")).toEqual([]);
  });
});
