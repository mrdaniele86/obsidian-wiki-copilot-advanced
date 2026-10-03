# Optional Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, consent-gated Gemini Google Search grounding while preserving the Vault-only flow unchanged by default.

**Architecture:** Provider-neutral web-search contracts isolate settings, capability checks, results, and session consent. A Gemini adapter calls Google Search grounding and returns structured web sources. The plugin owns secure credentials and orchestration; the view renders and persists web sources separately from Vault citations.

**Tech Stack:** TypeScript, Obsidian API, native `fetch`, Gemini API, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-optional-web-search-design.md`

## Global Constraints

- Default `disabled` mode changes no existing retrieval, chat, citation, or model behavior.
- Send only the explicit question by default; an opt-in bounded recent-chat context may be sent only when enabled and disclosed in the consent. Never send Vault text, active-note text, the full history, or existing model credentials.
- Require consent before each search unless remembered in memory for this Obsidian session only.
- Gemini is the first and only supported web adapter; do not advertise generic OpenAI-compatible support.
- Keep web URLs and sources distinct from Vault `S1` citations and localize all UI text in IT/EN/ZH.
- Preserve mobile support and 44px touch targets; add no runtime dependency unless native `fetch` proves insufficient.

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/web-search/types.ts` | Settings, request/result, source and capability types. |
| `src/web-search/gemini-grounding.ts` | Gemini REST request, validation and conversion of grounding metadata. |
| `src/web-search/session-consent.ts` | In-memory provider/model consent. |
| `src/web-search/web-search-service.ts` | Capability selection and adapter dispatch. |
| `src/settings.ts`, `src/main.ts` | Settings UI, secure API key, service orchestration. |
| `src/chat/conversation-types.ts`, `src/chat/conversation-markdown.ts` | Separate persisted web-result metadata. |
| `src/ui/wiki-copilot-view.ts`, `styles.css`, `src/i18n/*.ts` | Explicit action, consent modal, display, translations. |

### Task 1: Add contracts and normalized web-search settings

