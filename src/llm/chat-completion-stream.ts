export type ChatCompletionStreamEvent =
  | { type: "delta"; text: string }
  | { type: "finish"; reason: string }
  | { type: "done" };

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

type StreamDeltaContent = string | Array<{ type?: string; text?: string }> | null | undefined;

export class ChatCompletionStreamError extends Error {
  override readonly name = "ChatCompletionStreamError";
}

export class ChatCompletionStreamInterruptedError extends Error {
  override readonly name = "ChatCompletionStreamInterruptedError";

  constructor(
    message: string,
    readonly partialText: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

function deltaText(content: StreamDeltaContent): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }
  return "";
}

function parseDataEvent(data: string): ChatCompletionStreamEvent[] {
  const trimmed = data.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed === "[DONE]") {
    return [{ type: "done" }];
  }

  let chunk: ChatCompletionChunk;
  try {
    chunk = JSON.parse(data) as ChatCompletionChunk;
  } catch (error) {
    throw new ChatCompletionStreamError("模型返回了无法解析的流式数据。", { cause: error });
  }
  if (chunk.error) {
    throw new ChatCompletionStreamError(chunk.error.message?.trim() || "模型流式请求失败。");
  }

  const choice = chunk.choices?.[0];
  if (!choice) {
    // Usage-only chunks have an empty choices array and do not contain answer text.
    return [];
  }

  const events: ChatCompletionStreamEvent[] = [];
  const text = deltaText(choice.delta?.content);
  if (text) {
    events.push({ type: "delta", text });
  }
  if (choice.finish_reason) {
    events.push({ type: "finish", reason: choice.finish_reason });
  }
  return events;
}

/** Incrementally parses data-only Server-Sent Events used by Chat Completions. */
export class ChatCompletionSseParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private dataLines: string[] = [];

  push(chunk: Uint8Array): ChatCompletionStreamEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drainLines(false);
  }

  finish(): ChatCompletionStreamEvent[] {
    this.buffer += this.decoder.decode();
    return this.drainLines(true);
  }

  private drainLines(final: boolean): ChatCompletionStreamEvent[] {
    const events: ChatCompletionStreamEvent[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const rawLine = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      events.push(...this.consumeLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine));
      newline = this.buffer.indexOf("\n");
    }

    if (final) {
      if (this.buffer) {
        const rawLine = this.buffer;
        this.buffer = "";
        events.push(...this.consumeLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine));
      }
      events.push(...this.dispatchEvent());
    }
    return events;
  }

  private consumeLine(line: string): ChatCompletionStreamEvent[] {
    if (!line) {
      return this.dispatchEvent();
    }
    if (line.startsWith(":")) {
      return [];
    }
    if (line === "data" || line.startsWith("data:")) {
      let value = line === "data" ? "" : line.slice(5);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      this.dataLines.push(value);
    }
    return [];
  }

  private dispatchEvent(): ChatCompletionStreamEvent[] {
    if (this.dataLines.length === 0) {
      return [];
    }
    const data = this.dataLines.join("\n");
    this.dataLines = [];
    return parseDataEvent(data);
  }
}

export interface ReadChatCompletionStreamOptions {
  onActivity?: () => void;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatCompletionStreamResult {
  text: string;
  finishReason: string | null;
}

export async function readChatCompletionStream(
  stream: ReadableStream<Uint8Array>,
  options: ReadChatCompletionStreamOptions = {}
): Promise<ChatCompletionStreamResult> {
  const reader = stream.getReader();
  const parser = new ChatCompletionSseParser();
  const parts: string[] = [];
  let finishReason: string | null = null;
  let done = false;
  let cancel: (() => void) | undefined;
  const cancelled = options.signal
    ? new Promise<never>((_resolve, reject) => {
      cancel = () => {
        void reader.cancel();
        reject(new ChatCompletionStreamInterruptedError(
          "模型流式请求已取消。",
          parts.join("")
        ));
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
    })
    : null;

  const consume = (events: ChatCompletionStreamEvent[]): void => {
    for (const event of events) {
      if (event.type === "delta") {
        parts.push(event.text);
        options.onDelta?.(event.text);
      } else if (event.type === "finish") {
        finishReason = event.reason;
      } else {
        done = true;
      }
    }
  };

  try {
    if (options.signal?.aborted) {
      cancel?.();
    }
    while (!done) {
      const result = cancelled
        ? await Promise.race([reader.read(), cancelled])
        : await reader.read();
      if (result.done) {
        consume(parser.finish());
        break;
      }
      options.onActivity?.();
      consume(parser.push(result.value));
    }
  } catch (error) {
    if (error instanceof ChatCompletionStreamInterruptedError) {
      throw error;
    }
    throw new ChatCompletionStreamInterruptedError(
      error instanceof Error ? error.message : "模型流式连接已中断。",
      parts.join(""),
      { cause: error }
    );
  } finally {
    options.signal?.removeEventListener("abort", cancel ?? (() => undefined));
    if (done || options.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        // A provider may close the stream immediately after [DONE].
      }
    }
    reader.releaseLock();
  }

  const text = parts.join("");
  if (!done && !finishReason) {
    throw new ChatCompletionStreamInterruptedError("模型流式连接在回答完成前中断。", text);
  }
  if (!text.trim()) {
    throw new ChatCompletionStreamError("模型返回了空回答。");
  }
  return { text: text.trim(), finishReason };
}
