import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("desktop composer status-bar clearance", () => {
  it("adds desktop status and view clearance above the normal composer spacing", () => {
    expect(styles).toMatch(/\.wiki-copilot-composer\s*\{\s*flex:[^;]+;\s*padding:\s*var\(--size-4-2\)\s+var\(--size-4-3\)\s+calc\(\s*var\(--size-4-3\)\s*\+\s*var\(--status-bar-height,\s*0px\)\s*\+\s*var\(--view-bottom-spacing,\s*0px\)\s*\)/);
    expect(styles).not.toMatch(/\.wiki-copilot-composer\s*\{\s*flex:[^;]+;\s*padding:[^;]*max\(/);
  });

  it("does not change the mobile composer selector", () => {
    expect(styles).toMatch(/body\.is-mobile\s+\.wiki-copilot-composer\s*\{/);
  });
});
