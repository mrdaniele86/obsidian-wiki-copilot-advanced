import { readFileSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const execFile = promisify(execFileCallback);
const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/u;

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
  it("ships the advanced fork identity and a consistent beta version", () => {
    const manifest = readJson<Manifest>("manifest.json");
    const packageJson = readJson<{ version: string }>("package.json");
    const versions = readJson<Record<string, string>>("versions.json");

    expect(manifest).toMatchObject({
      id: "wiki-copilot-advanced",
      name: "Wiki Copilot Advanced",
      minAppVersion: "1.13.0",
      isDesktopOnly: false
    });
    expect(manifest.version).toMatch(betaVersionPattern);
    expect(packageJson.version).toBe(manifest.version);
    expect(versions[manifest.version]).toBe("1.13.0");
  });

  it("keeps the BRAT checklist beta-neutral and covers web-search mobile safety", () => {
    const checklist = readFileSync(resolve(projectRoot, "docs/release/brat-beta-release-checklist.md"), "utf8");

    expect(checklist).not.toMatch(/\d+\.\d+\.\d+-beta\.\d+/u);
    expect(checklist).toContain("<beta-version>");
    expect(checklist).toContain("pulsante Web compatto");
    expect(checklist).toContain("consenso");
    expect(checklist).toContain("annull");
    expect(checklist).toContain("fonti web");
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
