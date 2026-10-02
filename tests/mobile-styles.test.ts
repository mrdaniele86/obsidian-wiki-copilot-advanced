import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("mobile interaction styles", () => {
  it("uses a 16px composer font to avoid iOS focus zoom", () => {
    expect(styles).toMatch(
      /body\.is-mobile textarea\.wiki-copilot-input\s*\{[^}]*font-size:\s*16px;/su
    );
  });

  it("provides mobile-sized header, send, and source disclosure targets", () => {
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-header-actions \.clickable-icon[^{]*\{[^}]*min-height:\s*44px;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer-buttons button\s*\{[^}]*min-height:\s*44px;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-sources summary\s*\{[^}]*min-height:\s*44px;/su
    );
  });

  it("uses a compact single-row composer instead of a stacked full-width send panel", () => {
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer-buttons\s*\{[^}]*width:\s*auto;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer-buttons button\s*\{[^}]*width:\s*64px;/su
    );
  });

  it("uses measured floating-navbar clearance without a second keyboard transform", () => {
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer\s*\{[^}]*padding:\s*8px 10px;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile\.is-phone \.wiki-copilot-composer\s*\{[^}]*margin-bottom:\s*var\(\s*--wiki-copilot-mobile-nav-clearance,\s*var\(--view-bottom-spacing, 0px\)\s*\);/su
    );
    expect(styles).not.toMatch(/keyboard-animating[^}]*wiki-copilot-composer/su);
    expect(styles).not.toContain("--wiki-copilot-composer-lift");
    expect(styles).not.toMatch(/wiki-copilot-composer[^}]*transform:/su);
  });

  it("keeps each mobile history entry as one compact row with an internal delete target", () => {
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-history-entry\s*\{[^}]*min-width:\s*0;[^}]*gap:\s*4px;[^}]*border:\s*1px solid var\(--background-modifier-border\);/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-history-item\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-history-delete\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/su
    );
  });

  it("keeps mobile composer content above the browser navigation safe area", () => {
    expect(styles).toMatch(
      /body\.is-mobile\.is-phone \.wiki-copilot-composer\s*\{[^}]*padding-bottom:\s*max\(\s*8px,\s*env\(safe-area-inset-bottom\)\s*\);/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer-controls\s*\{[^}]*min-width:\s*0;/su
    );
  });

  it("draws a consistent disclosure triangle for source evidence", () => {
    expect(styles).toMatch(
      /\.wiki-copilot-sources summary::before\s*\{[^}]*border-left:\s*6px solid currentColor;/su
    );
    expect(styles).toMatch(
      /\.wiki-copilot-sources\[open\] summary::before\s*\{[^}]*transform:\s*rotate\(90deg\);/su
    );
  });

  it("caps the auto-growing mobile textarea at a compact height", () => {
    expect(styles).toMatch(
      /body\.is-mobile textarea\.wiki-copilot-input\s*\{[^}]*min-height:\s*calc\(2\.8em \+ 22px\);[^}]*max-height:\s*120px;/su
    );
  });

  it("reserves two placeholder lines in the mobile composer while keeping the send control aligned", () => {
    expect(styles).toMatch(
      /body\.is-mobile textarea\.wiki-copilot-input\s*\{[^}]*box-sizing:\s*border-box;[^}]*min-height:\s*calc\(2\.8em \+ 22px\);/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-composer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*align-items:\s*end;/su
    );
  });

  it("gives the mobile settings introduction comfortable internal spacing", () => {
    expect(styles).toMatch(
      /body\.is-mobile \.setting-item\.wiki-copilot-settings-intro\s*\{[^}]*margin-bottom:\s*28px;[^}]*padding:\s*18px 20px 20px;/su
    );
    expect(styles).toMatch(
      /body\.is-mobile \.wiki-copilot-settings-intro \.setting-item-description\s*\{[^}]*margin-top:\s*8px;[^}]*line-height:\s*1\.55;/su
    );
  });
});
