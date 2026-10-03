# Web Search Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task by task.

**Goal:** Rendere annullabile, validata e verificabile la ricerca web Gemini, mantenendo separati consenso, Vault e chat standard.

**Architecture:** La vista è proprietaria del ciclo di vita della richiesta e propaga un segnale di annullamento fino al client Gemini. Il parser Markdown tratta i metadati web come input non fidato. Le impostazioni espongono solo capacità effettivamente supportate.

**Tech Stack:** TypeScript, Obsidian API, Vitest, pnpm, BRAT.

**Spec:** `docs/superpowers/specs/2026-10-04-web-search-reliability-design.md`

## Vincoli globali

- Non modificare il flusso standard Invia/Vault.
- Non inviare Vault, nota attiva, cronologia completa o chiave chat a Gemini web.
- Conservare il timeout di 30 secondi e distinguere timeout da annullamento utente.
- Non pubblicare una beta senza conferma esplicita dell'utente.

## Task 1: ciclo di vita e cancellazione

**Files:**
- Modify: `src/ui/wiki-copilot-view.ts`
- Modify: `src/main.ts`
- Modify: `src/web-search/web-search-service.ts`
- Modify: `src/web-search/gemini-grounding.ts`
- Modify: `src/web-search/types.ts`
- Test: `tests/web-search/gemini-grounding.test.ts`
- Test: `tests/web-search/web-search-service.test.ts`
- Test: `tests/app.web-search-flow.test.ts`

1. Scrivere test che distinguano `cancelled` da `timeout` e verifichino la propagazione di `AbortSignal`.
2. Introdurre il codice errore `cancelled` e farlo attraversare client, servizio, main e vista.
3. Tenere un controller per la sola ricerca web attiva; annullarlo in stop, nuova conversazione, chiusura e nuova ricerca.
4. Verificare che un annullamento non persista risposta o fonti e non mostri un errore di rete.
5. Eseguire i test mirati.

## Task 2: validazione dei metadati web persistiti

**Files:**
- Modify: `src/chat/conversation-markdown.ts`
- Test: `tests/chat/conversation-markdown.test.ts`

1. Scrivere casi per URL HTTP, campi vuoti, fonti oltre dodici e stringhe oltre limite.
2. Centralizzare limiti e validazione di provider, HTTPS, domanda, modello, risposta, fonti e titoli.
3. Mantenere il turno assistente e le fonti Vault quando il solo blocco web è invalido.
4. Eseguire il test mirato.

## Task 3: impostazioni di capacità reali

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/web-search/types.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/it.ts`
- Modify: `src/i18n/zh.ts`
- Test: `tests/settings.test.ts`
- Test: `tests/web-search/types.test.ts`

1. Scrivere test per il valore legacy `current-provider` normalizzato a disabilitato.
2. Mostrare nell'interfaccia soltanto Disabilitato e Gemini dedicato.
3. Conservare difese runtime che impediscano a configurazioni legacy di avviare web search o usare la chiave chat.
4. Eseguire i test mirati.

## Task 4: test comportamentali e checklist BRAT

**Files:**
- Modify: `tests/app.web-search-flow.test.ts`
- Modify: `tests/brat-beta-release.test.ts`
- Modify: `docs/release/brat-beta-release-checklist.md`

1. Sostituire le asserzioni fragili sul testo del sorgente con verifiche del contratto osservabile dove praticabile.
2. Rendere la checklist indipendente dal numero di beta.
3. Aggiungere i controlli mobile e di annullamento della ricerca web.
4. Eseguire test mirati e `pnpm verify:brat-beta`.

## Task 5: integrazione e quality gate

1. Revisionare ogni task contro la specifica con un subagent indipendente.
2. Eseguire `pnpm test`, `pnpm build` e `pnpm verify:brat-beta`.
3. Eseguire il lint nel perimetro del repository; se il comando globale attraversa worktree annidati, registrare esplicitamente la limitazione e usare lint mirato sui file di produzione modificati.
4. Preparare, ma non pubblicare, la successiva beta finché l'utente non conferma.
