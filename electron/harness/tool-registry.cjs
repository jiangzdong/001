"use strict";

const SAFE_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

function matchesSchema(value, schema = {}) {
  if (schema.oneOf) return schema.oneOf.some((item) => matchesSchema(value, item));
  if (!schema.type) return true;
  if (schema.type === "array") return Array.isArray(value) && value.every((item) => matchesSchema(item, schema.items || {}));
  if (schema.type === "integer") return Number.isInteger(value);
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "object") return value != null && typeof value === "object" && !Array.isArray(value);
  return typeof value === schema.type;
}

function validateJsonSchema(input, schema = {}) {
  const errors = [];
  for (const key of schema.required || []) if (input?.[key] == null || input[key] === "") errors.push(`缺少 ${key}`);
  for (const [key, value] of Object.entries(input || {})) {
    const field = schema.properties?.[key];
    if (field && !matchesSchema(value, field)) errors.push(`${key} 类型无效`);
  }
  return errors;
}

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
      transport: definition.transport || "local",
      server: definition.server || null,
      tool: definition.tool || name,
      inputSchema: definition.inputSchema || { type: "object", properties: {}, additionalProperties: true },
      validate: (input) => [
        ...validateJsonSchema(input, definition.inputSchema),
        ...(typeof definition.validate === "function" ? definition.validate(input) : []),
      ],
      execute: definition.execute,
    }));
  }

  function describe() {
    return [...tools.values()].map(({ name, description, sensitivity, action, timeoutMs, transport, server, tool, inputSchema }) => ({ name, description, sensitivity, action, timeoutMs, transport, server, tool, inputSchema }));
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
