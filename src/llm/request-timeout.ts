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

export function modelTimeoutMsForRange(range: RetrievalRange): number {
  return MODEL_TIMEOUT_BY_RANGE[range];
}

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(new RequestTimeoutError(milliseconds, message)),
      milliseconds
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
