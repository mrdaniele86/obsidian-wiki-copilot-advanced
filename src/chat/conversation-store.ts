import { conversationFileName, parseConversation, serializeConversation } from "./conversation-markdown";
import type { Conversation, StoredConversation } from "./conversation-types";

interface VaultFileLike {
  path: string;
  extension?: string;
}

interface VaultFolderLike {
  path: string;
  children: unknown;
}

type VaultEntryLike = VaultFileLike | VaultFolderLike;

interface ConversationVault {
  createFolder(path: string): Promise<unknown>;
  create(path: string, content: string): Promise<VaultFileLike>;
  modify(file: VaultFileLike, content: string): Promise<void>;
  cachedRead(file: VaultFileLike): Promise<string>;
  getMarkdownFiles(): readonly VaultFileLike[];
  getAbstractFileByPath(path: string): VaultEntryLike | null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").split("/").filter(Boolean).join("/");
}

function isInFolder(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(`${folder}/`);
}

function isMarkdownFile(entry: VaultEntryLike): entry is VaultFileLike {
  return !("children" in entry) && (entry.extension === undefined || entry.extension.toLocaleLowerCase() === "md");
}

function requireMarkdownFile(entry: VaultEntryLike, path: string): VaultFileLike {
  if (!isMarkdownFile(entry)) {
    throw new Error(`Conversation path is not a Markdown file: ${path}`);
  }
  return entry;
}

export class ConversationStore {
  constructor(private readonly vault: ConversationVault) {}

  async list(folder: string): Promise<StoredConversation[]> {
    const normalizedFolder = normalizePath(folder);
    const conversations: StoredConversation[] = [];
    for (const file of this.vault.getMarkdownFiles()) {
      if (!isInFolder(file.path, normalizedFolder)) continue;
      const conversation = parseConversation(await this.vault.cachedRead(file));
      if (conversation) conversations.push({ path: file.path, conversation });
    }
    return conversations.sort((left, right) => right.conversation.updatedAt.localeCompare(left.conversation.updatedAt));
  }

  async load(path: string): Promise<Conversation | null> {
    const normalizedPath = normalizePath(path);
    const entry = this.vault.getAbstractFileByPath(normalizedPath);
    if (!entry) return null;
    return parseConversation(await this.vault.cachedRead(requireMarkdownFile(entry, normalizedPath)));
  }

  async save(folder: string, conversation: Conversation): Promise<string> {
    const normalizedFolder = normalizePath(folder);
    await this.ensureFolder(normalizedFolder);
    const existing = (await this.list(normalizedFolder)).find((item) => item.conversation.id === conversation.id);
    const markdown = serializeConversation(conversation);
    if (existing) {
      const file = this.vault.getAbstractFileByPath(existing.path);
      if (file) {
        await this.vault.modify(requireMarkdownFile(file, existing.path), markdown);
        return existing.path;
      }
    }
    const path = [normalizedFolder, conversationFileName(conversation)].filter(Boolean).join("/");
    const collision = this.vault.getAbstractFileByPath(path);
    if (collision) {
      requireMarkdownFile(collision, path);
      throw new Error(`Conversation path is already occupied: ${path}`);
    }
    await this.vault.create(path, markdown);
    return path;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index++) {
      const path = parts.slice(0, index).join("/");
      const entry = this.vault.getAbstractFileByPath(path);
      if (!entry) {
        await this.vault.createFolder(path);
      } else if (!("children" in entry)) {
        throw new Error(`Conversation folder path is not a folder: ${path}`);
      }
    }
  }
}
