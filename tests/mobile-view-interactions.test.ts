import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewSource = readFileSync(
  new URL("../src/ui/wiki-copilot-view.ts", import.meta.url),
  "utf8"
);

describe("mobile view interactions", () => {
  it("dismisses the keyboard from the message region instead of intercepting the send button", () => {
    expect(viewSource).toContain('this.registerDomEvent(this.chatEl, "pointerdown"');
    expect(viewSource).not.toContain('this.registerDomEvent(container, "pointerdown"');
    expect(viewSource).toContain('this.registerDomEvent(this.askButton, "mousedown"');
    expect(viewSource).toContain("event.preventDefault();");
  });

  it("does not render response performance metrics", () => {
    expect(viewSource).not.toContain("wiki-copilot-response-timing");
    expect(viewSource).not.toContain("updateTiming");
    expect(viewSource).not.toContain("AnswerTimingTracker");
  });

  it("does not expose the textarea label as an Obsidian hover tooltip", () => {
    expect(viewSource).toContain('placeholder: "询问当前知识库…"');
    expect(viewSource).not.toContain('"aria-label": "向 Wiki Copilot 提问"');
  });

  it("coalesces mobile textarea measurements to one animation frame", () => {
    expect(viewSource).toContain(
      'this.registerDomEvent(this.queryEl, "input", () => this.scheduleComposerResize())'
    );
    expect(viewSource).toContain("viewWindow.requestAnimationFrame");
    expect(viewSource).toContain("cancelAnimationFrame(this.composerResizeFrame)");
    expect(viewSource).not.toContain(
      'this.registerDomEvent(this.queryEl, "input", () => this.resizeComposer())'
    );
  });

  it("keeps the keyboard-open layout through the delayed iOS viewport close", () => {
    expect(viewSource).toContain('this.registerDomEvent(this.queryEl, "focus"');
    expect(viewSource).toContain('this.registerDomEvent(this.queryEl, "blur"');
    expect(viewSource).not.toContain("is-composer-focused");
    expect(viewSource).not.toContain("is-mobile-keyboard-visible");
    expect(viewSource).toContain("nextMobileKeyboardVisible(this.mobileKeyboardVisible");
    expect(viewSource).toContain('viewport?.addEventListener("resize"');
    expect(viewSource).toContain('viewport?.addEventListener("scroll"');
    expect(viewSource).toContain('querySelector<HTMLElement>(".mobile-navbar")');
    expect(viewSource).toContain("mobileNavigationClearance(");
    expect(viewSource).toContain('container.style.setProperty("--wiki-copilot-mobile-nav-clearance"');
  });
});
