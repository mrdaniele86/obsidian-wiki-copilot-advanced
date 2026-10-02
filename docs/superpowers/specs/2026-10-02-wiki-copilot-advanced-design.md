# Wiki Copilot Advanced design

## Scope

This change adds four user-facing capabilities while preserving the existing lexical retrieval pipeline, citation format, provider configuration, MIT license text, and mobile support (`isDesktopOnly: false`):

1. User-interface localization in Italian, English, and Simplified Chinese.
2. Persistent, vault-backed chat conversations.
3. Citation opening that leaves the chat view available.
4. An Obsidian URI entry point for Siri and Shortcuts.

Provider presets, embeddings, vector databases, and a general mobile UI redesign are out of scope.

## Localization

`src/i18n/` owns a typed translation key set and three locale dictionaries (`it`, `en`, `zh`). The `Auto` preference resolves from the Obsidian or system language when available and falls back to English. Users can explicitly select Italian, English, or Chinese in settings. UI code, setting definitions, commands, progress states, errors, and accessible labels obtain displayed text through the translator rather than embedding language-specific strings.

The selected language is persisted in plugin settings. Saving it refreshes open plugin views, so the setting takes effect without restarting Obsidian. Unrecognized stored values migrate safely to `auto`.

## Conversations

`src/chat/` owns conversation types, Markdown serialization/parsing, and the vault store. Its default folder is `Memory Copilot/Conversations`, exposed as a configurable setting. This location is a normal vault path: it is readable without the plugin and syncs through ordinary Obsidian Sync or third-party vault synchronization.

The current chat receives an ID and is written after each completed assistant turn. Its filename combines a local timestamp with a sanitized, abbreviated first user message. Markdown front matter contains the type, ID, creation timestamp, and update timestamp; the body contains ordered user and assistant sections. The history list reads this folder, opens a selected conversation, rebuilds the in-memory turns, and resumes it. A new-chat action creates an empty conversation state without deleting saved files.

Malformed or manually edited files are ignored from the history list with a user-visible, localized error when explicitly opened. Failures to read or write the configured folder leave the in-memory conversation intact and show a localized error.

## Citation opening

The existing citation controller will use a dedicated preview leaf (or equivalent temporary leaf) rather than replace the chat leaf. Citation state and scroll position therefore remain in the chat view. The default behavior is appropriate on mobile and desktop: select a citation, inspect the source, close or navigate back, and return to the still-live chat.

No citation text, retrieval ranking, or source evidence representation changes.

## Siri and Shortcuts URI

The plugin registers an Obsidian protocol handler for the stable plugin route. It accepts URL-decoded `query`, plus optional `newchat` and `send` flags. It opens or activates the Wiki Copilot view, optionally starts a new conversation, inserts the query, and sends it only when `send=true`.

Invalid or missing parameters do not submit a request. The handler uses only Obsidian-supported APIs and follows the same lifecycle as normal view activation, preserving mobile compatibility.

## Tests and verification

Tests cover locale resolution and fallback, settings migration, conversation Markdown round trips and folder behavior, history restoration, citation leaf selection, and protocol parameter parsing. Existing retrieval tests remain unchanged and are run as regression coverage. Final verification runs lint, the complete test suite, and the production build.
