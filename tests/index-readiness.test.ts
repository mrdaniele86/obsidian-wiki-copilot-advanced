import { describe, expect, it, vi } from "vitest";
import { waitForReadyStatus } from "../src/core/index-readiness";
import type { ReadinessStatus } from "../src/core/index-readiness";

describe("index readiness", () => {
  it("does not resolve while a superseded build is still building", async () => {
    let listener: ((status: ReadinessStatus) => void) | undefined;
    const unsubscribe = vi.fn();
    let resolved = false;
    const waiting = waitForReadyStatus((next) => {
      listener = next;
      next({ state: "building", message: "正在识别知识库结构…" });
      return unsubscribe;
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    listener?.({ state: "building", message: "旧构建已被替代" });
    await Promise.resolve();
    expect(resolved).toBe(false);

    listener?.({ state: "ready", message: "索引就绪" });
    await waiting;
    expect(resolved).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects when the active replacement build fails", async () => {
    await expect(waitForReadyStatus((listener) => {
      listener({ state: "error", message: "索引失败：测试错误" });
      return vi.fn();
    })).rejects.toThrow("索引失败：测试错误");
  });
});
