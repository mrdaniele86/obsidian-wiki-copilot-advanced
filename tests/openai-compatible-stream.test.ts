import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn()
}));

import type { BuiltContext } from "../src/core/context-builder";
import {
  type ModelResponseDetail,
  ModelStreamInterruptedError,
  OpenAICompatibleClient,
  StreamFallbackRequiredError
} from "../src/llm/openai-compatible";
import { RequestCancelledError, RequestTimeoutError } from "../src/llm/request-timeout";
import type { ModelSettings } from "../src/settings";

const encoder = new TextEncoder();
const context: BuiltContext = { context: "Evidence", sources: [] };

function settings(): ModelSettings {
  return {
    provider: "custom",
    serviceName: "Test service",
    endpoint: "https://example.com/v1",
    model: "test-model"
  };
}

function timerHost() {
  return {
    setTimeout: (handler: TimerHandler, timeout?: number) =>
      globalThis.setTimeout(handler, timeout) as unknown as number,
    clearTimeout: (id: number | undefined) => globalThis.clearTimeout(id)
  };
}

function responseStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

function nonStreamingResponse(text = "兼容回答") {
  return {
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json: { choices: [{ message: { content: text } }] },
    text: JSON.stringify({ choices: [{ message: { content: text } }] })
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAICompatibleClient streaming", () => {
  it("plans bounded lexical query variants without sending an answer request", async () => {
    const requester = vi.fn(async (_request: unknown) => nonStreamingResponse(
      '{"queries":["PCBA test requirements","PCBA printed circuit board assembly acceptance criteria"]}'
    ));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher: vi.fn(),
      requester,
      timerHost: timerHost()
    });

    await expect(client.planRetrievalQueries(
      "pcba测试要求",
      settings(),
      15_000
    )).resolves.toEqual([
      "pcba测试要求",
      "PCBA test requirements",
      "PCBA printed circuit board assembly acceptance criteria"
    ]);

    const sentRequest = requester.mock.calls[0]?.[0] as { body?: string } | undefined;
    const requestBody = JSON.parse(String(sentRequest?.body)) as {
      stream?: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.stream).toBe(false);
    expect(requestBody.messages[0]?.content).toContain("Do not answer the question");
    expect(requestBody.messages[1]?.content).toBe("pcba测试要求");
  });

  it("uses the lightweight planner limits for fast retrieval", async () => {
    const requester = vi.fn(async (_request: unknown) => nonStreamingResponse(JSON.stringify({
      queries: [
        "brake test requirements",
        "制动 验收 标准",
        "braking validation criteria",
        "brake inspection specification",
        "制动测试条件",
        "制动性能验证",
        "制动系统测试规范"
      ]
    })));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher: vi.fn(),
      requester,
      timerHost: timerHost()
    });

    await expect(client.planRetrievalQueries(
      "制动测试要求",
      settings(),
      15_000,
      { mode: "fast" }
    )).resolves.toEqual([
      "制动测试要求",
      "brake test requirements",
      "制动 验收 标准",
      "braking validation criteria",
      "brake inspection specification",
      "制动测试条件",
      "制动性能验证"
    ]);

    const sentRequest = requester.mock.calls[0]?.[0] as { body?: string } | undefined;
    const requestBody = JSON.parse(String(sentRequest?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages[0]?.content).toContain("Produce 3 to 6 short keyword queries");
  });

  it("uses recent conversation context when planning a follow-up search", async () => {
    const requester = vi.fn(async (_request: unknown) => nonStreamingResponse(
      '{"queries":["ZX9 power consumption","ZX9 功耗 测试条件"]}'
    ));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher: vi.fn(),
      requester,
      timerHost: timerHost()
    });

    await expect(client.planRetrievalQueries(
      "功耗呢",
      settings(),
      15_000,
      {
        mode: "precise",
        history: [
          { role: "user", content: "先看 ZX9 的端口定义" },
          { role: "assistant", content: "ZX9 有 12 个端口 [S3]" }
        ]
      }
    )).resolves.toEqual([
      "功耗呢",
      "ZX9 power consumption",
      "ZX9 功耗 测试条件"
    ]);

    const sentRequest = requester.mock.calls[0]?.[0] as { body?: string } | undefined;
    const requestBody = JSON.parse(String(sentRequest?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user"
    ]);
    expect(requestBody.messages[0]?.content).toContain("active scope");
    expect(requestBody.messages[1]?.content).toBe("先看 ZX9 的端口定义");
    expect(requestBody.messages[2]?.content).toBe("ZX9 有 12 个端口 [prior source]");
    expect(requestBody.messages[3]?.content).toBe("功耗呢");
  });

  it("streams Chat Completions deltas and sends stream=true", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      responseStream([
        "data: {\"choices\":[{\"delta\":{\"content\":\"流式\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"回答\"},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n"
      ]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    ));
    const requester = vi.fn(async (_request: unknown) => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, { fetcher, requester, timerHost: timerHost() });
    const deltas: string[] = [];
    const activity: string[] = [];

    await expect(client.answer("问题", context, [], "", settings(), 90_000, {
      onDelta: (delta) => deltas.push(delta),
      onActivity: (event) => activity.push(event)
    })).resolves.toBe("流式回答");

    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { stream?: boolean };
    expect(requestBody.stream).toBe(true);
    expect(deltas).toEqual(["流式", "回答"]);
    expect(activity).toEqual(["response-headers", "stream-data"]);
    expect(requester).not.toHaveBeenCalled();
  });

  it("keeps conversation context while the current technical family remains authoritative", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      responseStream([
        "data: {\"choices\":[{\"delta\":{\"content\":\"回答\"},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n"
      ]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    ));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher,
      requester: vi.fn(async () => nonStreamingResponse()),
      timerHost: timerHost()
    });

    await client.answer(
      "所有 ZX9 功耗",
      context,
      [
        { role: "user", content: "AB2 功耗" },
        { role: "assistant", content: "AB2 是 8.5W [S1]" }
      ],
      "",
      settings(),
      90_000
    );

    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages).toHaveLength(4);
    expect(requestBody.messages[1]?.content).toBe("AB2 功耗");
    expect(requestBody.messages[2]?.content).toContain("AB2 是 8.5W [prior source]");
    const systemPrompt = requestBody.messages[0]?.content ?? "";
    const currentPrompt = requestBody.messages[3]?.content ?? "";
    expect(systemPrompt).toContain("same reasoning rules to every domain");
    expect(systemPrompt).toContain("Preserve entity fidelity");
    expect(systemPrompt).toContain("explicit scope or named entities in the current question");
    expect(currentPrompt).not.toContain("Technical identifier family anchors");
    expect(currentPrompt).toContain("Question:\n所有 ZX9 功耗");
    expect(currentPrompt).toContain("Evidence for this turn:");
    expect(currentPrompt).not.toMatch(/MS6/iu);
  });

  it("keeps the ten most recent conversation turns within a bounded prompt", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      responseStream([
        "data: {\"choices\":[{\"delta\":{\"content\":\"回答\"},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n"
      ]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    ));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher,
      requester: vi.fn(async () => nonStreamingResponse()),
      timerHost: timerHost()
    });
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `turn-${index}`
    }));

    await client.answer("继续", context, history, "", settings(), 90_000);

    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages).toHaveLength(12);
    expect(requestBody.messages[1]?.content).toBe("turn-2");
    expect(requestBody.messages[10]?.content).toBe("turn-11");
    expect(requestBody.messages[11]?.content).toContain("Question:\n继续");
  });

  it("instructs the model not to merge or abbreviate a fully specified variant", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      responseStream([
        "data: {\"choices\":[{\"delta\":{\"content\":\"回答\"},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n"
      ]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    ));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher,
      requester: vi.fn(async () => nonStreamingResponse()),
      timerHost: timerHost()
    });

    await client.answer(
      "ZX9-3.7V-WTI-C 端口定义",
      context,
      [],
      "",
      settings(),
      90_000
    );

    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = requestBody.messages[0]?.content ?? "";
    const userPrompt = requestBody.messages[1]?.content ?? "";
    expect(userPrompt).toContain("ZX9-3.7V-WTI-C 端口定义");
    expect(userPrompt).not.toMatch(/MS6/iu);
    expect(userPrompt).not.toContain("Technical identifier family anchors");
    expect(systemPrompt).toContain("question specifies an exact entity or scope");
    expect(systemPrompt).toContain("never transfer facts, attributes, conditions, or conclusions");
    expect(systemPrompt).toContain("without silently shortening");
  });

  it("uses requestUrl directly in non-streaming compatibility mode", async () => {
    const fetcher = vi.fn();
    const requester = vi.fn(async (_request: unknown) => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, { fetcher, requester, timerHost: timerHost() });
    const activity: string[] = [];

    await expect(client.answer("问题", context, [], "", settings(), 90_000, {
      responseMode: "non-stream",
      onActivity: (event) => activity.push(event)
    }))
      .resolves.toBe("兼容回答");
    const sentRequest = requester.mock.calls[0]?.[0] as { body?: string } | undefined;
    const requestBody = JSON.parse(String(sentRequest?.body)) as { stream?: boolean };
    expect(requestBody.stream).toBe(false);
    expect(activity).toEqual(["response-headers"]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back before sending when the runtime has no streaming primitives", async () => {
    const requester = vi.fn(async (_request: unknown) => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, {
      fetcher: null,
      requester,
      timerHost: timerHost()
    });

    await expect(client.answer("问题", context, [], "", settings(), 90_000))
      .resolves.toBe("兼容回答");
    expect(requester).toHaveBeenCalledOnce();
  });

  it("automatically falls back after an explicit stream-unsupported rejection", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "stream is not supported" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    ));
    const requester = vi.fn(async () => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, { fetcher, requester, timerHost: timerHost() });
    const modes: Array<{ mode: string; detail?: ModelResponseDetail }> = [];

    await expect(client.answer("问题", context, [], "", settings(), 90_000, {
      onResponseMode: (mode, detail) => modes.push({ mode, detail })
    })).resolves.toBe("兼容回答");
    expect(modes).toEqual([
      { mode: "stream" },
      { mode: "non-stream", detail: "streaming-unsupported" }
    ]);
    expect(requester).toHaveBeenCalledOnce();
  });

  it("reports request failures with a semantic code and provider detail", async () => {
    const requester = vi.fn(async () => ({
      ...nonStreamingResponse(),
      status: 429,
      json: { error: { message: "rate limit exceeded" } },
      text: JSON.stringify({ error: { message: "rate limit exceeded" } })
    }));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher: null,
      requester,
      timerHost: timerHost()
    });

    await expect(client.answer("question", context, [], "", settings(), 90_000))
      .rejects.toMatchObject({
        code: "request-failed",
        detail: "rate limit exceeded"
      });
  });

  it("reports stream completion warnings as semantic codes", async () => {
    const fetcher = vi.fn(async () => new Response(responseStream([
      "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}]}\n\n",
      "data: [DONE]\n\n"
    ]), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const warnings: string[] = [];
    const client = new OpenAICompatibleClient(() => null, { fetcher, timerHost: timerHost() });

    await expect(client.answer("question", context, [], "", settings(), 90_000, {
      onWarning: (warning) => warnings.push(warning)
    })).resolves.toBe("partial");
    expect(warnings).toEqual(["length"]);
  });

  it("does not silently resend an ambiguous failed fetch", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const requester = vi.fn(async () => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, { fetcher, requester, timerHost: timerHost() });

    await expect(client.answer("问题", context, [], "", settings(), 90_000))
      .rejects.toBeInstanceOf(StreamFallbackRequiredError);
    expect(requester).not.toHaveBeenCalled();
  });

  it("consumes a successful JSON response without issuing a second request", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "完整响应" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    const requester = vi.fn(async () => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, { fetcher, requester, timerHost: timerHost() });
    const deltas: string[] = [];

    await expect(client.answer("问题", context, [], "", settings(), 90_000, {
      onDelta: (delta) => deltas.push(delta)
    })).resolves.toBe("完整响应");
    expect(deltas).toEqual(["完整响应"]);
    expect(requester).not.toHaveBeenCalled();
  });

  it("aborts the underlying streaming fetch when the user cancels", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher,
      requester: vi.fn(async () => nonStreamingResponse()),
      timerHost: timerHost()
    });
    const answer = client.answer("问题", context, [], "", settings(), 90_000, { signal: controller.signal });

    controller.abort();
    await expect(answer).rejects.toBeInstanceOf(RequestCancelledError);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("stops waiting for an unabortable compatibility request when cancelled", async () => {
    const controller = new AbortController();
    const requester = vi.fn((_request: unknown) => new Promise<ReturnType<typeof nonStreamingResponse>>(() => undefined));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher: null,
      requester,
      timerHost: timerHost()
    });
    const answer = client.answer(
      "问题",
      context,
      [],
      "",
      settings(),
      90_000,
      { signal: controller.signal, responseMode: "non-stream" }
    );

    controller.abort();
    await expect(answer).rejects.toBeInstanceOf(RequestCancelledError);
  });

  it("aborts a streaming request at the configured deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = new OpenAICompatibleClient(() => null, {
      fetcher,
      requester: vi.fn(async () => nonStreamingResponse()),
      timerHost: timerHost()
    });
    const answer = client.answer("问题", context, [], "", settings(), 90_000);
    const assertion = expect(answer).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("preserves partial text and never falls back after output has started", async () => {
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1;
          controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"部分\"}}]}\n\n"));
          return;
        }
        controller.error(new Error("connection lost"));
      }
    });
    const fetcher = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));
    const requester = vi.fn(async () => nonStreamingResponse());
    const client = new OpenAICompatibleClient(() => null, { fetcher, requester, timerHost: timerHost() });

    const answer = client.answer("问题", context, [], "", settings(), 90_000);
    await expect(answer).rejects.toBeInstanceOf(ModelStreamInterruptedError);
    await expect(answer)
      .rejects.toMatchObject({
        name: "ChatCompletionStreamInterruptedError",
        reason: "stream-interrupted",
        partialText: "部分"
      } satisfies Partial<ModelStreamInterruptedError>);
    expect(requester).not.toHaveBeenCalled();
  });
});
