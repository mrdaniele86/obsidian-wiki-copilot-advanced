# Contextual Follow-up Exact-Identifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an enabled recent conversation context reach the model when the follow-up contains a Vault identifier with no exact local evidence.

**Architecture:** Narrow the early exact-identifier return in `main.answer` to only isolated requests. The retrieval result remains unchanged; only the decision to short-circuit before the LLM changes.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-contextual-followup-exact-identifier-design.md`

## Global Constraints

- Do not change isolated exact-identifier safety, retrieval ranking, consent, Web search or persistent settings.
- The bypass requires enabled ordinary conversation context and at least one historical turn.
- Do not publish, tag or push without explicit confirmation.

### Task 1: Gate the local identifier fallback by usable context

**Files:**
- Modify: `src/main.ts`
- Test: `tests/main-answer.test.ts` or the existing answer-flow test owning the exact-identifier fallback.

- [ ] **Step 1: Write a failing regression test.** Configure `includeRecentConversationContext: true`, provide a prior user/assistant pair and a retrieval result with no chunks for a follow-up containing `8x300`; assert the LLM client is called with the prior turns and the answer is not the local exact-identifier message.
- [ ] **Step 2: Run RED.** Run the focused answer-flow test; expect the early local fallback.
- [ ] **Step 3: Implement the minimum condition.** Return the missing-identifier message only when no usable ordinary model history was selected; preserve the existing return in all other cases.
- [ ] **Step 4: Run GREEN.** Repeat the focused test and existing isolated-fallback test.
- [ ] **Step 5: Verify.** Run `pnpm check`, `pnpm verify:brat-beta`, and `git diff --check`; review diff and stop for release approval.
