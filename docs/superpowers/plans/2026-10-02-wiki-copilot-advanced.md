# Wiki Copilot Advanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add localized UI, vault-backed conversation history, non-destructive citation opening, and an Obsidian URI entry point without changing retrieval.

**Architecture:** A small i18n service resolves UI copy from a persisted preference. A chat module owns portable Markdown persistence below a configurable vault folder. The view orchestrates its UI state through those modules; the plugin coordinates activation, citation leaves, and URI handoff.

**Tech Stack:** TypeScript, Obsidian 1.13 API, Vitest, ESLint, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-02-wiki-copilot-advanced-design.md`

## Global Constraints

- Do not alter lexical retrieval, retrieval queries, ranking, or citation formatting.
- Preserve `isDesktopOnly: false`; do not use Node/Electron-only APIs or unsupported iOS WebKit syntax.
- Preserve MIT license and existing provider/custom-provider behavior.
- Keep conversation Markdown in configurable vault path `Memory Copilot/Conversations` by default.
- Do not add Groq, embeddings, vector storage, or a broad mobile UI redesign.

---

### Task 1: Localization foundation and settings

**Files:**
- Create: `src/i18n/index.ts`, `src/i18n/it.ts`, `src/i18n/en.ts`, `src/i18n/zh.ts`, `tests/i18n.test.ts`
- Modify: `src/settings.ts`, `tests/settings.test.ts`

**Interfaces:**
- Produces `UiLanguage = "auto" | "it" | "en" | "zh"`, `resolveUiLanguage(preference, locale): "it" | "en" | "zh"`, and `createTranslator(language): (key: TranslationKey, variables?) => string`.
- Adds `language: UiLanguage` and `conversationFolder: string` to `WikiCopilotSettings`.

- [ ] **Step 1: Write failing locale and migration tests.**

```ts
expect(resolveUiLanguage("auto", "it-IT")).toBe("it");
expect(resolveUiLanguage("auto", "zh-Hans")).toBe("zh");
expect(resolveUiLanguage("auto", "fr-FR")).toBe("en");
expect(loadWikiCopilotSettings({ language: "invalid" }).language).toBe("auto");
expect(loadWikiCopilotSettings(undefined).conversationFolder).toBe("Memory Copilot/Conversations");
```

- [ ] **Step 2: Run the focused tests and verify they fail because locale helpers/settings fields do not exist.**

Run: `pnpm test -- tests/i18n.test.ts tests/settings.test.ts`

- [ ] **Step 3: Implement dictionaries, typed translator, settings defaults/migration, and the language/folder setting controls.**

```ts
export function resolveUiLanguage(preference: UiLanguage, locale?: string): ResolvedUiLanguage {
  if (preference !== "auto") return preference;
  const normalized = locale?.toLowerCase() ?? "";
  if (normalized.startsWith("it")) return "it";
  if (normalized.startsWith("zh")) return "zh";
  return "en";
}
```

- [ ] **Step 4: Run focused tests and lint.**

Run: `pnpm test -- tests/i18n.test.ts tests/settings.test.ts`; `pnpm lint`

- [ ] **Step 5: Commit.**

Run: `git add src/i18n src/settings.ts tests/i18n.test.ts tests/settings.test.ts && git commit -m "add localized settings foundation"`

### Task 2: Translate plugin and view copy

**Files:**
- Modify: `src/main.ts`, `src/settings.ts`, `src/ui/wiki-copilot-view.ts`
- Modify: `tests/settings.test.ts`, `tests/mobile-view-interactions.test.ts`

**Interfaces:**
- Consumes `createTranslator` and the persisted `settings.language` preference.
- Produces `plugin.t(key, variables?)` and `view.refreshConfigurationState()` that re-renders localized shell content.

- [ ] **Step 1: Write failing source/behavior tests for the language selector and translated welcome/composer labels.**

```ts
expect(definitions.flatMap((item) => item.items ?? []).some(
  (item) => item.control?.key === "language"
)).toBe(true);
expect(viewSource).toContain("this.plugin.t(");
```

- [ ] **Step 2: Run the focused tests and verify failure.**

Run: `pnpm test -- tests/settings.test.ts tests/mobile-view-interactions.test.ts`

- [ ] **Step 3: Replace hardcoded user-visible copy in the target modules with translation keys.**

```ts
titleGroup.createEl("h2", { text: this.plugin.t("app.name") });
this.queryEl.placeholder = this.plugin.t("chat.placeholder");
```

- [ ] **Step 4: Re-render open views after language preference changes and run focused tests.**

Run: `pnpm test -- tests/settings.test.ts tests/mobile-view-interactions.test.ts`

- [ ] **Step 5: Commit.**

Run: `git add src/main.ts src/settings.ts src/ui/wiki-copilot-view.ts tests && git commit -m "localize wiki copilot interface"`

### Task 3: Conversation Markdown format and vault store

**Files:**
- Create: `src/chat/conversation-types.ts`, `src/chat/conversation-markdown.ts`, `src/chat/conversation-store.ts`, `tests/conversation-markdown.test.ts`, `tests/conversation-store.test.ts`

**Interfaces:**
- Produces `Conversation`, `ConversationTurn`, `serializeConversation`, `parseConversation`, and `ConversationStore` with `list(folder)`, `load(path)`, and `save(folder, conversation)`.
- Store accepts an Obsidian vault-like dependency and uses vault APIs for folder creation and file changes.

- [ ] **Step 1: Write failing Markdown round-trip tests.**

```ts
const markdown = serializeConversation(conversation);
expect(parseConversation(markdown)).toEqual(conversation);
expect(parseConversation("# ordinary note")).toBeNull();
```

- [ ] **Step 2: Run test and verify parser/export failure.**

Run: `pnpm test -- tests/conversation-markdown.test.ts`

- [ ] **Step 3: Implement portable front matter plus ordered `## User`/`## Assistant` sections and safe timestamp/title filenames.**

