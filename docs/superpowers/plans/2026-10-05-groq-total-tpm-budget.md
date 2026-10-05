# Groq Total TPM Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable Groq account TPM cap that safely coordinates the existing prompt-input and completion-output limits, and explain both limits clearly in settings.

**Architecture:** Extend the validated model settings with a Groq-only total TPM value. The prompt-budget module derives an input allocation after reserving configured output, then applies its existing margin and pruning. The settings UI exposes the calculated relationship; localized output-length copy remains separate from TPM handling.

**Tech Stack:** TypeScript, Obsidian declarative settings, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-groq-total-tpm-budget-design.md`

## Global Constraints

- Use existing branch/worktree `feature/i18n-history`; do not reset or create a worktree.
- Do not change normal Send, Vault retrieval ranking, consent, Web search, saved conversations or persisted retrieval settings.
- Recognize Groq only when the normalized endpoint hostname is exactly `api.groq.com`.
- Keep `automatic` persisted for the TPM setting; automatic means 8000 only for Groq.
- Do not publish, tag or push without explicit confirmation after full review.

---

### Task 1: Add the pure total-TPM allocation contract

**Files:**
- Modify: `src/llm/prompt-budget.ts`
- Test: `tests/prompt-budget.test.ts`

**Interfaces:**
- Produces a pure `effectivePromptLimit(inputLimit, outputLimit, totalTpm)` result used only for Groq planned requests.
- The result reserves output before planner safety margin and never mutates inputs.

- [ ] **Step 1: Write failing tests.** Add cases where Groq automatic TPM `8000` with output `4000` caps the pre-margin prompt allocation at `4000`; a configured TPM `12000` with output `2048` caps it at `9952`; non-Groq has no total-TPM cap; and required prompt content still reports over-budget rather than truncating the question.

- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/prompt-budget.test.ts`; expect a missing allocation export or mismatched planned limit.

- [ ] **Step 3: Implement the minimum pure allocation.** Parse `automatic` as 8000 only after exact Groq detection, subtract the configured output maximum, reject non-positive input capacity, then pass the resulting limit into the existing planner without changing its 12% margin.

- [ ] **Step 4: Run focused green.** Run `pnpm exec vitest run tests/prompt-budget.test.ts`; require all prompt-budget tests to pass.

- [ ] **Step 5: Commit.** Run `git add src/llm/prompt-budget.ts tests/prompt-budget.test.ts && git commit -m "budget groq total tpm"`.

### Task 2: Persist and expose the account TPM setting

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/i18n/it.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- `ModelSettings.groqTotalTokensPerMinute: TokenLimitSetting` defaults to `"automatic"`.
- Settings keys expose the field only alongside Groq guidance and retain supported numeric/custom validation.

- [ ] **Step 1: Write failing settings and translation tests.** Assert migration turns absent/malformed data into `"automatic"`, preserves valid `8000`, each locale provides the TPM label/description/help keys, and the existing locale-key parity test stays green.

- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/settings.test.ts`; expect the missing model property and locale keys.

- [ ] **Step 3: Implement setting and copy.** Add the setting to defaults, load validation, accessor and setter paths. Add a text control with localized TPM description explaining input plus output; retain `automatic` as the saved value rather than writing `8000` into settings.

- [ ] **Step 4: Run focused green.** Run `pnpm exec vitest run tests/settings.test.ts`; require all tests pass.

- [ ] **Step 5: Commit.** Run `git add src/settings.ts src/i18n/it.ts src/i18n/en.ts src/i18n/zh.ts tests/settings.test.ts && git commit -m "add groq tpm setting"`.

### Task 3: Wire the request, settings feedback and output-length explanation

**Files:**
- Modify: `src/llm/openai-compatible.ts`
- Modify: `src/ui/wiki-copilot-view.ts`
- Modify: `src/ui/model-response-localization.ts`
- Modify: `src/i18n/it.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Test: `tests/openai-compatible-stream.test.ts`
- Test: `tests/model-response-localization.test.ts`

**Interfaces:**
- Planned Groq requests report input allocation, output reservation and total TPM through an existing non-persistent view callback.
- `view.model.lengthWarning` explicitly refers to the output setting.

- [ ] **Step 1: Write failing integration tests.** Assert a Groq request with TPM `8000`, input/output `4000` sends no more than the safe planned prompt budget plus `max_tokens: 4000`; a custom endpoint with the same numeric setting retains its old request; and the localized length warning tells the user it concerns maximum output tokens without exposing provider data.

- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts`; expect the missing TPM allocation/reporting and old warning copy.

- [ ] **Step 3: Implement wiring.** Pass the new setting into Groq request preparation, expose only numeric budget telemetry to the view, render a localized Groq budget line, and update all three output-length messages. Do not add automatic retries or change recovery behavior.

- [ ] **Step 4: Run focused green.** Repeat Step 2 and require all tests pass.

- [ ] **Step 5: Commit.** Run `git add src/llm/openai-compatible.ts src/ui/wiki-copilot-view.ts src/ui/model-response-localization.ts src/i18n/it.ts src/i18n/en.ts src/i18n/zh.ts tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts && git commit -m "explain groq tpm and output limits"`.

### Task 4: Review and release gate

**Files:**
- Modify only files needed for verified test failures.

- [ ] **Step 1: Run required verification.** Run `pnpm check` and `pnpm verify:brat-beta`.
- [ ] **Step 2: Review scope.** Run `git diff --check`, inspect the full diff and confirm no raw provider detail, endpoint-generic change, persisted settings mutation or generated-file source edit.
- [ ] **Step 3: Stop for approval.** Report the results. Do not publish, tag or push.
