import { describe, expect, it } from "vitest";
import { planMobileRootView } from "../src/ui/view-leaf-placement";

describe("mobile Copilot view placement", () => {
  it("reuses a Copilot leaf that is already in the main tab area", () => {
    const main = { id: "main" };
    const drawer = { id: "drawer" };

    expect(planMobileRootView([main], [drawer, main])).toEqual({
      reusable: main,
      drawerLeaves: [drawer]
    });
  });

  it("marks drawer-only leaves for migration into a new root tab", () => {
    const note = { id: "note" };
    const drawer = { id: "drawer" };

    expect(planMobileRootView([note], [drawer])).toEqual({
      reusable: null,
      drawerLeaves: [drawer]
    });
  });
});
