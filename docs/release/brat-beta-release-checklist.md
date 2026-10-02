# BRAT beta release checklist

Use this checklist to distribute a beta of the advanced fork through BRAT. This is
not a Community Plugins release and must not be published through the Community
Plugins registry.

## Required release metadata

- `manifest.json` must use `"id": "wiki-copilot-advanced"` and
  `"name": "Wiki Copilot Advanced"`.
- The beta version is `2.1.1-beta.1`. It must match exactly in `package.json`,
  `manifest.json`, and the Git tag.
- `versions.json` must contain `"2.1.1-beta.1": "1.13.0"`.
- Keep `minAppVersion` at `1.13.0` and `isDesktopOnly` at `false`.

## Build and release assets

1. Run `pnpm check` and then `pnpm verify:brat-beta` from a clean worktree.
   The verifier performs a fresh production build and reports the SHA-256 hash
   and sizes of the release assets.
2. Confirm the release upload contains exactly the generated `main.js` plus
   `manifest.json` and `styles.css` from the same commit.
3. Create the Git tag `2.1.1-beta.1` on that commit.
4. Create the GitHub Release named `2.1.1-beta.1` for tag `2.1.1-beta.1`, and
   attach `main.js`, `manifest.json`, and `styles.css`.
5. In BRAT, add the repository and choose release `2.1.1-beta.1`; verify that
   a clean vault installs it under `.obsidian/plugins/wiki-copilot-advanced/`.
   Confirm it can be enabled without copying files from another plugin folder.

## Mobile beta acceptance

1. Install the BRAT release on an Android or iOS device running Obsidian 1.13.0
   or newer, then enable **Wiki Copilot Advanced**.
2. Open the plugin from the mobile layout, ask a short question, and confirm a
   response appears without desktop-only API errors.
3. Verify the input remains usable with the software keyboard open and that a
   citation can open its referenced note and heading.
4. Disable and re-enable the plugin, reopen Obsidian, and confirm the plugin
   starts normally and previously saved settings remain available.
5. In the same clean vault, install and enable the original `wiki-copilot`
   plugin alongside `wiki-copilot-advanced`. Open both plugins and ask each a
   short question to confirm their commands, settings, and stored data remain
   isolated and both can run at the same time.
