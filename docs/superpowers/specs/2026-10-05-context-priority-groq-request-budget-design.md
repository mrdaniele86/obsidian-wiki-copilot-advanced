# Context Priority and Groq Request Budget Design

## Problem

Wiki Copilot currently applies a prompt budget that can admit retrieved evidence before recent conversation turns. In a source-heavy request, this can remove the exact preceding user/assistant pair needed to answer a follow-up. A separate identifier guard classifies workout notation such as `8x300` as a technical identifier and returns a hard-coded Chinese missing-evidence message in a new conversation. Finally, Groq TPM is a rolling, account-wide rate limit, but a single user action may make a retrieval-planner request and an answer request with independent per-request budgets.

The observed consequence is that an active conversation can forget that the penultimate workout was `8x300` and the latest workout was Tempo; a subsequent question asks for the same information again. The response can also expose an unrelated Chinese guard message, or receive a Groq token/rate rejection despite an apparently valid answer budget.

## Goals

- Preserve the current user question and system prompt for every bounded request.
- When recent conversation context is enabled, retain the newest complete, relevant chat turns before allocating remaining capacity to Vault evidence.
- Keep source wrappers and source markers intact for evidence that remains; remove least-priority evidence first.
- Continue original-plugin request behavior when recent conversation context is disabled, except for immediate clarification linkage already implemented.
- Treat workout notation such as `8x300` as ordinary query text rather than a strict technical identifier.
- Keep the strict no-substitution boundary for strong product/document identifiers such as `MS6` and `PCBA-001`.
- Budget all Groq calls caused by one user action (retrieval planning and answer generation) against the configured account TPM limit, including explicit output reservations and a safety margin.
- Keep generic non-Groq custom endpoints unchanged.
- Do not alter saved settings, stored conversation history, Vault retrieval semantics, normal Enter behavior, consent, or Web Search.
- Avoid presenting a response without valid citations as Vault-grounded when evidence was supplied.
- Keep the desktop composer action row, including the “Send” button, fully above Obsidian's status/synchronization bar at every supported desktop viewport height.

## Non-goals

- This work does not add automatic retrying, rate-limit waiting, provider-specific account discovery, or token billing estimation.
- It does not change the user-selected model, model endpoint, existing tags, or published betas.
- It does not make a no-evidence answer cite fabricated source markers.

## Design

### Answer prompt selection

`planPromptBudget` will construct a bounded answer prompt in this order:

1. system prompt;
2. current user question;
3. most recent complete conversation turns, newest backwards, without splitting a user/assistant pair where avoidable;
4. ranked Vault evidence blocks, from highest to lowest relevance.

The planner must never truncate the current question. It keeps each retained source's `<wiki-copilot-source>` wrapper and source marker valid. Once system, question, and selected recent context have consumed the safe budget, it only admits evidence that fits. It discards lower-ranked evidence rather than evicting retained context.

When context is disabled, ordinary prior history is absent as before. An immediate clarification remains represented by its compact resolution path, not by re-enabling full history.

### Strong identifier guard

The identifier extractor remains useful for retrieval ranking, but the hard exact-match/no-substitution guard will use a stricter anchor class. A strong anchor requires a product/document-like letter-led identifier with enough alphabetic structure to distinguish it from a workout repetition notation. `MS6` and `PCBA-001` remain strict anchors; `8x300` does not. The fallback text remains localized through the plugin UI language and no longer hard-codes Chinese.

### Groq action budget

For an exact `api.groq.com` endpoint, resolve one action budget from the configured TPM limit, input limit, output limit, and safety margin. Reserve a small fixed planner completion allowance before allocating the answer prompt and answer completion allowance. The retrieval planner receives its own bounded prompt/history and explicit output limit. The answer request receives the residual allocation.

The total declared input and output capacity for planner plus answer must not exceed the per-action safe allocation. This prevents the plugin's own two calls from independently claiming the account-wide TPM ceiling. It cannot account for unrelated external traffic in Groq's rolling minute; those cases remain normal rate limits without automatic retry.

Automatic Groq settings remain conservative: 8,000 TPM, 512 answer output tokens, and a bounded planner completion allowance. The UI progress text reports the planner reservation and answer input/output allocation so that the configured TPM setting is understandable.

Non-Groq endpoints preserve their existing automatic behavior and payload shape.

### Citation integrity

If retrieved evidence exists and the completed response contains no valid source marker, the current validation warning remains visible. The result must be labelled as ungrounded/general rather than as a supported Vault answer, preventing the source count from implying validation. No source text is invented and no automatic resend occurs.

### Desktop composer clearance

The desktop composer reserves bottom clearance for the actual status/synchronization bar plus the plugin's normal spacing. The action row remains visible without requiring a viewport resize, scrolling, or a mobile-only override. The desktop rule must use the Obsidian status-bar dimension where available and retain a safe fallback where it is not exposed. Mobile composer behavior remains unchanged.

## Data flow

```text
user question + enabled history
  -> Groq action allocator
  -> bounded retrieval planner (optional)
  -> Vault retrieval
  -> answer prompt selector: system + question + newest history + remaining evidence
  -> answer request
  -> citation validation and presentation
```

## Acceptance criteria

1. With conversation context enabled, a follow-up after “8×300 then Tempo” retains that pair even when retrieval returns many large source blocks.
2. With context disabled, ordinary history is not sent; immediate clarification behavior stays intact.
3. A standalone `8x300` query does not trigger the technical-identifier fallback; `MS6` still does when no exact evidence exists.
4. Groq planner plus answer reservations fit within the configured TPM action budget with the safety margin; automatic 8,000 TPM works without requiring the user to set 4,000 merely to compensate for the plugin's own calls.
5. A normal Groq rate limit is still classified as rate-limited and offers no reduced-context retry.
6. Custom non-Groq endpoints retain their current automatic payload behavior.
7. Evidence-bearing responses with no valid source marker are visibly treated as ungrounded rather than as citation-verified Vault responses.
8. On desktop, the full Send button remains above the status/synchronization bar in the normal plugin pane; mobile layout remains unchanged.
9. New and updated tests cover all criteria; `pnpm check` and `pnpm verify:brat-beta` pass before any release proposal.
