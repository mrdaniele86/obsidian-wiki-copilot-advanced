# Handoff: Groq context budgeting and conversation-context toggle

Copy the prompt below into a new Codex conversation.

---

Continue development of Wiki Copilot Advanced in this repository:

`C:\Users\Daniele\Documents\Codex\2026-10-02\referenced-chatgpt-conversation-this-is-an\repo`

Use the existing release branch and worktree; do not create another worktree:

- Branch: `feature/i18n-history`
- Latest published release: `v2.1.1-beta.9`
- Preserve all existing tags/releases for rollback. Do not publish a new beta, tag, push, or alter GitHub Releases without explicit confirmation after the complete review.

## User goals

1. Fix Groq failures where a short follow-up causes an error like:

   `Request too large for model openai/gpt-oss-20b ... TPM limit 8000, requested 11127`

2. Add a user setting to enable or disable inclusion of recent conversation context for normal Vault questions. It must be **disabled by default**. When disabled, normal chat behavior must match the original plugin: the model receives the new question and retrieved Vault evidence, but no earlier user/assistant turns. This does not authorize sending Vault notes to unrelated providers.


## Important current state

- `v2.1.1-beta.9` fixed the mobile composer gap and Web-button visibility.
- The optional Gemini Web-search integration already exists. Normal Send and Vault retrieval must remain unchanged; Web is always explicit and consent-gated.
- SerpApi is only a design document; no code exists for it.
- Pending clarification support was added after beta.7. It stores validated hidden clarification metadata and builds a continuity block for an answer when the immediately preceding assistant turn requested clarification.
- Full project quality was green before beta.9: lint, 363 tests passed, 1 skipped, build, and BRAT verifier.
- `eslint.config.mjs` deliberately ignores `.worktrees/**`; do not remove that rule.

## Evidence for the Groq issue

Read the code before changing it. Root cause investigation already found:

- `src/core/retriever.ts` allows large evidence context in precise/high retrieval (`maxContextCharacters` can be 48,000).
- `src/llm/openai-compatible.ts` adds up to 10 history turns / 24,000 characters plus the system prompt and source wrappers.
- Custom endpoints receive no explicit output cap, unlike the DeepSeek-specific code path. Groq therefore reserves a large default completion budget.
- The clarification continuity block can add some text, but is not the primary cause.
- Current non-2xx errors become generic `ModelRequestError('request-failed', detail)`, and the UI displays raw provider text. This leaks model, organization/tier, quotas, and billing URL. The user saw this on mobile.

## Required design constraints

### Groq request budgeting

- Detect Groq conservatively from a normalized endpoint hostname such as `api.groq.com`; keep arbitrary custom endpoints unchanged.
- Add a provider profile that sets an explicit completion cap appropriate for a concise Vault answer (proposed initial value: 512 tokens, subject to test/design review).
- Add a deterministic end-to-end prompt budget for Groq. It must count system instruction, current question/effective clarification question, retrieved evidence wrappers, and history. Preserve, in order of priority:
  1. the current user question / resolved clarification block;
  2. source markers and the most relevant recent evidence;
  3. the newest conversation turns.
- Trim oldest history first, then lower-priority evidence. Do not mutate saved settings or stored conversation history.
- Do not solve this solely by reducing retrieval settings: history and wrappers must be included in the final request budget.
- Add tests proving an oversized Groq prompt includes `max_tokens`, stays within its specified budget, preserves current question and source markers, and differs from a non-Groq custom endpoint.

### Groq-safe error handling and recovery

- Classify input-too-large separately from generic request failures and rate limits. Match 413, or only specific 400/429 body indicators such as `TPM`, `tokens per minute`, `requested ... limit`, `context length`, or `too many tokens`.
- Never classify every 429 as a size error.
- Do not display raw provider response text for recognized errors. Add localizations in Italian, English, and Chinese that do not expose organization, model ID, tier, limits, or billing links.
- For input-too-large, offer an explicit retry action such as “Retry with reduced context.” It must use a stricter temporary recovery profile for both history and evidence, preserve the original question once, and not alter persistent user settings. No automatic retry.
- Rate-limit errors must not show the reduced-context retry.

### Conversation-context user option

- Add a clear setting such as `includeRecentConversationContext` under chat/retrieval settings, default `false`.
- When false, pass no ordinary conversation history to answer generation or retrieval planning. The default must behave like the original plugin, apart from mandatory narrow state needed for an immediate clarification resolution.
- Decide and document the interaction with pending clarification carefully: a direct answer to the immediately previous clarification question must still work, using only the bounded origin pair + reply; do not re-enable broad history as a side effect.
- When true, preserve the current bounded-history behavior, but route it through the new Groq end-to-end budget.
- Add migration/validation, i18n, settings UI, and tests for both modes.

## Process requirements

1. Use systematic debugging and test-driven development. Write failing tests first and show RED before production code.
2. Before implementation, inspect existing specs/plans and write a new design spec plus implementation plan in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
3. Use subagents for independent implementation/review blocks. Review each completed task for spec compliance and code quality.
4. Preserve user work; never use destructive `git reset --hard` or `git checkout --`.
5. Run `pnpm check`, `pnpm verify:brat-beta`, and review the final diff. If full lint fails, identify whether the failure is new; it was green at beta.9.
6. Do not publish until the user explicitly approves the reviewed result.

## First requested response

Start with a concise evidence-based design proposal for the Groq and conversation-context work, then obtain approval before implementation.
