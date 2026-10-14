# Adjacent Source Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include the next section of a selected Markdown source in precise retrieval when it fits the current context budget.

**Architecture:** The precise full-Markdown path already extracts ranked, heading-aware chunks per candidate note. Add a post-selection helper in the same module that finds a selected chunk's immediate sibling from the same extracted note, preserves ordering and deduplication, and respects `maxContextCharacters`.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin APIs.

**Spec:** `docs/superpowers/specs/2026-10-14-adjacent-source-context-design.md`

## Global Constraints

- Keep `isDesktopOnly: false` and use no Node/Electron-only runtime API.
- Do not modify generated `main.js` manually.
- Preserve exact citations, paths, headings, and current context-size limits.
- Do not expand to another note or beyond one following sibling per selected chunk.

---

### Task 1: Adjacent-section regression coverage

**Files:**
- Modify: `tests/full-markdown-search.test.ts`
- Modify: `src/obsidian/index-coordinator.ts`

**Interfaces:**
- Consumes: `IndexCoordinator.retrieveAllMarkdown(query, searchQueries, options)`.
- Produces: a retrieval result whose `chunks` includes one immediate same-note sibling after a selected chunk.

- [ ] **Step 1: Write the failing test**

Add a Markdown fixture with a `Matrice base` section containing `VO2max` and a following `Peso del penultimo allenamento e correttivi` section without `VO2max`. Assert that a precise retrieval query containing `VO2max` returns both headings in order.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/full-markdown-search.test.ts`

Expected: FAIL because only `Matrice base` is selected.

- [ ] **Step 3: Implement the minimal expansion**

Add an internal helper in the precise retrieval path that obtains the sibling with `chunkIndex + 1` from the same `MarkdownChunk[]`, skips an already selected ID, and appends it only if its text fits `maxContextCharacters`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm vitest run tests/full-markdown-search.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/obsidian/index-coordinator.ts tests/full-markdown-search.test.ts docs/superpowers
git commit -m "fix: include adjacent source context"
```

### Task 2: Regression verification

**Files:**
- Test: `tests/full-markdown-search.test.ts`

**Interfaces:**
- Consumes: the adjacent-section expansion from Task 1.
- Produces: confirmation that retrieval ranking and build behavior still pass the project suite.

- [ ] **Step 1: Run the full quality gate**

Run: `pnpm check`

Expected: lint, Vitest, and production build all pass.

- [ ] **Step 2: Commit any formatting-only correction required by the quality gate**

```powershell
git add src/obsidian/index-coordinator.ts tests/full-markdown-search.test.ts
git commit -m "test: verify adjacent source context"
```
