# Citation Return to Chat Design

## Goal

Let a mobile user return from an opened citation preview to the exact Wiki Copilot
chat leaf that opened it, without creating a new view or resetting conversation state.

## Behavior

When a citation opens, the plugin records the initiating `WorkspaceLeaf` together
with its reusable preview leaf. The preview exposes a localized **Return to chat**
action. Activating it reveals the recorded chat leaf. The chat's existing DOM,
scroll position, conversation, and pending state are untouched.

If the recorded chat leaf is no longer attached or no longer contains a
`WikiCopilotView`, the action reports a localized unavailable message and does not
call the normal open-chat command or create a replacement leaf.

## Architecture

The plugin owns preview-to-origin associations and validates leaves with the
existing workspace traversal logic. `WikiCopilotView` remains the origin view and
does not reconstruct its state. The preview action is installed only for citation
previews and uses `workspace.revealLeaf(originLeaf)`.

## Tests

- Citation open records the origin chat leaf.
- Return action reveals that same leaf.
- Detached/non-chat origin reports a localized failure and creates no chat leaf.
- Existing citation preview behavior, reading mode, heading navigation, and mobile
  regression tests remain green.
