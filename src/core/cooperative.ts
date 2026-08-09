export type YieldControl = () => Promise<void>;

interface UiYieldHost {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
  setTimeout(handler: TimerHandler, timeout?: number): number;
  clearTimeout(id: number | undefined): void;
  MessageChannel?: typeof MessageChannel;
}

const YIELD_TIMER_FALLBACK_MS = 24;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * Lets Obsidian process input and paint before continuing CPU-heavy local work.
 * MessageChannel keeps progress moving when animation frames are paused; a timer
 * remains as the compatibility fallback when message channels are unavailable.
 */
export function yieldToUi(host?: UiYieldHost | null): Promise<void> {
  const resolvedHost: UiYieldHost | null = host ?? (
    typeof window === "undefined" ? null : window.activeWindow ?? window
  );
  if (!resolvedHost) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;
    let frameId: number | undefined;
    let channel: MessageChannel | undefined;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolvedHost.clearTimeout(timeoutId);
      if (frameId !== undefined) {
        resolvedHost.cancelAnimationFrame?.(frameId);
      }
      channel?.port1.close();
      channel?.port2.close();
      resolve();
    };

    if (typeof resolvedHost.requestAnimationFrame === "function") {
      frameId = resolvedHost.requestAnimationFrame(finish);
    }
    const MessageChannelConstructor = host === undefined && typeof MessageChannel !== "undefined"
      ? MessageChannel
      : resolvedHost.MessageChannel;
    if (MessageChannelConstructor) {
      const activeChannel = new MessageChannelConstructor();
      channel = activeChannel;
      activeChannel.port1.onmessage = finish;
      activeChannel.port2.postMessage(undefined);
    } else {
      timeoutId = resolvedHost.setTimeout(finish, YIELD_TIMER_FALLBACK_MS);
    }
  });
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
