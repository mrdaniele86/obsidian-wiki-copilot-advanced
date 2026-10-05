# Context Priority and Groq Request Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve enabled recent context ahead of RAG evidence, prevent workout notation from activating the identifier guard, and bound Groq planner plus answer capacity under one TPM allocation.

**Architecture:** Select immutable system/question content first, then newest history, then ranked evidence. Keep general identifier extraction for retrieval but introduce strong identifiers solely for the hard no-substitution boundary. Resolve an exact-Groq action allocation before planning retrieval, and reserve explicit planner and answer output capacities from it. Keep non-Groq requests unchanged.

**Tech Stack:** TypeScript, Vitest, Obsidian CSS, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-05-context-priority-groq-request-budget-design.md`

## Global Constraints

- Use existing branch `feature/i18n-history`; no worktree.
- Do not mutate settings, persisted conversations, normal Enter behavior, Vault retrieval, consent, or Web Search.
- Detect Groq only at hostname `api.groq.com`; generic custom endpoints retain automatic payload behavior.
- Do not edit generated `main.js`, add automatic retries, tag, publish, or push.
- Every production change begins with a failing test.

---

### Task 1: Preserve recent context before RAG evidence

**Files:**
- Modify: `src/llm/prompt-budget.ts:99-157`
- Modify: `tests/prompt-budget.test.ts:70-111`

**Interfaces:**
- Consumes: `planPromptBudget(input: PromptBudgetInput): PromptBudgetPlan`.
- Produces: messages ordered as system, selected history, question, selected evidence.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps the newest workout context before large RAG evidence", () => {
  const history = [
    { role: "user" as const, content: "Ho fatto un allenamento 8x300 e poi Tempo." },
    { role: "assistant" as const, content: "Il penultimo è 8x300 e l'ultimo è Tempo." }
  ];
  const plan = planPromptBudget({
    systemPrompt: "System rules.",
    question: "Ok, invece successivamente, cosa potrei fare?",
    history,
    evidence: Array.from({ length: 17 }, (_, i) => `<wiki-copilot-source id="S${i + 1}" role="source">${"Evidence ".repeat(900)}</wiki-copilot-source>`),
    limitTokens: 7_000
  });
  const text = plan.messages.map((message) => message.content).join("\n");
  expect(text).toContain(history[0].content);
  expect(text).toContain(history[1].content);
  expect(text).toContain('<wiki-copilot-source id="S1"');
  expect(plan.usedTokens).toBeLessThanOrEqual(Math.floor(7_000 * 0.88));
});
```

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run tests/prompt-budget.test.ts`

Expected: FAIL because the current selector allocates initial evidence before history.

- [ ] **Step 3: Implement the minimal selector change**

Build `selectedHistory` immediately after system/question, walking from newest backward. Only then add evidence in rank order with `evidenceWithinBudget`; never evict selected history to admit subsequent evidence. Keep complete source wrappers and the existing safety margin.

- [ ] **Step 4: Run green test**

Run: `pnpm vitest run tests/prompt-budget.test.ts`

Expected: PASS; recent pair and source wrapper survive while lower-ranked evidence is omitted or shortened.

- [ ] **Step 5: Commit**

```bash
git add src/llm/prompt-budget.ts tests/prompt-budget.test.ts
git commit -m "prioritize recent context in prompt budgets"
```

### Task 2: Limit the hard identifier guard to strong identifiers

**Files:**
- Modify: `src/core/tokenizer.ts:111-127`
- Modify: `src/core/retrieval-query.ts:153-190`
- Modify: `src/main.ts:530-540`
- Modify: `src/i18n/it.ts`, `src/i18n/en.ts`, `src/i18n/zh.ts`
- Modify: `tests/tokenizer.test.ts`, `tests/retrieval-query.test.ts`

**Interfaces:**
- Consumes: `technicalIdentifierTokens` for normal retrieval ranking.
- Produces: `strictTechnicalIdentifierTokens` for no-substitution boundaries and localized missing-identifier presentation.

- [ ] **Step 1: Write failing tests**

```ts
expect(strictTechnicalIdentifierTokens("Ho fatto 8x300 poi Tempo")).toEqual([]);
expect(strictTechnicalIdentifierTokens("tutti i dati MS6")).toEqual(["ms6"]);
expect(strictTechnicalIdentifierTokens("PCBA-001 acceptance")).toContain("pcba001");
expect(exactIdentifierMissingMessage("Ho fatto 8x300 poi Tempo")).toBeNull();
expect(exactIdentifierMissingMessage("tutti i dati MS6")).not.toBeNull();
```

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run tests/tokenizer.test.ts tests/retrieval-query.test.ts`

Expected: FAIL because `8x300` currently qualifies as a technical identifier.

- [ ] **Step 3: Implement the minimal guard split**

