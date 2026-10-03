# Citation Return to Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return from a citation preview to the exact originating Wiki Copilot chat leaf on mobile and desktop.

**Architecture:** The plugin associates its reusable citation-preview leaf with an attached originating chat leaf. A preview-only localized action reveals that leaf; it never delegates to `activateView`, so it cannot create or reset a chat.

**Tech Stack:** TypeScript, Obsidian workspace API, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-citation-return-to-chat-design.md`

## Global Constraints

- Preserve citation retrieval, formatting, reading mode, and heading navigation.
- Never create a new Wiki Copilot leaf when returning from a source.
- Preserve mobile compatibility and all localized visible copy.

---

### Task 1: Origin-aware citation return

**Files:**
- Modify: `src/main.ts`, `src/ui/wiki-copilot-view.ts`, `src/i18n/en.ts`, `src/i18n/it.ts`, `src/i18n/zh.ts`
- Modify: `tests/citation-open-state.test.ts`, `tests/temporary-leaf-controller.test.ts`, `tests/mobile-view-interactions.test.ts`

**Interfaces:**
- Produces `openCitation(file, subpath, originLeaf)` and a preview return action that calls `workspace.revealLeaf(originLeaf)` only after confirming the origin is attached and has a Wiki Copilot view.

- [ ] **Step 1: Write failing origin-return tests.**

```ts
await plugin.openCitation(file, "#Section", chatLeaf);
await previewReturn();
expect(workspace.revealLeaf).toHaveBeenCalledWith(chatLeaf);
expect(workspace.getLeavesOfType(WIKI_COPILOT_VIEW_TYPE)).toContain(chatLeaf);
```

Add a detached-origin test that expects a localized Notice and no new `getLeaf` or `setViewState` call.

- [ ] **Step 2: Verify red.**

Run: `pnpm test -- tests/citation-open-state.test.ts tests/temporary-leaf-controller.test.ts tests/mobile-view-interactions.test.ts`

- [ ] **Step 3: Pass the source view leaf and retain origin association.**

When `WikiCopilotView` opens a citation, pass `this.leaf`. Store it only for the active reusable preview. Validate it with workspace leaf traversal and `instanceof WikiCopilotView` before reveal.

- [ ] **Step 4: Render the preview-only return action.**

Add localized `view.returnToChat` and `view.returnToChatUnavailable` strings. Install the action in the citation preview lifecycle, use a 44px mobile touch target, and ensure it does not appear in ordinary note leaves.

- [ ] **Step 5: Verify green and commit.**

Run: `pnpm test -- tests/citation-open-state.test.ts tests/temporary-leaf-controller.test.ts tests/mobile-view-interactions.test.ts`; `pnpm lint`; `pnpm build`

Run: `git add src/main.ts src/ui/wiki-copilot-view.ts src/i18n tests && git commit -m "return to chat from citation previews"`
