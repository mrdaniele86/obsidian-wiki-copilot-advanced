import type { RetrievalRange, RetrievalResult } from "./types";

const LOWER_RANGE_LABEL: Partial<Record<RetrievalRange, string>> = {
  medium: "低",
  high: "中"
};

export function answerTimeoutMessage(
  serviceName: string,
  milliseconds: number,
  range: RetrievalRange
): string {
  const seconds = Math.ceil(milliseconds / 1_000);
  const lowerRange = LOWER_RANGE_LABEL[range];
  const nextStep = lowerRange
    ? `请重试；若仍超时，可将“范围与深度”调为“${lowerRange}”。`
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
