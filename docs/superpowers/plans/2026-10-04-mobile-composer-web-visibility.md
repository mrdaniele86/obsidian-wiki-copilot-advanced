# Mobile Composer and Web Action Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the unavailable Web action and remove the phone composer gap while preserving safe-area and navbar protection.

**Architecture:** `WikiCopilotView` owns a Web-action state helper, used during initial rendering, busy changes, and settings refresh. Styles retain the measured phone navbar clearance but place it inside composer padding instead of outside composer margin.

**Tech Stack:** TypeScript, Obsidian view API, CSS, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-04-mobile-composer-web-visibility-design.md`

## Global Constraints

- Normal Send and Vault search behavior must remain unchanged.
- Web search remains explicit and consent-gated.
- Preserve the enabled compact Web control, 72px width, and 44px phone target.
- Preserve navbar measurement and `env(safe-area-inset-bottom)` protection.
- Do not add keyboard transforms or viewport-lift CSS.

---

### Task 1: Composer availability and phone layout

**Files:**
- Modify: `src/ui/wiki-copilot-view.ts: Web button construction, refresh, and busy state`
- Modify: `styles.css: phone composer rule`
- Modify: `tests/mobile-view-interactions.test.ts: Web action state assertions`
- Modify: `tests/mobile-styles.test.ts: phone composer spacing assertions`

**Interfaces:**
- Consumes: `this.plugin.settings.webSearch.mode`, `this.busy`, and `this.webSearchButton`.
- Produces: `syncWebSearchButtonState(): void`, which uses native `hidden` and `disabled` state.

- [ ] **Step 1: Write the failing tests**

Add source-level assertions requiring `syncWebSearchButtonState`, an assignment to `this.webSearchButton.hidden` for `mode !== "dedicated-gemini"`, and phone CSS with no `margin-bottom` plus padding that combines `env(safe-area-inset-bottom)` and `--wiki-copilot-mobile-nav-clearance`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm test -- tests/mobile-view-interactions.test.ts tests/mobile-styles.test.ts`

Expected: FAIL because the helper and new padding contract do not exist.

- [ ] **Step 3: Write the minimal implementation**

Add the helper below, then call it after Web-button construction, from configuration refresh, and from `setBusy`; remove duplicate direct disabled assignments.

```ts
private syncWebSearchButtonState(): void {
  const available = this.plugin.settings.webSearch.mode === "dedicated-gemini";
  this.webSearchButton.hidden = !available;
  this.webSearchButton.disabled = !available || this.busy;
}
```

Replace phone composer `margin-bottom` with:

```css
padding-bottom: max(
  8px,
  env(safe-area-inset-bottom),
  var(--wiki-copilot-mobile-nav-clearance, var(--view-bottom-spacing, 0px))
);
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm test -- tests/mobile-view-interactions.test.ts tests/mobile-styles.test.ts`

Expected: PASS.

- [ ] **Step 5: Run focused lint and commit**

Run: `pnpm lint -- src/ui/wiki-copilot-view.ts tests/mobile-view-interactions.test.ts tests/mobile-styles.test.ts`

Expected: PASS.

Commit files `src/ui/wiki-copilot-view.ts`, `styles.css`, and the two focused test files with message `fix mobile composer and web action visibility`.

### Task 2: Full regression verification

**Files:**
- No production-file changes expected.

**Interfaces:**
- Consumes: completed Task 1 behavior.
- Produces: a verified release-quality result.

- [ ] **Step 1: Run the complete quality suite**

Run: `pnpm check`

Expected: all tests, lint, and production build pass.

- [ ] **Step 2: Run BRAT packaging validation**

Run the repository's documented BRAT validation command and confirm `manifest.json`, `main.js`, and `styles.css` are deployable.

- [ ] **Step 3: Review the final diff**

Run: `git diff HEAD~1..HEAD -- src/ui/wiki-copilot-view.ts styles.css tests/mobile-view-interactions.test.ts tests/mobile-styles.test.ts`

Expected: only the specified visibility and phone-spacing behavior changes.
