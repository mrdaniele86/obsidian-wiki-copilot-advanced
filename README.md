# Wiki Copilot

[English](README.md) | [简体中文](README_zh.md)

Wiki Copilot is an Obsidian question-answering plugin for **persistent LLM Wikis**. It treats a vault as a structured knowledge system instead of a flat collection of interchangeable chunks: schema files describe the local conventions, Wiki pages provide curated knowledge, and source Markdown provides traceable evidence.

When a model is configured, both retrieval modes first ask it for bounded lexical search phrases while always retaining the original question. Fast retrieval uses 3–6 variants over the curated Wiki index with MiniSearch and Wikilink expansion; precise retrieval uses 4–10 variants, then cooperatively checks every eligible Markdown body and extracts only the highest-relevance sections. No embedding service is required. The planner receives the resolved question and a bounded recent conversation window, never Vault bodies; only passages selected for the current question are sent to the answer model.

## Features

- Automatically detects Schema, Index, Topic, Concept, Summary, stable-source, and pending-source roles.
- Fast mode merges a small set of model-planned lexical searches over curated Index, Topic, Concept, Summary, and Wiki fragments only.
- Precise mode uses a broader query plan and scans every eligible Markdown body, including source Markdown from all configured source directories.
- Preserves model numbers, document IDs, paths, compound terms, and camel-case identifiers during lexical retrieval.
- Expands related notes through outgoing links and backlinks while reducing the influence of hub pages.
- Falls back to a bounded, query-time lexical scan on mobile when the device-local index has no result, then routes recovered notes through the normal ranking and citation pipeline.
- Provides a recommended precise full-Markdown scan plus a fast curated-Wiki-only mode.
- Renders traceable citations that open the exact Obsidian note and heading.
- Provides an index diagnostics command for comparing Obsidian-visible files with device-indexed Wiki and source coverage.
- Streams OpenAI-compatible answers with cancellation, incremental Markdown rendering, and a non-streaming compatibility mode.
- Stores API keys in Obsidian Secret Storage instead of plugin settings files.
- Avoids Node.js, Electron-only APIs, native databases, and local helper services; `isDesktopOnly` is `false`.

## Installation

Wiki Copilot requires Obsidian 1.13.0 or later. For manual installation, copy `main.js`, `manifest.json`, and `styles.css` into `<vault-config-dir>/plugins/wiki-copilot/`, then enable **Wiki Copilot** under Community plugins.

Choose DeepSeek, OpenAI, or another OpenAI-compatible service in the plugin settings. Without a configured model, the Send button returns local retrieval results; with a configured model, it generates an answer with citations.

## Privacy and vault access

- Index data is never sent to the model provider. Mobile builds use device-local IndexedDB and do not read the desktop JSON cache that may be present in an iCloud vault; desktop builds currently use the vault configuration directory.
- With a configured model, query planning sends the resolved question plus at most four recent conversation turns: fast mode requests 3–6 variants and precise mode requests 4–10. Planning failure safely falls back to the original question.
- Fast mode reads from the persistent curated-Wiki index. Precise mode reads each eligible Markdown body cooperatively for the current question, retains only lightweight file candidates during the scan, and then extracts a bounded set of relevant sections.
- Stable and pending source directories remain internal indexing roles. Precise mode presents matching passages uniformly as source evidence; fast mode excludes all source bodies.
- Source text is treated as untrusted data; model instructions explicitly tell the model to ignore instructions embedded in retrieved notes.
- Wiki Copilot does not automatically modify Wiki or source notes in the current release.

## Roadmap

1. Add an explicit **refine and save** workflow that turns a high-quality Q&A result into a reviewable Wiki draft, preserves its evidence links, and writes it only after user confirmation.
2. Add optional embedding-based hybrid retrieval while preserving the existing lexical, exact-identifier, Wikilink, and layered-Wiki retrieval paths.

Mobile reliability, streaming compatibility, and citation behavior remain release acceptance criteria rather than separate feature roadmap items.

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm check
pnpm deploy
```

By default, `pnpm deploy` copies the build artifacts to `obsidian/.obsidian/plugins/wiki-copilot/` next to the source repository. Set `WIKI_COPILOT_VAULT_ROOT` to deploy to another vault:

```powershell
$env:WIKI_COPILOT_VAULT_ROOT = "C:\path\to\vault"
pnpm deploy
```

Community plugin releases must include `main.js`, `manifest.json`, and `styles.css`.

## License

MIT
