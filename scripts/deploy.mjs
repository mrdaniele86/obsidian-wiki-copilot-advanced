import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vaultRoot = process.env.WIKI_COPILOT_VAULT_ROOT?.trim()
  ? resolve(process.env.WIKI_COPILOT_VAULT_ROOT)
  : resolve(projectRoot, "..", "obsidian");
const target = resolve(vaultRoot, ".obsidian", "plugins", "wiki-copilot");

await mkdir(target, { recursive: true });
await Promise.all(
  ["main.js", "manifest.json", "styles.css"].map((file) =>
    copyFile(resolve(projectRoot, file), resolve(target, file))
  )
);

console.log(`Wiki Copilot deployed to ${target}`);
