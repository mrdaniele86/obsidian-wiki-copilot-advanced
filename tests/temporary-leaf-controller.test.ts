import { describe, expect, it, vi } from "vitest";
import { ReusableLeafController } from "../src/ui/temporary-leaf-controller";

function leaf(pinned = false) {
  return {
    detach: vi.fn(),
    getViewState: vi.fn(() => ({ pinned }))
  };
}

describe("reusable citation leaf", () => {
  it("reuses one attached leaf across consecutive citations, including when pinned", () => {
    const controller = new ReusableLeafController<ReturnType<typeof leaf>>();
    const preview = leaf(true);
    const createLeaf = vi.fn(() => preview);
    const isAttached = vi.fn(() => true);

    expect(controller.acquire(createLeaf, isAttached)).toEqual({
      leaf: preview,
      created: true
    });
    expect(controller.acquire(createLeaf, isAttached)).toEqual({
      leaf: preview,
      created: false
    });

    expect(createLeaf).toHaveBeenCalledOnce();
    expect(preview.detach).not.toHaveBeenCalled();
  });

  it("recreates the singleton after the user manually closes it", () => {
    const controller = new ReusableLeafController<ReturnType<typeof leaf>>();
    const first = leaf();
    const second = leaf();
    const leaves = [first, second];
    const attached = new Set([first]);
    const createLeaf = vi.fn(() => leaves.shift()!);

    expect(controller.acquire(createLeaf, (candidate) => attached.has(candidate))).toEqual({
      leaf: first,
      created: true
    });

    attached.delete(first);
    attached.add(second);

    expect(controller.acquire(createLeaf, (candidate) => attached.has(candidate))).toEqual({
      leaf: second,
      created: true
    });
    expect(createLeaf).toHaveBeenCalledTimes(2);
  });

  it("discards a newly created leaf after opening fails", () => {
    const controller = new ReusableLeafController<ReturnType<typeof leaf>>();
    const preview = leaf();

    const { leaf: acquired } = controller.acquire(() => preview, () => true);
    controller.discard(acquired);

    expect(preview.detach).toHaveBeenCalledOnce();
    expect(controller.acquire(() => leaf(), () => true).created).toBe(true);
  });

  it("closes an unpinned singleton when the controller shuts down", () => {
    const controller = new ReusableLeafController<ReturnType<typeof leaf>>();
    const preview = leaf();

    controller.acquire(() => preview, () => true);
    controller.close();

    expect(preview.detach).toHaveBeenCalledOnce();
  });

  it("preserves a pinned singleton when the controller shuts down", () => {
    const controller = new ReusableLeafController<ReturnType<typeof leaf>>();
    const preview = leaf(true);

    controller.acquire(() => preview, () => true);
    controller.close();

    expect(preview.detach).not.toHaveBeenCalled();
  });

  it("retains the most recent citation origin only while its preview is attached", () => {
    const controller = new ReusableLeafController<ReturnType<typeof leaf>>();
    const preview = leaf();
    const chat = leaf();

    controller.acquire(() => preview, () => true, chat);

    expect(controller.originFor(preview, (candidate) => candidate === chat)).toBe(chat);
    expect(controller.originFor(preview, () => false)).toBeNull();
  });
});
