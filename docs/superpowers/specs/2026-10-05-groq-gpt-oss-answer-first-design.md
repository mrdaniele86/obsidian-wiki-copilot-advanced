# Groq GPT-OSS Answer-First Design

## Problem

In beta.14, the optional retrieval planner reserves 2,000 input tokens and 256 output tokens before the answer is budgeted. At 8,000 TPM this reduces the answer input allocation to 4,160 tokens even when a planner is not used or fails. A first question whose system prompt and question fit the real answer allocation can therefore be rejected locally as too large; the manual reduced-context retry retains the same artificial reservation.

For the exact Groq host, `openai/gpt-oss-20b` and `openai/gpt-oss-120b` also need Groq's GPT-OSS reasoning controls. The compatibility parser presently reads only `choices[0].message.content`. A successful response that consumed its allowance in reasoning can therefore surface as an undifferentiated empty response.

## Goals

- Preserve enough answer budget for a first question whenever its system prompt and question can be sent with the configured output limit.
- Treat retrieval planning as optional for Groq: constrain it heavily or skip it when it would reduce a sendable answer.
- For only `api.groq.com` with model `openai/gpt-oss-20b` or `openai/gpt-oss-120b`, send `reasoning_effort: "low"`, `include_reasoning: false`, and `max_completion_tokens` matching the effective output limit.
- Keep all other providers, custom endpoints, and Groq models byte-for-byte equivalent in their provider-specific request options.
- Identify a successful but textless targeted GPT-OSS response as a reasoning-exhaustion case and show localized, provider-safe guidance. Do not use, display, or synthesize an answer from reasoning text.
- Keep retries manual. Preserve Vault retrieval, consent, Web Search, Enter/send handling, saved settings, and persisted conversation history.

## Non-goals

- No automatic retry, retry delay, provider account discovery, or release/version change.
- No changes to source retrieval, evidence ranking, historical persistence, or model settings schema.
- No disclosure of provider response bodies, keys, organization/tier data, rate limits, billing URLs, or hidden reasoning.

## Design

### Targeted GPT-OSS request options

`completionRequestOptions` gains model-aware detection using the existing exact-host predicate. Only the two named model IDs on `api.groq.com` receive a current Groq payload shape:

```ts
{
  max_completion_tokens: effectiveOutputTokens,
  reasoning_effort: "low",
  include_reasoning: false
}
```

The same option builder is used by answer and retrieval-planner requests. Planner output continues to be bounded independently; for a targeted GPT-OSS planner, its small planner output allowance becomes `max_completion_tokens`. Targeted requests do not also send the legacy `max_tokens` field.

### Answer-first Groq allocation

The action allocator first reserves the configured answer output and derives the safe answer input limit from TPM, input configuration, and the safety margin. It does not pre-deduct a fixed planner allowance from that answer envelope. The optional planner receives only capacity that is demonstrably spare after a sendable answer, and is skipped if its own system/question cannot fit that spare capacity.

The answer request always uses the complete answer-first limit, whether the planner succeeds, fails locally, or is skipped. A genuine answer prompt that cannot fit still reports `input-too-large` and keeps the existing manual reduced-context control.

### Empty 200 response classification

The non-streaming and JSON-in-stream response paths receive the prepared request context. If the request is the targeted Groq GPT-OSS shape and `choices[0].message.content` is absent or empty, they throw a distinct semantic request error. Other models retain the generic empty-response classification. A new localized safe message describes that the model used its available output without producing a visible answer; it includes no raw provider response or reasoning.

## Acceptance criteria

1. At 8,000 TPM with automatic 512 output, a first answer whose fixed system prompt and question fit is dispatched even if retrieval planning is skipped or fails.
2. A reduced-context retry does not repair a failure caused solely by a planner reservation, because that reservation no longer reduces the answer budget.
3. Both targeted GPT-OSS models receive the three targeted fields for planner and answer; other models and endpoints receive none of them.
4. Targeted GPT-OSS 200 responses with only reasoning or blank content produce the dedicated localized safe error; other textless responses remain generic.
5. No retry is automatic, and genuine input-limit errors keep the manual retry behavior.
6. `pnpm check` and `pnpm verify:brat-beta` pass before review; no beta, tag, release, or push is created.
