# Groq Token Budget and Conversation Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, configurable input/output budgets, Groq-safe failures and opt-in normal conversation context while preserving normal Vault retrieval and saved history.

**Architecture:** A pure prompt-budget module owns provider detection, conservative token estimation and atomic evidence/history selection. Settings select limits and context mode. `main.ts` gates ordinary history, while the OpenAI-compatible client builds a planned request and classifies provider errors; the view renders localized recovery only for an input-size failure.

**Tech Stack:** TypeScript, Obsidian declarative settings, Vitest, OpenAI-compatible streaming client.

**Spec:** `docs/superpowers/specs/2026-10-05-groq-token-budget-and-conversation-context-design.md`

## Global Constraints

- Work only in existing branch/worktree `feature/i18n-history`; do not reset, publish, tag or push.
- Preserve normal Send, Vault retrieval ranking, consent and explicit Web search behavior.
- Do not modify `main.js` directly, saved conversations, or persisted retrieval settings during pruning/recovery.
- Prompt priorities: current question/clarification, system, narrow clarification continuity, top RAG sources, newest ordinary turns; preserve source markers and wrappers.
- Default normal conversation context is disabled; pending clarification remains narrowly functional.
- All production behavior begins with a failing test observed red.

---

### Task 1: Define the budget and provider contracts

**Files:**
- Create: `src/llm/prompt-budget.ts`
- Create: `tests/prompt-budget.test.ts`
- Modify: `src/llm/completion-request.ts`
- Modify: `tests/completion-request.test.ts`

**Interfaces:**
- Produces `isGroqEndpoint(endpoint)`, `estimatePromptTokens(messages)`, `planPromptBudget(input)` and `completionRequestOptions(settings)`.
- `planPromptBudget` returns planned messages, `{ usedTokens, limitTokens }`, and never mutates inputs.

- [ ] **Step 1: Write failing contract tests.** Cover exact `api.groq.com` recognition (case/trailing slash), rejection of lookalike custom hosts, Groq automatic `max_tokens: 512`, a custom endpoint with no added cap, a prompt over 7,000 estimated tokens that retains question, `[S1]` and `</wiki-copilot-source>`, removes old history before lower-ranked evidence, and leaves inputs byte-for-byte unchanged.
- [ ] **Step 2: Run RED.** `pnpm exec vitest run tests/prompt-budget.test.ts tests/completion-request.test.ts`; verify failures are missing exports/behavior.
- [ ] **Step 3: Implement the smallest pure planner.** Parse the endpoint with `URL`; only `hostname.toLowerCase() === "api.groq.com"` is Groq. Estimate conservatively from Unicode code points plus structural overhead, reserve 12%, construct messages in priority order, and add provider output options without changing non-Groq custom behavior.
- [ ] **Step 4: Run focused green tests.** Repeat Step 2 and require all cases pass.
- [ ] **Step 5: Commit.** `git add src/llm/prompt-budget.ts src/llm/completion-request.ts tests/prompt-budget.test.ts tests/completion-request.test.ts && git commit -m "add prompt budget contracts"`

### Task 2: Persisted settings, migration, settings UI and translations

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/it.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Extends `ModelSettings` with validated context, input-budget and output-budget values; exposes controls `includeRecentConversationContext`, input preset/custom value, and output preset/custom value.

- [ ] **Step 1: Write failing migration/UI/i18n tests.** Assert fresh default context false and automatic values; accepted presets and a bounded custom integer; malformed legacy values fall back safely; all three dictionaries have equal keys; controls expose localized labels and no Web-setting reuse.
- [ ] **Step 2: Run RED.** `pnpm exec vitest run tests/settings.test.ts`.
- [ ] **Step 3: Add validation and UI.** Add explicit discriminated input/output budget types, safe load migration, native Settings controls and localized descriptions. The UI shows the last request estimate supplied by the active request path, but never writes that estimate into settings.
- [ ] **Step 4: Run green.** Repeat Step 2.
- [ ] **Step 5: Commit.** `git add src/settings.ts src/i18n/en.ts src/i18n/it.ts src/i18n/zh.ts tests/settings.test.ts && git commit -m "add token budget settings"`

### Task 3: Route normal and clarification context through the planner

**Files:**
- Modify: `src/main.ts`
- Modify: `src/llm/openai-compatible.ts`
- Modify: `src/llm/prompt.ts`
- Modify: `tests/openai-compatible-stream.test.ts`
- Modify: `tests/pending-clarification-flow.test.ts`
- Modify: `tests/app.pending-clarification-flow.test.ts`

