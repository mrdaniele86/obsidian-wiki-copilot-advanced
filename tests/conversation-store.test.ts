import { describe, expect, it, vi } from "vitest";
import { ConversationStore } from "../src/chat/conversation-store";
import { conversationFileName, serializeConversation } from "../src/chat/conversation-markdown";
import type { Conversation } from "../src/chat/conversation-types";

const conversation: Conversation = {
  id: "conversation-123",
  createdAt: "2026-10-02T10:20:30.000Z",
  updatedAt: "2026-10-02T10:21:30.000Z",
  title: "Question",
  turns: [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }]
};

function createVault(existing: { path: string; content: string }[] = []) {
  const files = [...existing];
  return {
    createFolder: vi.fn(async () => undefined),
    create: vi.fn(async (path: string, content: string) => {
      const file = { path, content };
      files.push(file);
      return file;
    }),
    modify: vi.fn(async (file: { path: string; content: string }, content: string) => {
      file.content = content;
    }),
    cachedRead: vi.fn(async (file: { path: string }) => files.find((item) => item.path === file.path)?.content ?? ""),
    getMarkdownFiles: vi.fn(() => files),
    getAbstractFileByPath: vi.fn((path: string) => files.find((file) => file.path === path) ?? null)
  };
}

describe("ConversationStore", () => {
  it("creates normalized nested folders and a conversation file", async () => {
    const vault = createVault();
    const store = new ConversationStore(vault);

    const path = await store.save("/Memory Copilot//Conversations/", conversation);

    expect(vault.createFolder).toHaveBeenCalledWith("Memory Copilot");
    expect(vault.createFolder).toHaveBeenCalledWith("Memory Copilot/Conversations");
    expect(path).toMatch(/^Memory Copilot\/Conversations\/2026-10-02-102030-question-id-[0-9a-f]{16}\.md$/u);
    expect(vault.create).toHaveBeenCalledWith(path, serializeConversation(conversation));
  });

  it("modifies an existing conversation file instead of creating another", async () => {
    const path = `Memory Copilot/Conversations/${conversationFileName(conversation)}`;
    const vault = createVault([{ path, content: serializeConversation(conversation) }]);
    const store = new ConversationStore(vault);
    const updated = { ...conversation, updatedAt: "2026-10-02T10:22:30.000Z", title: "Renamed" };

    await store.save("Memory Copilot/Conversations", updated);

    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).toHaveBeenCalledWith(expect.objectContaining({ path }), serializeConversation(updated));
  });

  it("lists valid conversations and ignores malformed files", async () => {
    const validPath = `Memory Copilot/Conversations/${conversationFileName(conversation)}`;
    const vault = createVault([
      { path: validPath, content: serializeConversation(conversation) },
      { path: "Memory Copilot/Conversations/manual.md", content: "# ordinary note" },
      { path: "wiki/elsewhere.md", content: serializeConversation(conversation) }
    ]);
    const store = new ConversationStore(vault);

    await expect(store.list("Memory Copilot/Conversations")).resolves.toEqual([
      { path: validPath, conversation }
    ]);
    await expect(store.load(validPath)).resolves.toEqual(conversation);
  });

  it("uses distinct paths for different conversation IDs with the same timestamp and title", async () => {
    const vault = createVault();
    const store = new ConversationStore(vault);
    const second = { ...conversation, id: "conversation-456" };

    const firstPath = await store.save("Memory Copilot/Conversations", conversation);
    const secondPath = await store.save("Memory Copilot/Conversations", second);

    expect(firstPath).not.toBe(secondPath);
    expect(secondPath).toMatch(/^Memory Copilot\/Conversations\/2026-10-02-102030-question-id-[0-9a-f]{16}\.md$/u);
    expect(vault.create).toHaveBeenCalledTimes(2);
  });

  it("does not create over a folder that collides with a conversation path", async () => {
    const vault = createVault();
    const store = new ConversationStore(vault);
    const path = `Memory Copilot/Conversations/${conversationFileName(conversation)}`;
    const folder = { path, children: [] };
    vault.getAbstractFileByPath.mockImplementation((candidate: string) => candidate === path ? folder as never : null);

    await expect(store.save("Memory Copilot/Conversations", conversation)).rejects.toThrow("not a Markdown file");
    expect(vault.create).not.toHaveBeenCalled();
  });

  it("does not read a folder when loading a conversation path", async () => {
    const path = "Memory Copilot/Conversations/folder";
    const vault = createVault();
    vault.getAbstractFileByPath.mockReturnValue({ path, children: [] } as never);
    const store = new ConversationStore(vault);

    await expect(store.load(path)).rejects.toThrow("not a Markdown file");
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });
});
