"use strict";

const SAFE_NAME = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;

function withDeadline(promise, timeoutMs, signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error("运行已取消"), { code: "CANCELLED" }));
  let timer;
  let onAbort;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("工具调用超时"), { code: "TOOL_TIMEOUT" })), timeoutMs);
    onAbort = () => reject(Object.assign(new Error("运行已取消"), { code: "CANCELLED" }));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  });
}

function createToolRegistry() {
  const tools = new Map();

  function register(definition) {
    const name = String(definition?.name || "");
    if (!SAFE_NAME.test(name)) throw new Error(`非法工具名: ${name}`);
    if (tools.has(name)) throw new Error(`工具重复注册: ${name}`);
    if (typeof definition.execute !== "function") throw new Error(`工具缺少 execute: ${name}`);
    tools.set(name, Object.freeze({
      name,
      description: String(definition.description || ""),
      sensitivity: definition.sensitivity || "public",
      action: definition.action || null,
      timeoutMs: Math.max(50, Math.min(30000, Number(definition.timeoutMs) || 3000)),
      validate: typeof definition.validate === "function" ? definition.validate : () => [],
      execute: definition.execute,
    }));
  }

  function describe() {
    return [...tools.values()].map(({ name, description, sensitivity, action, timeoutMs }) => ({ name, description, sensitivity, action, timeoutMs }));
  }

  async function invoke(name, input, context = {}) {
    const tool = tools.get(name);
    if (!tool) throw Object.assign(new Error(`工具未注册: ${name}`), { code: "TOOL_NOT_FOUND" });
    const errors = tool.validate(input || {});
    if (errors.length) throw Object.assign(new Error(`工具参数无效: ${errors.join(", ")}`), { code: "INVALID_TOOL_INPUT", details: errors });
    return withDeadline(Promise.resolve().then(() => tool.execute(input || {}, context)), tool.timeoutMs, context.signal);
  }

  return { register, describe, invoke, get: (name) => tools.get(name) || null };
}

module.exports = { createToolRegistry };