```ts
export interface Conversation {
  id: string; createdAt: string; updatedAt: string; title: string; turns: ChatTurn[];
}
```

- [ ] **Step 4: Write failing store tests for default nested folder creation, updating an existing file, listing valid conversations, and ignoring malformed files.**

```ts
await store.save("Memory Copilot/Conversations", conversation);
expect(vault.createFolder).toHaveBeenCalledWith("Memory Copilot");
expect(vault.createFolder).toHaveBeenCalledWith("Memory Copilot/Conversations");
expect((await store.list("Memory Copilot/Conversations")).map((item) => item.id)).toEqual([conversation.id]);
```

- [ ] **Step 5: Implement the store with `normalizePath`, `vault.createFolder`, `vault.create`, `vault.modify`, and `vault.getMarkdownFiles`.**

- [ ] **Step 6: Run focused tests and commit.**

Run: `pnpm test -- tests/conversation-markdown.test.ts tests/conversation-store.test.ts`

Run: `git add src/chat tests/conversation-* && git commit -m "add vault-backed conversation storage"`

### Task 4: History UI and automatic persistence

**Files:**
- Modify: `src/ui/wiki-copilot-view.ts`, `src/main.ts`, `src/settings.ts`
- Create: `tests/conversation-view.test.ts`

**Interfaces:**
- Consumes `ConversationStore`, `settings.conversationFolder`, and localized strings.
- Produces `startNewConversation()`, `openConversation(path)`, `setProtocolQuery(query, send)`, and save-after-completion behavior.

- [ ] **Step 1: Write failing view tests for New chat/history controls, restoring stored turns, and saving only completed assistant replies.**

```ts
expect(viewSource).toContain("startNewConversation");
expect(viewSource).toContain("openConversation");
expect(viewSource).toContain("await this.saveConversation()");
```

- [ ] **Step 2: Run the focused test and verify failure.**

Run: `pnpm test -- tests/conversation-view.test.ts`

- [ ] **Step 3: Integrate current conversation state and history list into the view.**

```ts
private conversation: Conversation | null = null;
private async saveConversation(): Promise<void> {
  if (this.conversation?.turns.length) {
    await this.plugin.conversations.save(this.plugin.settings.conversationFolder, this.conversation);
  }
}
```

- [ ] **Step 4: Keep failed/cancelled partial replies out of persisted turn context, surface localized vault errors, and run focused tests.**

Run: `pnpm test -- tests/conversation-view.test.ts tests/conversation-store.test.ts`