**Interfaces:**
- `main.answer` passes `[]` for ordinary history when the toggle is false, but retains `effectiveQuestion` continuity.
- Client exposes planned-request token metrics to its caller without retaining content.

- [ ] **Step 1: Write failing behavior tests.** Assert default setting sends question + evidence but no old history to planner or completion; enabled setting retains newest bounded turns; an immediate clarification sends only origin objective/request/reply inside effective question; a Groq oversized request observes system/question/wrappers and input cap; a custom endpoint keeps the prior request shape.
- [ ] **Step 2: Run RED.** `pnpm exec vitest run tests/openai-compatible-stream.test.ts tests/pending-clarification-flow.test.ts tests/app.pending-clarification-flow.test.ts`.
- [ ] **Step 3: Implement flow wiring.** Gate ordinary history centrally in `main.ts`; keep pending clarification in effective question. In the client, create system, user and evidence blocks first, invoke `planPromptBudget`, then serialize its messages for both streaming and non-streaming requests. Update system wording so it does not claim history exists when absent.
- [ ] **Step 4: Run focused green.** Repeat Step 2.
- [ ] **Step 5: Commit.** `git add src/main.ts src/llm/openai-compatible.ts src/llm/prompt.ts tests/openai-compatible-stream.test.ts tests/pending-clarification-flow.test.ts tests/app.pending-clarification-flow.test.ts && git commit -m "budget chat context requests"`

### Task 4: Safe provider error classification and reduced-context retry

**Files:**
- Modify: `src/llm/openai-compatible.ts`
- Modify: `src/ui/model-response-localization.ts`
- Modify: `src/ui/wiki-copilot-view.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/it.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `tests/openai-compatible-stream.test.ts`
- Modify: `tests/model-response-localization.test.ts`
- Modify: `tests/conversation-view.test.ts`

**Interfaces:**
- Adds `ModelRequestErrorCode = "input-too-large" | "rate-limited" | "request-failed"`.
- Adds a transient `reducedContext` answer option; it never changes settings or stored turns.

- [ ] **Step 1: Write failing classification and UI tests.** Exercise 413, qualifying 400/429 tokens/TPM/context-length body, ordinary 429, generic 400, and raw text containing organization/model/tier/billing URL. Assert recognized errors render only localized text; only input-too-large renders the reduced-context button; its click calls `runQuestion` once with `appendUserMessage: false` and `reducedContext: true`.
- [ ] **Step 2: Run RED.** `pnpm exec vitest run tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts tests/conversation-view.test.ts`.
- [ ] **Step 3: Implement minimal classification/recovery.** Keep raw details only inside the client classifier; pass no raw provider string to localized UI. Make recovery reduce both source/history allocations through the planner profile, reuse exact question/history snapshot and clarification option, and never retry automatically.
- [ ] **Step 4: Run green.** Repeat Step 2.
- [ ] **Step 5: Commit.** `git add src/llm/openai-compatible.ts src/ui/model-response-localization.ts src/ui/wiki-copilot-view.ts src/i18n/en.ts src/i18n/it.ts src/i18n/zh.ts tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts tests/conversation-view.test.ts && git commit -m "recover safely from oversized requests"`

### Task 5: Integration review and release gate

**Files:**
- Modify only files required by failures discovered below.

- [ ] **Step 1: Add/complete acceptance regressions.** Cover configured 8,000 input cap with a displayed estimate below safe budget, explicit 1,024 output, Groq 512 default, retry without duplicated question, no context retry for ordinary rate-limit, and unchanged Web action/consent.
- [ ] **Step 2: Run focused suite.** `pnpm exec vitest run tests/prompt-budget.test.ts tests/completion-request.test.ts tests/settings.test.ts tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts tests/conversation-view.test.ts tests/pending-clarification-flow.test.ts tests/app.pending-clarification-flow.test.ts`.
- [ ] **Step 3: Run required full verification.** `pnpm check` then `pnpm verify:brat-beta`; investigate failures with systematic debugging and repair only verified regressions.
- [ ] **Step 4: Review diff.** Run `git diff --check`, `git diff --stat`, and inspect all changed source/test/i18n/docs files for scope, raw-provider leakage, settings mutation and generated-file edits.
- [ ] **Step 5: Stop for approval.** Report results and diff review. Do not publish, tag, push or change existing beta/tag state.
