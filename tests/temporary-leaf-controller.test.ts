import { describe, expect, it, vi } from "vitest";
import { TemporaryLeafController } from "../src/ui/temporary-leaf-controller";

function leaf(pinned = false) {
  return {
    detach: vi.fn(),
    getViewState: vi.fn(() => ({ pinned }))
  };
}

describe("temporary citation leaf", () => {
  it("stays open while it is active and closes after switching away", () => {
    const controller = new TemporaryLeafController<ReturnType<typeof leaf>>();
    const preview = leaf();
    const other = leaf();

    controller.track(preview);
    controller.handleActiveLeafChange(preview);
    expect(preview.detach).not.toHaveBeenCalled();

    controller.handleActiveLeafChange(other);
    expect(preview.detach).toHaveBeenCalledOnce();
  });

  it("preserves a preview that the user pinned", () => {
    const controller = new TemporaryLeafController<ReturnType<typeof leaf>>();
    const preview = leaf(true);

    controller.track(preview);
    controller.handleActiveLeafChange(leaf());

    expect(preview.detach).not.toHaveBeenCalled();
  });

  it("closes the previous unpinned preview when a new one is tracked", () => {
    const controller = new TemporaryLeafController<ReturnType<typeof leaf>>();
    const first = leaf();
    const second = leaf();

    controller.track(first);
    controller.track(second);

    expect(first.detach).toHaveBeenCalledOnce();
    expect(second.detach).not.toHaveBeenCalled();
  });
});