Export `strictTechnicalIdentifierTokens` from `tokenizer.ts`: retain only letter-led tokens with at least two letters and at least one digit. Use it in `hasTechnicalIdentifierAnchor`, `discardUnanchoredTechnicalResult`, `exactIdentifierMissingMessage`, and `keepTechnicalIdentifierFamily`; retain the old extractor for lexical search. Move fallback copy from core Chinese literals to IT/EN/ZH UI translations selected in `main.ts`.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run tests/tokenizer.test.ts tests/retrieval-query.test.ts`

Expected: PASS; `8x300` reaches normal handling, while MS6 and PCBA-001 remain protected.

- [ ] **Step 5: Commit**

```bash
git add src/core/tokenizer.ts src/core/retrieval-query.ts src/main.ts src/i18n tests/tokenizer.test.ts tests/retrieval-query.test.ts
git commit -m "avoid treating workout notation as strict identifiers"
```

### Task 3: Allocate one Groq budget across planner and answer

**Files:**
- Modify: `src/llm/prompt-budget.ts`
- Modify: `src/llm/openai-compatible.ts:350-482`
- Modify: `src/llm/completion-request.ts`
- Modify: `tests/prompt-budget.test.ts`, `tests/openai-compatible-stream.test.ts`, `tests/completion-request.test.ts`

**Interfaces:**
- Produces: `groqActionBudget(...)` with planner input/output and answer input/output reservations.

- [ ] **Step 1: Write failing test**

```ts
it("keeps Groq planner and answer reservations within one 8000 TPM action", async () => {
  // Invoke planRetrievalQueries then answer with automatic Groq settings.
  // Read both sent JSON bodies.
  expect(planner.max_tokens).toBeLessThanOrEqual(256);
  expect(answer.max_tokens).toBe(512);
  expect(estimatePromptTokens(planner.messages) + planner.max_tokens + estimatePromptTokens(answer.messages) + answer.max_tokens).toBeLessThanOrEqual(8_000);
});
```

Add a control that a non-Groq custom endpoint still has no automatic `max_tokens`.

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run tests/prompt-budget.test.ts tests/openai-compatible-stream.test.ts tests/completion-request.test.ts`

Expected: FAIL because planner and answer currently receive independent budgets.

- [ ] **Step 3: Implement minimal action allocation**

Add a pure helper with 8,000 automatic TPM, 256 planner output, 512 answer output, and the existing safety margin. Bound planner history/input with its reserved share and explicit `max_tokens`; apply the residual to the answer prompt. Throw `input-too-large` before dispatch if immutable input cannot fit. Keep all non-Groq paths byte-for-byte equivalent in behavior.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run tests/prompt-budget.test.ts tests/openai-compatible-stream.test.ts tests/completion-request.test.ts`

Expected: PASS; combined local reservations fit TPM and custom endpoints are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/llm/prompt-budget.ts src/llm/openai-compatible.ts src/llm/completion-request.ts tests/prompt-budget.test.ts tests/openai-compatible-stream.test.ts tests/completion-request.test.ts
git commit -m "budget Groq planner and answer together"
```

### Task 4: Report budget/citation state accurately

**Files:**
- Modify: `src/main.ts:509-570`, `src/ui/wiki-copilot-view.ts:811-900`
- Modify: `src/i18n/it.ts`, `src/i18n/en.ts`, `src/i18n/zh.ts`
- Modify: `tests/main-contextual-followup.test.ts`
- Create: `tests/model-response-grounding.test.ts`

- [ ] **Step 1: Write failing tests**

Assert an enabled-context follow-up with 17 sources sends the `8x300 → Tempo` pair to the model. Add a response test where sources exist but the markdown has no `[S#]`: it keeps source inspection and warning but is presented as general/ungrounded.

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run tests/main-contextual-followup.test.ts tests/model-response-grounding.test.ts`

Expected: FAIL because current UI retains knowledge-base-backed presentation for an uncited response.

- [ ] **Step 3: Implement minimal presentation change**

Extend Groq progress payload and IT/EN/ZH strings to show planner + input + output / TPM. At finalization, set only presentation `knowledgeBaseHit` false when evidence exists but citation validation fails; preserve sources, markdown, and stored conversation data; do not retry.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run tests/main-contextual-followup.test.ts tests/model-response-grounding.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/ui/wiki-copilot-view.ts src/i18n tests/main-contextual-followup.test.ts tests/model-response-grounding.test.ts
git commit -m "clarify Groq budgets and uncited answer state"
```

### Task 5: Keep desktop Send above the status bar

**Files:**
- Modify: `styles.css`
- Modify: `tests/styles-composer-clearance.test.ts`

- [ ] **Step 1: Write failing CSS test**

Assert that desktop `.wiki-copilot-composer` bottom padding adds `var(--status-bar-height, 0px)` to ordinary spacing and that the `body.is-mobile` composer block is unchanged.

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run tests/styles-composer-clearance.test.ts`

Expected: FAIL if clearance uses a maximum rather than enough additive space to move the entire action row above the status bar.

- [ ] **Step 3: Implement minimal CSS change**

Set desktop bottom padding to:

```css
padding-bottom: calc(var(--size-4-3) + var(--status-bar-height, 0px) + var(--view-bottom-spacing, 0px));
```

Keep the existing mobile selector unchanged.

- [ ] **Step 4: Run green test**

Run: `pnpm vitest run tests/styles-composer-clearance.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add styles.css tests/styles-composer-clearance.test.ts
git commit -m "keep desktop send action above status bar"
```

### Task 6: Verify and review

- [ ] **Step 1: Run focused suite**

Run: `pnpm vitest run tests/prompt-budget.test.ts tests/tokenizer.test.ts tests/retrieval-query.test.ts tests/openai-compatible-stream.test.ts tests/completion-request.test.ts tests/main-contextual-followup.test.ts tests/model-response-grounding.test.ts tests/styles-composer-clearance.test.ts`

Expected: PASS.

- [ ] **Step 2: Run release gates**

Run: `pnpm check` then `pnpm verify:brat-beta`

Expected: both PASS.

- [ ] **Step 3: Inspect scope**

Run: `git diff --check HEAD~5..HEAD`, `git status --short`, and `git log --oneline -6`.

Expected: no whitespace errors or unrelated files.

- [ ] **Step 4: Ask for release authorization**

Report the final diff and test results. Do not create a version, beta, tag, GitHub release, or push without new explicit confirmation.
