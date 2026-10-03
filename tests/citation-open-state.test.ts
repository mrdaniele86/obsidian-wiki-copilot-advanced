import { describe, expect, it } from "vitest";
import { citationOpenState } from "../src/ui/citation-open-state";

describe("citation document open state", () => {
  it("forces reading mode and preserves heading navigation", () => {
    expect(citationOpenState("#端子定义")).toEqual({
      active: true,
      state: { mode: "preview" },
      eState: { subpath: "#端子定义" }
    });
  });

  it("omits empty heading navigation state", () => {
    expect(citationOpenState()).toEqual({
      active: true,
      state: { mode: "preview" },
      eState: undefined
    });
  });

  it("keeps citation opening state independent from the return-to-chat action", () => {
    expect(citationOpenState("#Section")).toEqual({
      active: true,
      state: { mode: "preview" },
      eState: { subpath: "#Section" }
    });
  });
});
