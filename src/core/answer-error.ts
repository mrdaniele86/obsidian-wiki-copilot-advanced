import type { RetrievalResult } from "./types";

export interface AnswerTimeoutDetails {
  service: string;
  seconds: number;
  mode: "precise" | "fast";
}

export function answerTimeoutDetails(
  serviceName: string,
  milliseconds: number,
  retrievalMode: "precise" | "fast"
): AnswerTimeoutDetails {
  return {
    service: serviceName,
    seconds: Math.ceil(milliseconds / 1_000),
    mode: retrievalMode
  };
}

export class AnswerTimeoutError extends Error {
  override readonly name = "AnswerTimeoutError";

  constructor(
    message: string,
    readonly retrieval: RetrievalResult
  ) {
    super(message);
  }
}