- [ ] **Step 5: Commit.**

Run: `git add src/main.ts src/settings.ts src/ui/wiki-copilot-view.ts tests/conversation-view.test.ts && git commit -m "add persistent chat history"`

### Task 5: Preserve the chat while opening sources

**Files:**
- Modify: `src/main.ts`, `src/ui/temporary-leaf-controller.ts`
- Modify: `tests/citation-open-state.test.ts`, `tests/temporary-leaf-controller.test.ts`

**Interfaces:**
- Consumes the dedicated `citationPreview` controller.
- Produces citation opening in a non-chat leaf and leaves the active Wiki Copilot leaf untouched.

- [ ] **Step 1: Write a failing test that asserts the source preview leaf is acquired separately and opens in reading mode with its heading.**

```ts
expect(citationOpenState("#Section").state).toEqual({ mode: "preview" });
expect(controller.acquire(createLeaf, attached).leaf).not.toBe(chatLeaf);
```

- [ ] **Step 2: Run focused tests and verify failure or missing coverage.**

Run: `pnpm test -- tests/citation-open-state.test.ts tests/temporary-leaf-controller.test.ts`

- [ ] **Step 3: Acquire the citation leaf with `workspace.getLeaf("tab")`, never reuse the active Wiki Copilot leaf, and retain the existing queue/discard cleanup semantics.**

- [ ] **Step 4: Run focused tests and a mobile view regression test.**

Run: `pnpm test -- tests/citation-open-state.test.ts tests/temporary-leaf-controller.test.ts tests/mobile-view-interactions.test.ts`

- [ ] **Step 5: Commit.**

Run: `git add src/main.ts src/ui/temporary-leaf-controller.ts tests && git commit -m "preserve chat when opening citations"`

### Task 6: Siri/Shortcuts protocol handler

**Files:**
- Create: `src/obsidian/wiki-copilot-protocol.ts`, `tests/wiki-copilot-protocol.test.ts`
- Modify: `src/main.ts`, `src/ui/wiki-copilot-view.ts`

**Interfaces:**
- Produces `parseWikiCopilotProtocol(params): { query: string; newChat: boolean; send: boolean } | null`.
- Registers `registerObsidianProtocolHandler("wiki-copilot-advanced", handler)` and hands valid requests to the active view.

- [ ] **Step 1: Write failing parser tests for URL-decoded query, explicit boolean flags, absent query, and invalid boolean values.**

```ts
expect(parseWikiCopilotProtocol({ query: "riduttore Rossi", send: "true" }))
  .toEqual({ query: "riduttore Rossi", newChat: false, send: true });
expect(parseWikiCopilotProtocol({})).toBeNull();
```

- [ ] **Step 2: Run the focused test and verify failure.**

Run: `pnpm test -- tests/wiki-copilot-protocol.test.ts`

- [ ] **Step 3: Implement parsing and protocol registration after view registration, activate/reveal the view, then insert and optionally send the query.**

```ts
this.registerObsidianProtocolHandler("wiki-copilot-advanced", async (params) => {
  const request = parseWikiCopilotProtocol(params);
  if (!request) return;
  await this.activateView();
  this.getOpenView()?.setProtocolQuery(request.query, request.newChat, request.send);
});
```

- [ ] **Step 4: Run parser and view regression tests.**

Run: `pnpm test -- tests/wiki-copilot-protocol.test.ts tests/conversation-view.test.ts tests/mobile-view-interactions.test.ts`

- [ ] **Step 5: Commit.**

Run: `git add src/obsidian/wiki-copilot-protocol.ts src/main.ts src/ui/wiki-copilot-view.ts tests && git commit -m "add shortcuts protocol handler"`

### Task 7: Full verification

**Files:**
- Modify only if verification exposes a scoped regression.

- [ ] **Step 1: Run the complete static and behavioral checks.**

Run: `pnpm lint`; `pnpm test`; `pnpm build`

- [ ] **Step 2: Confirm retrieval source files and tests are unchanged except for localization-only copy.**

Run: `git diff -- src/core src/llm tests/retriever.test.ts tests/retrieval-query.test.ts`

- [ ] **Step 3: Inspect the final diff, report exact modified files and any unavailable manual Obsidian mobile check, then commit verification fixes if required.**
