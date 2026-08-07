export type YieldControl = () => Promise<void>;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * Lets Obsidian process input and paint before continuing CPU-heavy local work.
 * The timer fallback keeps core tests and non-DOM runtimes working.
 */
export function yieldToUi(): Promise<void> {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class CooperativeScheduler {
  private sliceStartedAt = now();
  private processedItems = 0;

  constructor(
    private readonly maxSliceMilliseconds = 8,
    private readonly maxItemsPerSlice = 16,
    private readonly yieldControl: YieldControl = yieldToUi
  ) {}

  async checkpoint(): Promise<boolean> {
    this.processedItems += 1;
    if (
      this.processedItems < this.maxItemsPerSlice &&
      now() - this.sliceStartedAt < this.maxSliceMilliseconds
    ) {
      return false;
    }

    await this.yieldControl();
    this.sliceStartedAt = now();
    this.processedItems = 0;
    return true;
  }
}
