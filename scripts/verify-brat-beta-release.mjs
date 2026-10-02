import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = ["main.js", "manifest.json", "styles.css"];

await run(process.execPath, ["esbuild.config.mjs", "production"], { cwd: projectRoot });

for (const asset of assets) {
  const path = resolve(projectRoot, asset);
  await access(path);
  const { size } = await stat(path);
  if (size === 0) {
    throw new Error(`${asset} is empty after the production build`);
  }

  if (asset === "main.js") {
    const hash = createHash("sha256").update(await readFile(path)).digest("hex");
    console.log(`${asset} sha256: ${hash} (${size} bytes)`);
  } else {
    console.log(`${asset}: ${size} bytes`);
  }
}
