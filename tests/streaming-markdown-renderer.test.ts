import { afterEach, describe, expect, it, vi } from "vitest";

const renderMock = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => {
  class Component {
    private children: Component[] = [];

    load(): void {
      this.onload();
    }

    unload(): void {
      this.onunload();
      for (const child of this.children.splice(0)) {
        child.unload();
      }
    }

    onload(): void {}

    onunload(): void {}

    addChild<T extends Component>(child: T): T {
      this.children.push(child);
      child.load();
      return child;
    }

    removeChild<T extends Component>(child: T): T {
      this.children = this.children.filter((candidate) => candidate !== child);
      child.unload();
      return child;
    }
  }

  return {
    App: class {},
    Component,
    MarkdownRenderer: { render: renderMock }
  };
});

import { StreamingMarkdownRenderer } from "../src/ui/streaming-markdown-renderer";

interface FakeContainer {
  ownerDocument: { defaultView: Window };
  rendered: string;
  fallbackText: string;
  empty(): void;
  setText(value: string): void;
}

function fakeWindow(): Window {
  return {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  } as unknown as Window;
}

function fakeContainer(): FakeContainer {
  return {
    ownerDocument: { defaultView: fakeWindow() },
    rendered: "",
    fallbackText: "",
    empty() {
      this.rendered = "";
      this.fallbackText = "";
    },
    setText(value: string) {
      this.fallbackText = value;
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
  renderMock.mockReset();
});

describe("StreamingMarkdownRenderer", () => {
  it("coalesces rapid token updates into one Markdown render", async () => {
    vi.useFakeTimers();
    const container = fakeContainer();
    renderMock.mockImplementation(async (_app, markdown: string, target: FakeContainer) => {
      target.rendered = markdown;
    });
    const onRendered = vi.fn();
    const renderer = new StreamingMarkdownRenderer(
      {} as never,
      container as unknown as HTMLElement,
      "",
      { shouldKeepPinned: () => true, onRendered }
    );
    renderer.load();

    renderer.update("第一");
    renderer.update("第一段");
    await vi.advanceTimersByTimeAsync(89);
    expect(renderMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(renderMock).toHaveBeenCalledOnce();
    expect(renderMock.mock.calls[0]?.[1]).toBe("第一段");
    expect(container.rendered).toBe("第一段");
    expect(onRendered).toHaveBeenCalledWith(true);
  });

  it("finalizes immediately and cancels a pending scheduled render", async () => {
    vi.useFakeTimers();
    const container = fakeContainer();
    renderMock.mockImplementation(async (_app, markdown: string, target: FakeContainer) => {
      target.rendered = markdown;
    });
    const renderer = new StreamingMarkdownRenderer({} as never, container as unknown as HTMLElement);
    renderer.load();

    renderer.update("部分");
    await renderer.finalize("最终回答");
    await vi.runAllTimersAsync();

    expect(renderMock).toHaveBeenCalledOnce();
    expect(container.rendered).toBe("最终回答");
  });

  it("cancels scheduled work when its conversation component unloads", async () => {
    vi.useFakeTimers();
    const container = fakeContainer();
    renderMock.mockResolvedValue(undefined);
    const renderer = new StreamingMarkdownRenderer({} as never, container as unknown as HTMLElement);
    renderer.load();

    renderer.update("不会渲染");
    renderer.unload();
    await vi.runAllTimersAsync();

    expect(renderMock).not.toHaveBeenCalled();
  });
});
