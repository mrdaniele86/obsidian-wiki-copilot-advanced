import { describe, expect, it, vi } from "vitest";
import { yieldToUi } from "../src/core/cooperative";
import { LinkGraph } from "../src/core/link-graph";
import { WikiSearchIndex } from "../src/core/search-index";
import type { MarkdownChunk, NoteMetadata } from "../src/core/types";

const metadata: NoteMetadata = {
  path: "wiki/topics/响应性.md",
  basename: "响应性",
  aliases: [],
  tags: [],
  role: "topic"
};

describe("cooperative indexing", () => {
  it("uses an event-loop task instead of throttled timers when MessageChannel is available", async () => {
    const timer = vi.fn(() => 1);
    class ImmediateMessageChannel {
      readonly port1 = {
        onmessage: null as (() => void) | null,
        close: vi.fn()
      };
      readonly port2 = {
        postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
        close: vi.fn()
      };
    }

    await yieldToUi({
      requestAnimationFrame: vi.fn(() => 1),
      setTimeout: timer,
      clearTimeout: vi.fn(),
      MessageChannel: ImmediateMessageChannel as unknown as typeof MessageChannel
    });

    expect(timer).not.toHaveBeenCalled();
  });

  it("continues through the timer fallback when animation frames are paused", async () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.fn((_callback: FrameRequestCallback) => 1);
    const operation = yieldToUi({
      requestAnimationFrame,
      setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout) as unknown as number,
      clearTimeout: (id) => globalThis.clearTimeout(id)
    });

    await vi.advanceTimersByTimeAsync(24);
    await expect(operation).resolves.toBeUndefined();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("uses the next animation frame without waiting for the fallback timer", async () => {
    vi.useFakeTimers();
    let frame: FrameRequestCallback | undefined;
    const operation = yieldToUi({
      requestAnimationFrame: (callback) => {
        frame = callback;
        return 1;
      },
      setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout) as unknown as number,
      clearTimeout: (id) => globalThis.clearTimeout(id)
    });

    frame?.(0);
    await expect(operation).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("yields while adding many MiniSearch chunks without changing retrieval", async () => {
    const index = new WikiSearchIndex();
    const chunks = Array.from({ length: 24 }, (_, chunkIndex): MarkdownChunk => ({
      id: `${metadata.path}::${chunkIndex}`,
      path: metadata.path,
      title: "响应性",
      heading: `章节 ${chunkIndex}`,
      headingLevel: 2,
      chunkIndex,
      text: chunkIndex === 23 ? "最后一段包含唯一术语 ZXQ-RESPONSIVE" : `普通内容 ${chunkIndex}`
    }));
    let yields = 0;

    await index.replaceChunksAsync(metadata, chunks, async () => {
      yields += 1;
    });

    expect(yields).toBeGreaterThanOrEqual(3);
    expect(index.search("ZXQ-RESPONSIVE")[0]?.document.chunkIndex).toBe(23);
  });

  it("builds a large Wikilink graph in slices and applies it atomically", async () => {
    const graph = new LinkGraph();
    const links = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `wiki/source-${index}.md`,
        { [`wiki/target-${index}.md`]: 1 }
      ])
    );
    let yields = 0;

    const applied = await graph.rebuildAsync(links, () => true, async () => {
      yields += 1;
    });

    expect(applied).toBe(true);
    expect(yields).toBeGreaterThan(0);
    expect(graph.neighbors("wiki/source-79.md")[0]?.path).toBe("wiki/target-79.md");
  });

  it("restores a cached Wikilink graph and synchronizes only changed sources", async () => {
    const original = new LinkGraph();
    original.rebuild({
      "wiki/a.md": { "wiki/b.md": 1 },
      "wiki/unchanged.md": { "wiki/stable.md": 2 }
    });
    const restored = new LinkGraph();
    restored.restoreSnapshot(JSON.parse(JSON.stringify(original.createSnapshot())));

    expect(restored.neighbors("wiki/a.md")[0]?.path).toBe("wiki/b.md");
    expect(restored.neighbors("wiki/unchanged.md")[0]?.linkCount).toBe(2);

    const firstSync = await restored.synchronizeAsync({
      "wiki/a.md": { "wiki/c.md": 1 },
      "wiki/unchanged.md": { "wiki/stable.md": 2 },
      "wiki/new.md": { "wiki/stable.md": 1 }
    });
    const secondSync = await restored.synchronizeAsync({
      "wiki/a.md": { "wiki/c.md": 1 },
      "wiki/unchanged.md": { "wiki/stable.md": 2 },
      "wiki/new.md": { "wiki/stable.md": 1 }
    });

    expect(firstSync).toEqual({ applied: true, changed: true });
    expect(secondSync).toEqual({ applied: true, changed: false });
    expect(restored.neighbors("wiki/a.md").map((neighbor) => neighbor.path))
      .toEqual(["wiki/c.md"]);
    expect(restored.neighbors("wiki/b.md")).toHaveLength(0);
    expect(restored.neighbors("wiki/unchanged.md")[0]?.linkCount).toBe(2);
  });
});
