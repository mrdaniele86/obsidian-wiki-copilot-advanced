import type { RetrievalRange } from "../core/types";

const MODEL_TIMEOUT_BY_RANGE: Readonly<Record<RetrievalRange, number>> = {
  low: 90_000,
  medium: 120_000,
  high: 180_000
};

export class RequestTimeoutError extends Error {
  override readonly name = "RequestTimeoutError";

  constructor(
    readonly milliseconds: number,
    message: string
  ) {
    super(message);
  }
}

export class RequestCancelledError extends Error {
  override readonly name = "RequestCancelledError";

  constructor(message = "回答已停止。") {
    super(message);
  }
}

export function modelTimeoutMsForRange(range: RetrievalRange): number {
  return MODEL_TIMEOUT_BY_RANGE[range];
}

export async function withAbortSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw new RequestCancelledError();
  }

  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new RequestCancelledError());
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    if (cancel) {
      signal.removeEventListener("abort", cancel);
    }
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new RequestTimeoutError(milliseconds, message)),
      milliseconds
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}
