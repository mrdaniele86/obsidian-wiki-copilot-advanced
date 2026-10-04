# Pending Clarification Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an explicitly requested clarification across the next user response so retrieval and the model complete the original objective rather than treating the reply as an independent question.

**Architecture:** A small chat-domain module parses a hidden, validated clarification directive from the final model response and produces a bounded pending-clarification record. Assistant conversation metadata persists that record. Before the next normal chat request, the view resolves the record or discards it, then the main plugin passes a deterministic continuity block to both retrieval planning and answer generation.

**Tech Stack:** TypeScript, Obsidian API, Vitest, existing OpenAI-compatible client, Markdown conversation store.

**Spec:** `docs/superpowers/specs/2026-10-04-pending-clarification-context-design.md`

## Global Constraints

- Do not hardcode workout, nutrition, medical, or other domain rules.
- Do not change the normal Web button, Gemini flow, SerpApi design, provider keys, or web consent.
- Preserve ordinary chat behavior when no valid pending clarification exists.
- A directive is a single hidden HTML comment; its JSON is validated and removed from displayed and stored assistant Markdown.
- At most one clarification is active per conversation; a new conversation, explicit new question, completion, invalid metadata, or more than two user replies clears it.
- Never add a model request solely to classify or confirm a clarification.

## File structure

- `src/chat/pending-clarification.ts`: bounded directive parsing, validation, resolution and continuity-block formatting.
- `src/chat/conversation-types.ts`: typed assistant metadata for a pending clarification.
- `src/chat/conversation-markdown.ts`: safe serialization and parsing of metadata.
- `src/llm/openai-compatible.ts`: model instruction and final-response directive extraction.
- `src/main.ts`: applies a resolved continuity block to retrieval planner and completion.
- `src/ui/wiki-copilot-view.ts`: obtains active metadata, clears stale state, and stores a new directive after the assistant answer.
- `tests/pending-clarification.test.ts`: parser and resolution unit tests.
- `tests/conversation-markdown.test.ts`: metadata round-trip and invalid-data tests.
- `tests/openai-compatible-stream.test.ts`: final-response extraction tests.
- `tests/app.pending-clarification-flow.test.ts`: Tempo/Soglia behaviour tests.

---

### Task 1: clarification domain contract

**Files:**
- Create: `src/chat/pending-clarification.ts`
- Create: `tests/pending-clarification.test.ts`

**Interfaces:**
- Produces `PendingClarification`, `ClarificationDirective`, `extractClarificationDirective(markdown)`, `resolvePendingClarification(pending, reply)`, and `formatClarificationContinuation(resolution)`.

- [ ] **Step 1: Write failing parser and resolution tests**

```ts
it("extracts a hidden clarification directive without exposing it", () => {
  const parsed = extractClarificationDirective(
    "Which workout came immediately before Tempo?\n\n<!-- wiki-copilot-clarification {\"goal\":\"recommend the next workout after Tempo\",\"question\":\"Which workout came immediately before Tempo?\",\"missing\":\"the workout before Tempo\",\"requiresSummary\":true} -->"
  );
  expect(parsed.markdown).toBe("Which workout came immediately before Tempo?");
  expect(parsed.clarification?.goal).toContain("Tempo");
});

it("resolves Soglia as a reply to the Tempo objective", () => {
  const resolution = resolvePendingClarification(pendingTempo, "Before it I did Soglia.");
  expect(formatClarificationContinuation(resolution!)).toContain("next workout after Tempo");
  expect(formatClarificationContinuation(resolution!)).toContain("Soglia");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/pending-clarification.test.ts`

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface PendingClarification {
  goal: string;
  question: string;
  missing: string;
  requiresSummary: boolean;
  originUserTurnIndex: number;
  originAssistantTurnIndex: number;
  userRepliesSinceRequest: number;
}

