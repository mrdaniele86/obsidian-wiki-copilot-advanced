import type { RetrievalResult } from "./types";

export function answerTimeoutMessage(
  serviceName: string,
  milliseconds: number,
  retrievalMode: "precise" | "fast"
): string {
  const seconds = Math.ceil(milliseconds / 1_000);
  const nextStep = retrievalMode === "precise"
    ? "请重试；若仍超时，可在设置中切换为“快速”检索。"
    : "请稍后重试；若仍超时，可更换响应更快的模型。";
  return `本地检索已完成，但 ${serviceName} 在 ${seconds} 秒内未返回回答。${nextStep}`;
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
