# BRAT beta release checklist

Use this checklist to distribute a beta of the advanced fork through BRAT. This is
not a Community Plugins release and must not be published through the Community
Plugins registry.

## Required release metadata

- `manifest.json` must use `"id": "wiki-copilot-advanced"` and
  `"name": "Wiki Copilot Advanced"`.
- The beta version is `<beta-version>`. It must match exactly in `package.json`,
  `manifest.json`, and the Git tag.
- `versions.json` must contain `"<beta-version>": "1.13.0"`.
- Keep `minAppVersion` at `1.13.0` and `isDesktopOnly` at `false`.

## Build and release assets

1. From a clean worktree run `pnpm test`, `pnpm build`, and then
   `pnpm verify:brat-beta`. Run `pnpm lint` as well; if nested worktrees make
   the global lint scope impractical, run ESLint on the changed production
   files and record that limitation. The verifier performs a fresh production
   build and reports the SHA-256 hash and sizes of the release assets.
2. Confirm the release upload contains exactly the generated `main.js` plus
   `manifest.json` and `styles.css` from the same commit.
3. Create the Git tag `<beta-version>` on that commit.
4. Create the GitHub Release named `<beta-version>` for tag `<beta-version>`, and
   attach `main.js`, `manifest.json`, and `styles.css`.
5. In BRAT, add the repository and choose release `<beta-version>`; verify that
   a clean vault installs it under `.obsidian/plugins/wiki-copilot-advanced/`.
   Confirm it can be enabled without copying files from another plugin folder.

## Mobile beta acceptance

1. Install the BRAT release on an Android or iOS device running Obsidian 1.13.0
   or newer, then enable **Wiki Copilot Advanced**.
2. Open the plugin from the mobile layout, ask a short question, and confirm a
   response appears without desktop-only API errors.
3. Verify the input remains usable with the software keyboard open and that a
   citation can open its referenced note and heading.
4. Configure a dedicated Gemini web-search key. Confirm the pulsante Web compatto
   fits alongside the composer controls, becomes enabled after saving valid Gemini
   settings, and remains usable with the software keyboard open.
5. Start a web search and verify the consenso dialog identifies Gemini, states that
   only the new question is sent by default, and offers recent chat context only
   as a separate opt-in. On mobile cancel the dialog once with the X/close control
   and once with a tap outside the dialog: neither action may send a request. On
   desktop or with a hardware keyboard, also verify that Escape cancels it.
6. Start a web search, use the normal Stop control while it is loading, and confirm
   the request is annullato without a network-error message, saved answer, or saved
   fonti web. Start another web search afterwards to confirm the control recovers.
7. Complete one local Vault question and one web question. Confirm their sources
   remain visibly separate: Vault citations open notes, while fonti web are external
   links. Confirm the web request does not reuse the normal chat-provider key.
8. Disable and re-enable the plugin, reopen Obsidian, and confirm the plugin
   starts normally and previously saved settings remain available.
9. In the same clean vault, install and enable the original `wiki-copilot`
   plugin alongside `wiki-copilot-advanced`. Open both plugins and ask each a
   short question to confirm their commands, settings, and stored data remain
   isolated and both can run at the same time.
