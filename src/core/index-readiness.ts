export interface ReadinessStatus {
  state: "idle" | "building" | "ready" | "error";
  message: string;
}

export type ReadinessSubscriber = (
  listener: (status: ReadinessStatus) => void
) => () => void;

/** Waits for an actual ready/error status instead of a possibly superseded build promise. */
export function waitForReadyStatus(subscribe: ReadinessSubscriber): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let cleanupPending = false;

    const cleanup = (): void => {
      if (unsubscribe) {
        unsubscribe();
      } else {
        cleanupPending = true;
      }
    };
    const listener = (status: ReadinessStatus): void => {
      if (status.state === "ready") {
        cleanup();
        resolve();
      } else if (status.state === "error") {
        cleanup();
        reject(new Error(status.message));
      }
    };

    unsubscribe = subscribe(listener);
    if (cleanupPending) {
      unsubscribe();
    }
  });
}
