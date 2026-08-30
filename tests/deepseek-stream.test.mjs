import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createReplyDeltaTracker, extractJsonStringPrefix, normalizeDeepSeekChatResult, parseSseBuffer } = require("../electron/deepseek-stream.cjs");
const { streamDeepSeekChat } = require("../electron/deepseek-client.cjs");

test("SSE parser retains incomplete frames", () => {
  const first = parseSseBuffer('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(first.events, ['{"a":1}']);
  assert.equal(first.remainder, 'data: {"b"');
  const second = parseSseBuffer(`${first.remainder}:2}\n\n`);
  assert.deepEqual(second.events, ['{"b":2}']);
});

test("reply tracker decodes JSON escapes and only emits new text", () => {
  const tracker = createReplyDeltaTracker();
  assert.equal(tracker.update('{"intent":"health_answer","reply":"您好').delta, "您好");
  assert.equal(tracker.update('{"intent":"health_answer","reply":"您好\\n请坐').delta, "\n请坐");
  assert.equal(extractJsonStringPrefix('{"reply":"注意\\u8840\\u538b"}', "reply").value, "注意血压");
});

test("streamed result keeps health response options constrained", () => {
  const result = normalizeDeepSeekChatResult({ reply: "请告诉我最近的血压。", options: [{ id: "safe-1", label: "已经测量" }, { id: "!", label: "还没有" }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.options.map((item) => item.id), ["safe-1", "option-2"]);
});

test("injectable DeepSeek client emits decoded reply deltas before completion", async () => {
  const encoder = new TextEncoder();
  const frames = [
    'data: {"choices":[{"delta":{"content":"{\\\"intent\\\":\\\"health_answer\\\",\\\"reply\\\":\\\"您好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"\\\\n请坐\\\",\\\"options\\\":[]}"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const events = [];
  const fetchImpl = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(new ReadableStream({
      start(controller) { for (const frame of frames) controller.enqueue(encoder.encode(frame)); controller.close(); },
    }), { status: 200 });
  };
  let tick = 0;
  const result = await streamDeepSeekChat({
    fetchImpl,
    key: "test-key",
    body: { model: "test", messages: [] },
    requestId: "request-1",
    onEvent: (event) => events.push(event),
    now: () => { tick += 5; return tick; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "您好\n请坐");
  assert.deepEqual(events.filter((event) => event.type === "delta").map((event) => event.delta), ["您好", "\n请坐"]);
  assert.equal(events.at(-1).type, "complete");
  assert.equal(result.requestId, "request-1");
});

test("injectable DeepSeek client distinguishes cancellation from timeout", async () => {
  const blockingFetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  const cancelledController = new AbortController();
  const cancelledTask = streamDeepSeekChat({ fetchImpl: blockingFetch, key: "test", body: {}, controller: cancelledController, timeoutMs: 1000 });
  cancelledController.abort("cancelled");
  const cancelled = await cancelledTask;
  assert.equal(cancelled.cancelled, true);

  const timedOut = await streamDeepSeekChat({ fetchImpl: blockingFetch, key: "test", body: {}, timeoutMs: 5 });
  assert.equal(timedOut.cancelled, false);
  assert.match(timedOut.message, /超时/);
});
