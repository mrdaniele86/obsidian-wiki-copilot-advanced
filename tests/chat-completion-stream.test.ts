import { describe, expect, it } from "vitest";
import {
  ChatCompletionSseParser,
  ChatCompletionStreamInterruptedError,
  readChatCompletionStream
} from "../src/llm/chat-completion-stream";

const encoder = new TextEncoder();

function streamFrom(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    }
  });
}

describe("ChatCompletionSseParser", () => {
  it("parses events split across arbitrary network chunks", () => {
    const parser = new ChatCompletionSseParser();
    expect(parser.push(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"你"))).toEqual([]);
    expect(parser.push(encoder.encode("好\"},\"finish_reason\":null}]}\n\n"))).toEqual([
      { type: "delta", text: "你好" }
    ]);
  });

  it("handles CRLF, keep-alive comments, usage chunks, finish reasons, and DONE", () => {
    const parser = new ChatCompletionSseParser();
    const events = parser.push(encoder.encode(`${[
      ": keep-alive",
      "",
      "data: {\"choices\":[]}",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":\"完成\"},\"finish_reason\":\"stop\"}]}",
      "",
      "data: [DONE]",
      ""
    ].join("\r\n")}\r\n`));

    expect(events).toEqual([
      { type: "delta", text: "完成" },
      { type: "finish", reason: "stop" },
      { type: "done" }
    ]);
  });

  it("preserves UTF-8 characters split between byte chunks", () => {
    const payload = encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"知识\"}}]}\n\n");
    const split = payload.indexOf(0xe7) + 1;
    const parser = new ChatCompletionSseParser();
    expect(parser.push(payload.slice(0, split))).toEqual([]);
    expect(parser.push(payload.slice(split))).toEqual([{ type: "delta", text: "知识" }]);
  });

  it("ignores reasoning content and parses array text content", () => {
    const parser = new ChatCompletionSseParser();
    const events = parser.push(encoder.encode(`${[
      "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden\"}}]}",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"A\"},{\"text\":\"B\"}]}}]}",
      ""
    ].join("\n")}\n`));
    expect(events).toEqual([{ type: "delta", text: "AB" }]);
  });

  it("reports malformed JSON as a protocol error", () => {
    const parser = new ChatCompletionSseParser();
    expect(() => parser.push(encoder.encode("data: not-json\n\n")))
      .toThrow("模型返回了无法解析的流式数据");
  });
});

describe("readChatCompletionStream", () => {
  it("emits deltas and returns the complete answer", async () => {
    const deltas: string[] = [];
    const stream = streamFrom([
      "data: {\"choices\":[{\"delta\":{\"content\":\"第一段\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"第二段\"},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n"
    ]);

    await expect(readChatCompletionStream(stream, { onDelta: (delta) => deltas.push(delta) }))
      .resolves.toEqual({ text: "第一段第二段", finishReason: "stop" });
    expect(deltas).toEqual(["第一段", "第二段"]);
  });

  it("accepts a compatible stream that ends after finish_reason without DONE", async () => {
    const stream = streamFrom([
      "data: {\"choices\":[{\"delta\":{\"content\":\"完成\"},\"finish_reason\":\"stop\"}]}\n\n"
    ]);
    await expect(readChatCompletionStream(stream)).resolves.toEqual({
      text: "完成",
      finishReason: "stop"
    });
  });

  it("keeps partial text when the stream ends unexpectedly", async () => {
    const stream = streamFrom([
      "data: {\"choices\":[{\"delta\":{\"content\":\"部分回答\"}}]}\n\n"
    ]);
    await expect(readChatCompletionStream(stream)).rejects.toMatchObject({
      name: "ChatCompletionStreamInterruptedError",
      partialText: "部分回答"
    } satisfies Partial<ChatCompletionStreamInterruptedError>);
  });

  it("cancels the active reader and preserves partial text when aborted", async () => {
    const controller = new AbortController();
    let readerCancelled = false;
    let firstDeltaSeen!: () => void;
    const firstDelta = new Promise<void>((resolve) => {
      firstDeltaSeen = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(
          "data: {\"choices\":[{\"delta\":{\"content\":\"部分回答\"}}]}\n\n"
        ));
      },
      cancel() {
        readerCancelled = true;
      }
    });
    const reading = readChatCompletionStream(stream, {
      signal: controller.signal,
      onDelta: firstDeltaSeen
    });

    await firstDelta;
    controller.abort();

    await expect(reading).rejects.toMatchObject({
      name: "ChatCompletionStreamInterruptedError",
      partialText: "部分回答"
    } satisfies Partial<ChatCompletionStreamInterruptedError>);
    expect(readerCancelled).toBe(true);
  });
});
