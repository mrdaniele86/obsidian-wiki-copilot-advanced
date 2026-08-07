import { describe, expect, it } from "vitest";
import { findExpandedSourceButton } from "../src/ui/source-highlight";

function containerWithSources(open: boolean): {
  container: HTMLElement;
  first: HTMLButtonElement;
  second: HTMLButtonElement;
} {
  const first = { dataset: { sourceId: "S1" } } as unknown as HTMLButtonElement;
  const second = { dataset: { sourceId: "S2" } } as unknown as HTMLButtonElement;
  const details = {
    open,
    querySelectorAll: () => [first, second]
  } as unknown as HTMLDetailsElement;
  const container = {
    querySelector: () => details
  } as unknown as HTMLElement;
  return { container, first, second };
}

describe("citation source highlighting", () => {
  it("finds the matching source only while the source list is expanded", () => {
    const expanded = containerWithSources(true);
    expect(findExpandedSourceButton(expanded.container, "S2")).toBe(expanded.second);

    const collapsed = containerWithSources(false);
    expect(findExpandedSourceButton(collapsed.container, "S2")).toBeNull();
  });

  it("does not fall back to a different source", () => {
    const { container } = containerWithSources(true);
    expect(findExpandedSourceButton(container, "S9")).toBeNull();
  });
});