export function extractClarificationDirective(markdown: string): {
  markdown: string;
  clarification?: ClarificationDirective;
} { /* accept exactly one final directive, validate it, strip it */ }
```

Require one final `<!-- wiki-copilot-clarification … -->` comment, non-empty trimmed fields no longer than 2,000 characters, and no duplicate comments. Treat a non-empty reply containing `?` as an explicit replacement question. The formatted continuity block must have exact headings `Original objective`, `Clarification requested`, and `Reply received`, then state that the reply is not an independent question.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run tests/pending-clarification.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/pending-clarification.ts tests/pending-clarification.test.ts
git commit -m "add pending clarification contract"
```

### Task 2: conversation metadata persistence

**Files:**
- Modify: `src/chat/conversation-types.ts`
- Modify: `src/chat/conversation-markdown.ts`
- Modify: `tests/conversation-markdown.test.ts`

**Interfaces:**
- Consumes `PendingClarification` from Task 1.
- Produces `AssistantConversationTurn.pendingClarification?: PendingClarification`.

- [ ] **Step 1: Write failing persistence tests**

```ts
it("round-trips a valid pending clarification on an assistant turn", () => {
  const parsed = parseConversation(serializeConversation(conversationWithPendingClarification));
  expect(parsed?.turns.at(-1)).toMatchObject({
    role: "assistant",
    pendingClarification: { goal: "recommend the next workout after Tempo" }
  });
});

it("drops invalid pending metadata but keeps the assistant turn", () => {
  expect(parseConversation(markdownWithOversizedPendingGoal)?.turns.at(-1))
    .not.toHaveProperty("pendingClarification");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/conversation-markdown.test.ts`

Expected: FAIL because assistant metadata lacks `pendingClarification`.

- [ ] **Step 3: Serialize and validate metadata**

Add `pendingClarification` to assistant types, render state, serialization and parse state. Accept only Task 1-bounded fields, non-negative integer origin indexes and `userRepliesSinceRequest` from 0 to 2. Invalid pending metadata must be omitted while assistant text, sources, Vault hit state and web metadata remain intact.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run tests/conversation-markdown.test.ts tests/pending-clarification.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/conversation-types.ts src/chat/conversation-markdown.ts tests/conversation-markdown.test.ts
git commit -m "persist pending clarification metadata"
```

### Task 3: hidden model directive and continuity context

**Files:**
- Modify: `src/llm/openai-compatible.ts`
- Modify: `src/main.ts`
- Modify: `tests/openai-compatible-stream.test.ts`
- Create: `tests/pending-clarification-flow.test.ts`

**Interfaces:**
- Consumes Task 1 parser and resolution helpers.
- Produces `AnswerResult.pendingClarification?: PendingClarification` and `AnswerOptions.clarification?: ResolvedClarification`.

- [ ] **Step 1: Write failing clean-response and Tempo/Soglia request-shape tests**

```ts
it("returns clean Markdown and a clarification directive", async () => {
  const answer = await client.answer("What next after Tempo?", context, [], "", settings(), 90_000);
  expect(answer.markdown).not.toContain("wiki-copilot-clarification");
  expect(answer.pendingClarification?.question).toContain("before Tempo");
});

it("anchors planner and completion to Tempo when the reply is Soglia", async () => {
  await plugin.answer("Before it I did Soglia.", history, { clarification: resolvedTempo });
  expect(plannerRequest()).toContain("recommend the next workout after Tempo");
  expect(completionRequest()).toContain("Reply received:\nBefore it I did Soglia.");
});
```

Include a streamed completion whose final delta contains the directive.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/openai-compatible-stream.test.ts tests/pending-clarification-flow.test.ts`

Expected: FAIL because no result metadata or continuity option exists.

- [ ] **Step 3: Implement directive instruction, clean extraction and effective question**

Add a narrowly scoped system instruction: when required information is missing, ask one clear question and append exactly one final directive; otherwise append none. After the assembled streamed or non-streamed response, extract the directive before final render/save. Preserve streaming deltas but replace final rendered Markdown with clean text before `finish()`.

