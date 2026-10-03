import { readFileSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const betaVersion = "2.1.1-beta.6";
const execFile = promisify(execFileCallback);

type Manifest = {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  isDesktopOnly: boolean;
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(projectRoot, file), "utf8")) as T;
}

describe("BRAT beta release artifacts", () => {
  it("ships the advanced fork identity and a versioned mobile-compatible manifest", () => {
    const manifest = readJson<Manifest>("manifest.json");
    const packageJson = readJson<{ version: string }>("package.json");
    const versions = readJson<Record<string, string>>("versions.json");

    expect(manifest).toMatchObject({
      id: "wiki-copilot-advanced",
      name: "Wiki Copilot Advanced",
      version: betaVersion,
      minAppVersion: "1.13.0",
      isDesktopOnly: false
    });
    expect(packageJson.version).toBe(betaVersion);
    expect(versions[betaVersion]).toBe("1.13.0");
  });

  it("rebuilds the BRAT assets and reports their generated main bundle hash", async () => {
    const { stdout } = await execFile(process.execPath, ["scripts/verify-brat-beta-release.mjs"], {
      cwd: projectRoot
    });

    expect(stdout).toContain("main.js sha256:");
    expect(stdout).toContain("manifest.json");
    expect(stdout).toContain("styles.css");
  });
});
