const { createReplyDeltaTracker, normalizeDeepSeekChatResult, parseSseBuffer } = require("./deepseek-stream.cjs");

async function streamDeepSeekChat({
  fetchImpl = globalThis.fetch,
  url = "https://api.deepseek.com/chat/completions",
  key,
  body,
  domain,
  requestId,
  controller = new AbortController(),
  timeoutMs = 30000,
  onEvent = () => {},
  now = () => performance.now(),
}) {
  const startedAt = now();
  let firstTokenAt = 0;
  let firstReplyAt = 0;
  let raw = "";
  let sseBuffer = "";
  const tracker = createReplyDeltaTracker();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, message: response.status === 401 ? "DeepSeek 密钥无效或已失效" : `AI 服务暂时不可用（${response.status}）` };
    if (!response.body) return { ok: false, message: "AI 流式响应不可用" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const consumeEvents = (events) => {
      for (const data of events) {
        if (data === "[DONE]") continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        const content = String(event?.choices?.[0]?.delta?.content || "");
        if (!content) continue;
        if (!firstTokenAt) firstTokenAt = now();
        raw += content;
        const reply = tracker.update(raw);
        if (reply.delta) {
          if (!firstReplyAt) firstReplyAt = now();
          onEvent({ type: "delta", delta: reply.delta, text: reply.value });
        }
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      sseBuffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const parsed = parseSseBuffer(sseBuffer, { flush: done });
      sseBuffer = parsed.remainder;
      consumeEvents(parsed.events);
      if (done) break;
    }
    const result = normalizeDeepSeekChatResult(JSON.parse(raw), domain);
    const timings = {
      firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : null,
      firstReplyMs: firstReplyAt ? Math.round(firstReplyAt - startedAt) : null,
      totalMs: Math.round(now() - startedAt),
    };
    onEvent({ type: "complete", text: result.ok ? result.text : tracker.value(), timings });
    return { ...result, requestId, timings };
  } catch (error) {
    const cancelled = controller.signal.aborted && controller.signal.reason !== "timeout";
    return {
      ok: false,
      cancelled,
      message: cancelled ? "智能回答已取消" : controller.signal.aborted || error?.name === "AbortError"
        ? "智能对话响应超时，已切换为本地健康助手"
        : "网络暂时不可用，已切换为本地健康助手",
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { streamDeepSeekChat };
