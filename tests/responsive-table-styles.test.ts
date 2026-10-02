import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
  .replace(/\r\n/gu, "\n");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(styles)?.[1] ?? "";
}

describe("responsive answer tables", () => {
  it("uses the sent-question font and size for answers and their tables", () => {
    const message = ruleBody(".wiki-copilot-message-body");
    const answer = ruleBody(".wiki-copilot-message-body.markdown-rendered");
    const tableText = ruleBody(
      '.workspace-leaf-content[data-type="wiki-copilot-view"]\n  .wiki-copilot-message-body.markdown-rendered\n  :is(table, th, td)'
    );

    expect(message).toContain("font-family: inherit;");
    expect(message).toContain("font-size: inherit;");
    expect(answer).toContain("--table-header-size: 1em;");
    expect(answer).toContain("--table-text-size: 1em;");
    expect(answer).toContain("font-family: inherit;");
    expect(answer).toContain("font-size: inherit;");
    expect(tableText).toContain("font-family: inherit;");
    expect(tableText).toContain("font-size: inherit;");
  });

  it("fits ordinary tables to the answer bubble instead of forcing intrinsic width", () => {
    const table = ruleBody(".wiki-copilot-message-body.markdown-rendered table");
    expect(table).toContain("width: 100%;");
    expect(table).not.toContain("max-content");
  });

  it("keeps horizontal overflow local to genuinely wide tables", () => {
    const wrapper = ruleBody(
      ".wiki-copilot-message-body.markdown-rendered :is(.table-wrapper, .el-table)"
    );
    expect(wrapper).toContain("overflow-x: auto;");
    expect(wrapper).toContain("overscroll-behavior-inline: contain;");
  });

  it("responds to the Copilot panel width rather than the whole Obsidian window", () => {
    const view = ruleBody(".wiki-copilot-view");
    expect(view).toContain("container-name: wiki-copilot;");
    expect(view).toContain("container-type: inline-size;");
    expect(styles).toContain("@container wiki-copilot (max-width: 520px)");
  });
});
