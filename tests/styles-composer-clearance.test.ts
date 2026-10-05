import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("desktop composer status-bar clearance", () => {
  it("reserves the desktop status bar without changing the mobile composer selector", () => {
    expect(styles).toMatch(/\.wiki-copilot-composer\s*\{[\s\S]*padding:[^;]*var\(--status-bar-height,\s*0px\)/);
    expect(styles).toMatch(/body\.is-mobile\s+\.wiki-copilot-composer\s*\{/);
  });
});
