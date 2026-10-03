# Fuzzy History Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users search saved conversations fuzzily by title, user question, or assistant response from a mobile-friendly header action.

**Architecture:** A pure chat search module normalizes and scores `StoredConversation` data from the existing vault store. `WikiCopilotView` owns the search control and temporary panel, and uses the existing conversation restore path when a result is selected.

**Tech Stack:** TypeScript, Obsidian DOM API, Vitest, ESLint, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-03-fuzzy-history-search-design.md`

## Global Constraints

- Search only existing conversation Markdown through `ConversationStore.list`; do not add an index, dependency, or vault file.
- Preserve conversation content, citation state, history deletion, and mobile compatibility.
- Keep all new visible copy localized in Italian, English, and Chinese.
- Do not modify retrieval, provider behavior, citation format, or the persistent Markdown format.

---

### Task 1: Pure fuzzy conversation matcher

**Files:**
- Create: `src/chat/conversation-search.ts`, `tests/conversation-search.test.ts`

**Interfaces:**
- Consumes: `StoredConversation` from `src/chat/conversation-types.ts`.
- Produces: `searchConversations(conversations, query): ConversationSearchResult[]`, where each result includes `stored`, `score`, `excerpt`, and `matchedField`.

- [ ] **Step 1: Write failing matcher tests.**

```ts
expect(searchConversations(items, "pncake").map((item) => item.stored.conversation.id))
  .toEqual(["pancake-chat"]);
expect(searchConversations(items, "senape")[0].excerpt).toContain("senape");
expect(searchConversations(items, "").map((item) => item.stored.conversation.id))
  .toEqual(["newest", "older"]);
expect(searchConversations(items, "missing")).toEqual([]);
```

- [ ] **Step 2: Verify red.**

Run: `pnpm test -- tests/conversation-search.test.ts`

Expected: FAIL because `conversation-search` does not exist.

- [ ] **Step 3: Implement normalization, score, excerpts, and sorting.**

```ts
export function searchConversations(
  conversations: StoredConversation[],
  query: string
): ConversationSearchResult[] {
  // Empty query keeps newest-first order; otherwise return each conversation's
  // strongest title, user-turn, or assistant-turn fuzzy match.
}
```

Normalize case, accents, punctuation, and whitespace. Score ordered subsequence matches with bonuses for adjacent letters and word starts. Generate excerpts around matching content, trim to a fixed readable length, and sort ties by `updatedAt` descending.

- [ ] **Step 4: Verify green and lint.**

Run: `pnpm test -- tests/conversation-search.test.ts`; `pnpm lint`

- [ ] **Step 5: Commit.**

Run: `git add src/chat/conversation-search.ts tests/conversation-search.test.ts && git commit -m "add fuzzy conversation search"`

### Task 2: Search panel and localized mobile UI

**Files:**
- Modify: `src/ui/wiki-copilot-view.ts`, `src/i18n/en.ts`, `src/i18n/it.ts`, `src/i18n/zh.ts`, `styles.css`
- Modify: `tests/conversation-view.test.ts`, `tests/mobile-view-interactions.test.ts`

**Interfaces:**
- Consumes: `searchConversations` and `ConversationStore.list(folder)`.
- Produces: an accessible Search header action, focused search input, ranked result list, localized no-match state, and selected-result restore behavior.

- [ ] **Step 1: Write failing UI behavior/source tests.**

```ts
expect(viewSource).toContain('setIcon(this.historySearchToggle, "search")');
expect(viewSource).toContain("searchConversations(conversations, this.historySearchQuery)");
expect(viewSource).toContain("this.historySearchInput.focus()");
expect(viewSource).toContain("await this.openConversation(result.stored.path)");
```

- [ ] **Step 2: Verify red.**

Run: `pnpm test -- tests/conversation-view.test.ts tests/mobile-view-interactions.test.ts`

Expected: FAIL because no search action or search-state path exists.

- [ ] **Step 3: Implement panel state and interaction.**

Add a search icon beside rebuild/history. Toggling it opens the existing temporary panel, focuses its text input, and renders normal newest-first history before input. On input, replace list rows with fuzzy results including title and excerpt. Use the existing `openConversation` method on selection and close the panel. Reuse outside-pointer close behavior; do not close on interaction inside the panel.

- [ ] **Step 4: Add localized copy and compact responsive styles.**

Add keys for search label, input placeholder, no results, and result excerpt accessibility. Ensure the input/result rows fit the existing mobile panel, retain 44px touch targets, and do not reintroduce history-row overlap.

- [ ] **Step 5: Verify green and commit.**

Run: `pnpm test -- tests/conversation-view.test.ts tests/mobile-view-interactions.test.ts tests/conversation-search.test.ts`; `pnpm lint`; `pnpm build`

Run: `git add src/ui/wiki-copilot-view.ts src/i18n styles.css tests && git commit -m "add fuzzy history search panel"`

### Task 3: End-to-end regression verification

**Files:**
- Modify only where verification finds a scoped defect.

- [ ] **Step 1: Run full checks.**

Run: `pnpm test`; `pnpm lint`; `pnpm build`

- [ ] **Step 2: Inspect scope.**

Run: `git diff -- src/core src/llm tests/retriever.test.ts tests/retrieval-query.test.ts`

Confirm the search feature did not change retrieval or provider behavior.

- [ ] **Step 3: Commit verification-only fixes if required.**

Run: `git add <scoped-files> && git commit -m "verify fuzzy history search"`
