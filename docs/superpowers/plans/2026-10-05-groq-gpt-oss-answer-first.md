# Groq GPT-OSS Answer-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Groq GPT-OSS responses reliable without allowing optional retrieval planning to block a sendable answer.

**Architecture:** A narrow request-option predicate gates GPT-OSS payload changes by exact host and model. The Groq allocator becomes answer-first, and response parsing carries request metadata only long enough to classify a textless targeted response safely.

**Tech Stack:** TypeScript, Vitest, Obsidian requestUrl/fetch compatibility layer.

**Spec:** `docs/superpowers/specs/2026-10-05-groq-gpt-oss-answer-first-design.md`

## Global Constraints

- Apply new provider fields only to host `api.groq.com` and model IDs `openai/gpt-oss-20b` / `openai/gpt-oss-120b`.
- Do not alter saved settings, Vault retrieval, consent, Web Search, Enter behavior, or persisted history.
- Do not add automatic retries or disclose raw provider response text.
- Do not create a beta, tag, release, or push.

---

### Task 1: Targeted GPT-OSS payload options

**Files:**
- Modify: `tests/completion-request.test.ts`
- Modify: `src/llm/completion-request.ts`

**Interfaces:**
- Produces: `completionRequestOptions(settings, outputTokens?)`, with `model` in its input type and the new response-field types, returning targeted fields only for the exact Groq/GPT-OSS pair.

- [ ] **Step 1: Write failing request-option tests**

```ts
expect(completionRequestOptions(gptOssSettings)).toEqual({
  max_completion_tokens: 512,
  reasoning_effort: "low",
  include_reasoning: false
});
expect(completionRequestOptions(otherGroqModel)).not.toHaveProperty("reasoning_effort");
expect(completionRequestOptions(gptOssOtherHost)).not.toHaveProperty("max_completion_tokens");
```

- [ ] **Step 2: Run the focused test and verify it fails because the options are absent**

Run: `pnpm test -- tests/completion-request.test.ts`

- [ ] **Step 3: Implement the narrow model-and-host predicate and current GPT-OSS fields**

```ts
if (isGroqGptOss(settings.endpoint, settings.model)) {
  return { max_completion_tokens: outputTokens, reasoning_effort: "low", include_reasoning: false };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm test -- tests/completion-request.test.ts`

### Task 2: Answer-first allocation and planner skip

**Files:**
- Modify: `tests/prompt-budget.test.ts`
- Modify: `tests/openai-compatible-stream.test.ts`
- Modify: `src/llm/prompt-budget.ts`
- Modify: `src/llm/openai-compatible.ts`

**Interfaces:**
- Produces: a Groq answer allocation independent of optional planner reservation, plus a planner request that can be skipped/fall back without changing answer capacity.

- [ ] **Step 1: Write failing allocator and client regression tests**

```ts
expect(groqActionBudget(undefined, 512, 8_000).answerInputTokens).toBe(6_160);
await expect(client.answer(questionThatFitsAnswerOnly, context, [], "", groqSettings, 90_000)).resolves.toBe("ok");
expect(answerPayload.max_completion_tokens).toBe(512);
```

Add a planner case whose prompt cannot fit its optional capacity; assert original-query fallback and an unchanged answer payload limit.

- [ ] **Step 2: Run the focused tests and verify they fail on beta.14 reservation behavior**

Run: `pnpm test -- tests/prompt-budget.test.ts tests/openai-compatible-stream.test.ts`

- [ ] **Step 3: Implement answer-first accounting and an explicit planner fallback contract**

```ts
const answerInputTokens = safeAnswerInputTokens(...);
const plannerInputTokens = remainingPlannerCapacity(answerInputTokens, ...);
if (!plannerPromptFits) return [query]; // no planner dispatch
```

`planRetrievalQueries` returns `[query]` when planning is locally skipped, preserving its `Promise<string[]>` contract and avoiding changes to `main.ts`. Keep a genuine answer over-budget result as `ModelRequestError("input-too-large")`; do not dispatch a retry.

- [ ] **Step 4: Route effective planner/answer output limits into the option builder**

```ts
const providerOptions = completionRequestOptions(settings, actionBudget?.plannerOutputTokens);
const plannerLimit = "max_completion_tokens" in providerOptions
  ? {} : { max_tokens: actionBudget.plannerOutputTokens };
```

Assert that a targeted GPT-OSS planner has no legacy `max_tokens`; the regular Groq planner retains its existing `max_tokens` field.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `pnpm test -- tests/prompt-budget.test.ts tests/openai-compatible-stream.test.ts`

The client regression must call planner then answer at 8,000 TPM, verify the planner is locally skipped or returns `[query]` when it cannot fit, and verify the subsequently dispatched answer has 6,160 input capacity and 512 output capacity.

### Task 3: Safe GPT-OSS textless-response classification

**Files:**
- Modify: `tests/openai-compatible-stream.test.ts`
- Modify: `tests/model-response-localization.test.ts`
- Modify: `src/llm/openai-compatible.ts`
- Modify: `src/ui/model-response-localization.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/it.ts`
- Modify: `src/i18n/zh.ts`

**Interfaces:**
- Produces: `ModelRequestError("reasoning-exhausted")` only for a textless successful targeted GPT-OSS response, mapped to a provider-safe translation key.

- [ ] **Step 1: Write failing transport and localization tests**

```ts
await expect(client.answer(...gptOssSettings)).rejects.toMatchObject({ code: "reasoning-exhausted" });
expect(localizeModelError(t, new ModelRequestError("reasoning-exhausted", "secret reasoning")))
  .not.toContain("secret reasoning");
await expect(client.answer(...otherSettings)).rejects.toMatchObject({ code: "empty-response" });
```

Cover both non-stream compatibility and an `application/json` response received by the streaming path.

- [ ] **Step 2: Run focused tests and verify they fail because the distinct code/message do not exist**

Run: `pnpm test -- tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts`

- [ ] **Step 3: Implement the distinct code and request-aware classification**

```ts
if (!text && request.isTargetedGroqGptOss) {
  throw new ModelRequestError("reasoning-exhausted");
}
```

Do not parse or render `reasoning`; pass no raw provider detail to the translation.

- [ ] **Step 4: Add concise translations and map the new code**

Use a neutral instruction to retry manually with a shorter request or a different output setting; do not mention provider internals, credentials, tiers, limits, or billing.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `pnpm test -- tests/openai-compatible-stream.test.ts tests/model-response-localization.test.ts`

### Task 4: Regression and release-readiness verification

**Files:**
- Modify only files required by failures from Tasks 1–3.

- [ ] **Step 1: Run all test suites**

Run: `pnpm test`

- [ ] **Step 2: Run static checks and production build**

Run: `pnpm check`

- [ ] **Step 3: Validate BRAT beta artifact consistency without changing a version**

Run: `pnpm verify:brat-beta`

- [ ] **Step 4: Review the complete diff for scope**

Run: `git diff --check` and `git diff -- src/llm src/ui src/i18n tests docs/superpowers`

- [ ] **Step 5: Confirm no publication action was taken**

Run: `git status --short`; do not tag, release, push, or change `package.json`, `manifest.json`, or `versions.json`.
