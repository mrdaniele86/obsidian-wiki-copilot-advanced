# Fuzzy History Search Design

## Goal

Let mobile and desktop users find saved Wiki Copilot conversations by title,
user questions, or assistant responses through an on-demand fuzzy search panel.

## Scope

- Add a Search header action beside the rebuild-index and history actions.
- Search only the existing vault-backed Markdown conversation files.
- Search title and every saved turn; do not create a second index or new vault file.
- Show ranked results with the conversation title and a short matching excerpt.
- Open a selected result using the existing conversation restore flow, then close the
  search panel.
- Close the panel on an outside pointer interaction.
- Keep the existing history panel behavior and delete controls unchanged.

## Interaction

Pressing Search opens the same temporary panel area used for history. The panel
contains a focused text input. An empty query displays the normal history list.
As the query changes, the panel filters all saved conversations in memory. A
result exposes its title and a concise excerpt from the matching title, user
turn, or assistant turn. Pressing a result restores that conversation; pressing
outside closes the panel.

## Matching

The matcher normalizes case, accents, punctuation, and whitespace. It uses an
in-process fuzzy subsequence score with bonuses for contiguous characters and
word starts. A conversation contributes its best match among title, user turns,
and assistant turns. Results sort by descending score and then by most recent
`updatedAt`. A blank query never computes a score and preserves normal newest-
first history ordering.

## Architecture

`src/chat/conversation-search.ts` owns pure normalization, scoring, excerpt, and
ranking functions over `StoredConversation` values. `WikiCopilotView` owns the
search action, input lifecycle, panel state, and selection. It requests the
already-supported `ConversationStore.list(folder)` data and passes it into the
pure matcher; the store and Markdown format remain unchanged.

## Error handling

Failures to list history reuse the existing localized history-load error. A
no-match query renders a localized empty-search state. Search itself never
writes, alters, or deletes a conversation.

## Tests

- Case/diacritic/punctuation-insensitive matching and minor typo tolerance.
- Matches from titles, user turns, and assistant turns.
- Best-match score, deterministic ordering, and result excerpts.
- Blank-query newest-first order and no-match state.
- View-level search icon, open/close behavior, selection restore, and outside
  pointer close on mobile-compatible controls.