In `main.answer`, format an effective question when `options.clarification` is present, then pass it to `retrieve`, retrieval planner options and `llmClient.answer`. Keep the raw user text in UI and conversation history. The model receives no additional request.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run tests/openai-compatible-stream.test.ts tests/pending-clarification-flow.test.ts tests/pending-clarification.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/openai-compatible.ts src/main.ts tests/openai-compatible-stream.test.ts tests/pending-clarification-flow.test.ts
git commit -m "anchor retrieval to clarification context"
```

### Task 4: view lifecycle and acceptance behaviour

**Files:**
- Modify: `src/ui/wiki-copilot-view.ts`
- Create: `tests/app.pending-clarification-flow.test.ts`
- Modify: `tests/app.web-search-flow.test.ts`

**Interfaces:**
- Consumes the latest valid assistant metadata and `AnswerResult.pendingClarification`.
- Produces a clarification option only for the immediate ordinary chat follow-up; Web remains unchanged.

- [ ] **Step 1: Write failing view tests**

```ts
it("uses the pending Tempo clarification for a Soglia reply", async () => {
  await view.runQuestion("Before it I did Soglia.", historyWithPendingTempo, { appendUserMessage: true });
  expect(plugin.answer).toHaveBeenCalledWith("Before it I did Soglia.", expect.any(Array), {
    expect.objectContaining({ clarification: expect.objectContaining({ goal: expect.stringContaining("Tempo") }) })
  });
});

it("clears a pending clarification for an explicit replacement question", async () => {
  await view.runQuestion("What did I do last week?", historyWithPendingTempo, { appendUserMessage: true });
  expect(plugin.answer).toHaveBeenCalledWith("What did I do last week?", expect.any(Array), {
    expect.not.objectContaining({ clarification: expect.anything() })
  });
});
```

Add cases for new conversation, invalid restored metadata and a one-field clarification with `requiresSummary: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/app.pending-clarification-flow.test.ts tests/app.web-search-flow.test.ts`

Expected: FAIL because the view neither resolves nor persists the metadata.

- [ ] **Step 3: Resolve, clear and store state**

Before `plugin.answer`, find only the latest valid assistant pending metadata in the current conversation and resolve it against the raw next user input. Clear it for replacement questions, new conversation, invalid restored state, cancellation and successful follow-up. Save a valid `answer.pendingClarification` on the assistant turn with its origin indexes. Require final responses with `requiresSummary: true` to open with a concise `Ho identificato:` summary; do not add a confirmation turn.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run tests/app.pending-clarification-flow.test.ts tests/app.web-search-flow.test.ts tests/conversation-markdown.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/wiki-copilot-view.ts tests/app.pending-clarification-flow.test.ts tests/app.web-search-flow.test.ts
git commit -m "continue pending clarification conversations"
```

### Task 5: regression quality gate

**Files:**
- Modify only if a test identifies a direct defect in Tasks 1–4.

- [ ] **Step 1: Add the complete acceptance regression**

```ts
it("keeps Soglia as penultimate and Tempo as latest workout", async () => {
  const pending = pendingFor("recommend the next workout after Tempo", true);
  const answer = await answerWithPendingReply(pending, "Before it I did Soglia.");
  expect(answer.plannerRequest).toContain("after Tempo");
  expect(answer.completionRequest).toContain("Before it I did Soglia.");
  expect(answer.markdown).toMatch(/^Ho identificato:/u);
});
```

- [ ] **Step 2: Run the acceptance test**

Run: `pnpm exec vitest run tests/app.pending-clarification-flow.test.ts`

Expected: PASS.

- [ ] **Step 3: Run complete verification**

Run: `pnpm test && pnpm build && pnpm verify:brat-beta && pnpm exec eslint src/chat/pending-clarification.ts src/chat/conversation-types.ts src/chat/conversation-markdown.ts src/llm/openai-compatible.ts src/main.ts src/ui/wiki-copilot-view.ts`

Expected: all tests, TypeScript build, BRAT verification and scoped production lint pass.

- [ ] **Step 4: Check global lint scope**

Run: `pnpm lint`

Expected: if errors arise only from nested `.worktrees/` content, record that known environmental limitation and retain scoped-lint success; otherwise repair changed production files.

- [ ] **Step 5: Commit**

```bash
git add src tests docs
git commit -m "preserve pending clarification context"
```
