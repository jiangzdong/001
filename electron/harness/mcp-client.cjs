"use strict";

const MCP_PROTOCOL_VERSION = "2025-06-18";

function parseSse(text) {
  const events = String(text || "").split(/\r?\n\r?\n/);
  for (const event of events) {
    const payload = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()).join("\n");
    if (!payload || payload === "[DONE]") continue;
    try { return JSON.parse(payload); } catch {}
  }
  return null;
}

function decodeToolResult(result) {
  if (result?.isError) {
    const message = result.content?.find?.((item) => item?.type === "text")?.text || "MCP 工具执行失败";
    throw Object.assign(new Error(message), { code: "MCP_TOOL_ERROR" });
  }
  if (result?.structuredContent != null) return result.structuredContent;
  const text = result?.content?.find?.((item) => item?.type === "text")?.text;
  if (text == null) return result ?? {};
  try { return JSON.parse(text); } catch { return { text }; }
}

function createMcpHttpClient({ url, token = "", fetchImpl = globalThis.fetch, timeoutMs = 3000, clientName = "xiaoan-station-advisor", clientVersion = "1.5.21" } = {}) {
  if (!url) throw new Error("MCP URL 不能为空");
  if (typeof fetchImpl !== "function") throw new Error("当前运行时不支持 fetch");
  let sessionId = "";
  let initialized = false;
  let toolsCache = null;
  let requestSequence = 0;

  async function request(method, params = {}, { signal, notification = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("deadline"), timeoutMs);
    const onAbort = () => controller.abort(signal?.reason || "cancelled");
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const body = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: ++requestSequence, method, params };
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error(`MCP 服务响应异常（${response.status}）`), { code: "MCP_HTTP_ERROR", status: response.status });
      sessionId = response.headers?.get?.("mcp-session-id") || sessionId;
      if (notification || response.status === 202) return null;
      const contentType = String(response.headers?.get?.("content-type") || "");
      const raw = await response.text();
      const payload = contentType.includes("text/event-stream") ? parseSse(raw) : JSON.parse(raw || "null");
      if (payload?.error) throw Object.assign(new Error(payload.error.message || "MCP 请求失败"), { code: "MCP_RPC_ERROR", rpcCode: payload.error.code });
      return payload?.result;
    } catch (error) {
      if (controller.signal.aborted) {
        const cancelled = signal?.aborted;
        throw Object.assign(new Error(cancelled ? "MCP 调用已取消" : "MCP 调用超时"), { code: cancelled ? "CANCELLED" : "MCP_TIMEOUT" });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  async function ensureInitialized(signal) {
    if (initialized) return;
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    }, { signal });
    await request("notifications/initialized", {}, { signal, notification: true });
    initialized = true;
  }

  return {
    async listTools(signal) {
      await ensureInitialized(signal);
      if (!toolsCache) toolsCache = (await request("tools/list", {}, { signal }))?.tools || [];
      return toolsCache;
    },
    async callTool(name, args, signal) {
      await ensureInitialized(signal);
      return decodeToolResult(await request("tools/call", { name, arguments: args || {} }, { signal }));
    },
    status: () => ({ configured: true, transport: "streamable-http", initialized, url: new URL(url).origin }),
  };
}

module.exports = { MCP_PROTOCOL_VERSION, createMcpHttpClient, decodeToolResult, parseSse };
