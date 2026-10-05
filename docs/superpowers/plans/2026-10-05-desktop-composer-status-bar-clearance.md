# Desktop Composer Status Bar Clearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the desktop Send button above Obsidian's status bar without changing mobile composer behavior.

**Architecture:** Add one desktop-only bottom-padding rule in `styles.css`, using an Obsidian status-bar CSS variable with zero fallback. Protect it with a CSS source regression test.

**Tech Stack:** CSS, Vitest, TypeScript build verification.

**Spec:** `docs/superpowers/specs/2026-10-05-desktop-composer-status-bar-clearance-design.md`

## Global Constraints

- Use the existing worktree and branch; do not reset, publish, tag or push.
- Do not alter mobile composer selectors or behavior.
- Do not alter normal Send behavior.

### Task 1: Reserve desktop status-bar clearance

**Files:**
- Modify: `styles.css`
- Create: `tests/styles-composer-clearance.test.ts`

- [ ] **Step 1: Write a failing source regression test.** Read `styles.css`; assert the desktop composer rule includes a bottom padding expression referencing `--status-bar-height` with a zero fallback, while the mobile composer rule remains separately scoped under `body.is-mobile`.
- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/styles-composer-clearance.test.ts`; expect the missing desktop status-bar expression.
- [ ] **Step 3: Add the minimum CSS.** Extend only `.wiki-copilot-composer` desktop padding-bottom with `var(--status-bar-height, 0px)` using `max()`.
- [ ] **Step 4: Run GREEN.** Repeat the focused test; require it passes.
- [ ] **Step 5: Verify.** Run `pnpm check`, `pnpm verify:brat-beta`, and `git diff --check`; inspect the CSS diff and stop for release approval.