**Files:**
- Create: `src/web-search/types.ts`
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`, `tests/web-search/types.test.ts`

**Interfaces:**

```ts
export type WebSearchMode = "disabled" | "current-provider" | "dedicated-gemini";
export interface WebSearchSettings { mode: WebSearchMode; geminiModel: string; }
export interface WebSource { title: string; url: string; }
export interface WebSearchResult { provider: "gemini"; model: string; answer: string; sources: WebSource[]; }
```

- [ ] **Step 1: Write failing loader tests**

```ts
it("defaults web search to disabled", () => {
  expect(loadWikiCopilotSettings({}).webSearch).toEqual({
    mode: "disabled", geminiModel: "gemini-2.5-flash"
  });
});
it("falls back for an unknown persisted mode", () => {
  expect(loadWikiCopilotSettings({ webSearch: { mode: "internet" } }).webSearch.mode).toBe("disabled");
});
```

- [ ] **Step 2: Run RED test**

Run: `pnpm test -- tests/settings.test.ts tests/web-search/types.test.ts`

Expected: FAIL because `webSearch` is absent.

- [ ] **Step 3: Implement normalized settings**

Add `webSearch` to `WikiCopilotSettings`, `DEFAULT_SETTINGS`, and `loadWikiCopilotSettings`. Validate modes and a trimmed Gemini model, preserving all current `model` and retrieval defaults.

- [ ] **Step 4: Run GREEN test**

Run: `pnpm test -- tests/settings.test.ts tests/web-search/types.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web-search/types.ts src/settings.ts tests/settings.test.ts tests/web-search/types.test.ts
git commit -m "add web search settings contracts"
```

### Task 2: Implement Gemini grounding and capability dispatch

**Files:**
- Create: `src/web-search/gemini-grounding.ts`, `src/web-search/web-search-service.ts`
- Test: `tests/web-search/gemini-grounding.test.ts`, `tests/web-search/web-search-service.test.ts`

**Interfaces:**

```ts
export interface WebSearchRequest { question: string; model: string; apiKey: string; }
export class GeminiGroundingClient { search(request: WebSearchRequest): Promise<WebSearchResult>; }
export class WebSearchService {
  capability(settings: WebSearchSettings): { available: boolean; reason?: string };
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}
```

- [ ] **Step 1: Write failing adapter tests**

```ts
it("extracts text and deduplicated grounding URLs", async () => {
  const result = await client(mockFetch({
    candidates: [{ content: { parts: [{ text: "Misti uses 30 °C." }] },
      groundingMetadata: { groundingChunks: [
        { web: { uri: "https://manual.example/misti", title: "Manuale" } },
        { web: { uri: "https://manual.example/misti", title: "Manuale" } }
      ] } }]
  })).search(request);
  expect(result.sources).toEqual([{ title: "Manuale", url: "https://manual.example/misti" }]);
});
```

Add failing cases for 401, 429, malformed response, no answer, and no web sources. Assert typed `WebSearchError` reasons.

- [ ] **Step 2: Run RED test**

Run: `pnpm test -- tests/web-search/gemini-grounding.test.ts tests/web-search/web-search-service.test.ts`

Expected: FAIL because adapter/service are absent.

- [ ] **Step 3: Implement adapter and dispatch**

POST the documented Gemini `generateContent` payload with `tools: [{ google_search: {} }]`; send only `question` in `contents`. Parse candidate text and `groundingMetadata.groundingChunks[].web`, validate HTTPS URLs, deduplicate URLs, and cap displayed sources at 12. Map failures to `invalid-key`, `quota`, `network`, `malformed-response`, and `no-answer`.

For this release `dedicated-gemini` is available only with a dedicated key. Return `unsupported-current-provider` for `current-provider`; never silently reroute existing custom/OpenAI-compatible providers.

- [ ] **Step 4: Run GREEN test**

Run: `pnpm test -- tests/web-search/gemini-grounding.test.ts tests/web-search/web-search-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web-search tests/web-search/gemini-grounding.test.ts tests/web-search/web-search-service.test.ts
git commit -m "add Gemini web grounding adapter"
```

### Task 3: Add session-only consent and secure Gemini credentials

**Files:**
- Create: `src/web-search/session-consent.ts`
- Modify: `src/main.ts`
- Test: `tests/web-search/session-consent.test.ts`

**Interfaces:**

```ts
export class SessionWebSearchConsent {
  has(provider: string, model: string): boolean;
  remember(provider: string, model: string): void;
  clear(): void;
}
```

- [ ] **Step 1: Write failing consent test**

```ts
it("remembers consent only for one provider/model pair", () => {
  const consent = new SessionWebSearchConsent();
  consent.remember("gemini", "gemini-2.5-flash");
  expect(consent.has("gemini", "gemini-2.5-flash")).toBe(true);
  expect(consent.has("gemini", "gemini-2.5-pro")).toBe(false);
});
```

- [ ] **Step 2: Run RED test**

Run: `pnpm test -- tests/web-search/session-consent.test.ts`

Expected: FAIL because the consent class is absent.

- [ ] **Step 3: Implement in-memory consent and key boundary**

Use a runtime `Set` keyed by provider/model; never persist it. Add `getWebSearchApiKey()` and `setWebSearchApiKey()` in `main.ts` backed by a dedicated secure-storage name, e.g. `wiki-copilot-advanced-web-search-api-key`. Make plugin web calls accept exactly `{ question, model, apiKey }` and no local retrieval data.

- [ ] **Step 4: Run GREEN test**

Run: `pnpm test -- tests/web-search/session-consent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web-search/session-consent.ts src/main.ts tests/web-search/session-consent.test.ts
git commit -m "add session web search consent"
```

### Task 4: Add settings, consent dialog, and mobile web-search action

**Files:**
- Modify: `src/settings.ts`, `src/ui/wiki-copilot-view.ts`, `styles.css`
- Modify: `src/i18n/en.ts`, `src/i18n/it.ts`, `src/i18n/zh.ts`
- Test: `tests/settings.test.ts`, `tests/mobile-view-interactions.test.ts`

- [ ] **Step 1: Write failing UI/settings tests**

```ts
expect(settingsSource).toContain('heading: t("settings.webSearch.heading")');
expect(settingsSource).toContain('webSearch.mode === "dedicated-gemini"');
expect(viewSource).toContain('this.plugin.requestWebSearchConsent');
expect(styles).toContain('.wiki-copilot-web-search');
```

- [ ] **Step 2: Run RED test**

Run: `pnpm test -- tests/settings.test.ts tests/mobile-view-interactions.test.ts`

Expected: FAIL because controls and consent do not exist.

- [ ] **Step 3: Implement localized controls**

Add mode/model/key settings and an **Include recent chat context** checkbox, disabled by default. Disable and explain `current-provider` until a verified adapter exists. Add a separate 44px “Search the web” action that is unavailable in disabled mode. Present an Obsidian `Modal` saying whether only the typed question or also bounded recent chat context goes to Gemini, include known provider data handling, and offer **Search now**, **Remember for this session**, and **Cancel**. Cancel keeps composer text and creates no assistant turn.

- [ ] **Step 4: Run GREEN test**

Run: `pnpm test -- tests/settings.test.ts tests/mobile-view-interactions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/ui/wiki-copilot-view.ts styles.css src/i18n tests/settings.test.ts tests/mobile-view-interactions.test.ts
git commit -m "add consent-gated web search controls"
```

### Task 5: Persist and render web results independently from Vault citations

**Files:**
- Modify: `src/chat/conversation-types.ts`, `src/chat/conversation-markdown.ts`, `src/ui/wiki-copilot-view.ts`
- Test: `tests/conversation-markdown.test.ts`, `tests/conversation-store.test.ts`, `tests/mobile-view-interactions.test.ts`

- [ ] **Step 1: Write failing round-trip test**

```ts
it("round-trips web metadata separately from Vault sources", () => {
  const saved = conversationWithAssistant({
    sources: [vaultSource("S1")],
    webSearch: { provider: "gemini", model: "gemini-2.5-flash", answer: "30 °C",
      sources: [{ title: "Manuale", url: "https://example.test/manuale" }] }
  });
  expect(parseConversation(toConversationMarkdown(saved))).toEqual(saved);
});
```

- [ ] **Step 2: Run RED test**

Run: `pnpm test -- tests/conversation-markdown.test.ts tests/conversation-store.test.ts tests/mobile-view-interactions.test.ts`

Expected: FAIL because `webSearch` is absent.

- [ ] **Step 3: Implement separate state and rendering**

Extend `AssistantConversationTurn` with optional `webSearch?: WebSearchResult`. Extend the existing hidden assistant-state payload, preserving legacy turns. Validate restored fields defensively and discard invalid web metadata without losing a chat. Render an independent provider-labelled web-source block; open URLs externally and never call `openCitation` or add `S1` markers for web sources.

- [ ] **Step 4: Run GREEN test**

Run: `pnpm test -- tests/conversation-markdown.test.ts tests/conversation-store.test.ts tests/mobile-view-interactions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/conversation-types.ts src/chat/conversation-markdown.ts src/ui/wiki-copilot-view.ts tests/conversation-markdown.test.ts tests/conversation-store.test.ts tests/mobile-view-interactions.test.ts
git commit -m "persist separate web search sources"
```

### Task 6: Integrate without affecting local question answering

**Files:**
- Modify: `src/main.ts`, `src/ui/wiki-copilot-view.ts`
- Test: `tests/app.web-search-flow.test.ts`, `tests/app.bootstrap.test.js`, `tests/prompt.test.ts`

- [ ] **Step 1: Write failing safety-boundary tests**

```ts
it("does not call web search in disabled mode", async () => {
  await harness.view.ask("temperatura Misti");
  expect(harness.webSearch.search).not.toHaveBeenCalled();
  expect(harness.retriever.retrieve).toHaveBeenCalledOnce();
});
it("sends only the explicit question after consent by default", async () => {
  await harness.view.searchWeb("temperatura Misti", "once");
  expect(harness.webSearch.search).toHaveBeenCalledWith(expect.objectContaining({ question: "temperatura Misti" }));
  expect(harness.webSearch.search.mock.calls[0][0]).not.toHaveProperty("history");
  expect(harness.webSearch.search.mock.calls[0][0]).not.toHaveProperty("chunks");
});
it("sends a bounded recent-chat context only when explicitly enabled", async () => {
  await harness.view.searchWeb("a quale temperatura?", "once");
  expect(harness.webSearch.search).toHaveBeenCalledWith(expect.objectContaining({
    question: "a quale temperatura?", history: expect.any(Array)
  }));
  expect(harness.webSearch.search.mock.calls[0][0].history.length).toBeLessThanOrEqual(6);
});
```

- [ ] **Step 2: Run RED test**

Run: `pnpm test -- tests/app.web-search-flow.test.ts tests/app.bootstrap.test.js tests/prompt.test.ts`

Expected: FAIL because the separate web flow is absent.

- [ ] **Step 3: Implement narrow orchestration**

Keep `ask()` unchanged as the Vault-only route. Add a distinct consent-gated `searchWeb()` action that does not call `retrieve()` or `buildAnswerContext()`. By default it sends only the new question; when the new setting is enabled, build a bounded recent-chat context using the same turn/character limiting policy as model history and disclose it in the modal. Render/persist a web assistant turn only after a successful result. Localize typed provider errors and offer retry without exposing API bodies or secrets.

- [ ] **Step 4: Run GREEN test and full verification**

Run: `pnpm test && pnpm build && pnpm verify:brat-beta`

Expected: all tests and build pass; BRAT reports asset hashes. If whole-repository lint still fails only on the known nested worktree, run ESLint for changed production files and record that limitation.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/ui/wiki-copilot-view.ts tests/app.web-search-flow.test.ts tests/app.bootstrap.test.js tests/prompt.test.ts
git commit -m "add optional Gemini web search"
```

## Plan Self-Review

- Tasks 1–4 cover mode selection, Gemini configuration, capability limits, consent, privacy, localization, and mobile controls.
- Tasks 2 and 6 make Gemini the sole concrete adapter and explicitly protect the unchanged local retrieval path.
- Task 5 keeps persisted and displayed web sources independent from Vault citations.
- All interfaces used by later tasks are defined in Tasks 1–3; each task starts with a failing test and ends with a focused commit.
