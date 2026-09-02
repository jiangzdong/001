"use strict";

const crypto = require("crypto");
const { evaluatePolicy } = require("./policy-engine.cjs");

function sanitizeId(value, prefix) {
  const clean = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  return clean || `${prefix}_${crypto.randomUUID()}`;
}

function defaultPlan(text) {
  if (/助餐/.test(text) && /(几点|时间|开始|开放)/.test(text)) return { intent: "station.service.schedule", tool: "station.get_service_schedule", arguments: { serviceId: "meal_service" } };
  if (/健康讲堂/.test(text)) return { intent: "station.activity.detail", tool: "station.get_activity", arguments: { activityId: "health_lecture" } };
  if (/八段锦/.test(text)) return { intent: "station.activity.detail", tool: "station.get_activity", arguments: { activityId: "baduanjin" } };
  if (/(积分)/.test(text)) return { intent: "member.points.self", tool: "member.get_points", arguments: { owner: /他人|别人|老伴|家人/.test(text) ? "other" : "self" } };
  if (/(余额)/.test(text)) return { intent: "member.balance.self", tool: "member.get_balance", arguments: { owner: /他人|别人|老伴|家人/.test(text) ? "other" : "self" } };
  return { intent: "unknown", tool: null, arguments: {} };
}

function publicAnswer(plan, data) {
  if (plan.tool === "station.get_service_schedule") return `${data.name}时间是${data.speechSchedule || data.schedule}，地点在${data.location}。`;
  if (plan.tool === "station.get_activity") return `${data.title}：${data.summary}。地点在${data.location}。`;
  if (plan.tool === "member.get_points") return `您当前有${data.points}积分。`;
  if (plan.tool === "member.get_balance") return `您当前余额为${data.balance}元。`;
  return "这个问题我暂时无法通过已注册工具核实。";
}

function createAgentRuntime({ registry, planner = defaultPlan, memoryStore = null, now = () => Date.now() }) {
  const active = new Map();

  async function run(input = {}) {
    const runId = sanitizeId(input.runId || input.requestId, "run");
    const sessionId = sanitizeId(input.sessionId, "session");
    const turnId = sanitizeId(input.turnId, "turn");
    const text = String(input.text || input.input?.text || "").trim().slice(0, 500);
    const startedAt = now();
    const trace = [{ type: "run.started", at: startedAt }];
    if (!text) return { ok: false, runId, sessionId, turnId, status: "fatal_error", error: { code: "EMPTY_INPUT", message: "请输入问题" }, trace };
    active.get(runId)?.abort("superseded");
    const controller = new AbortController();
    active.set(runId, controller);
    let plan = { intent: "unknown", tool: null };
    let sensitive = false;
    const finish = (result) => {
      memoryStore?.recordTurn(sessionId, {
        turnId,
        intent: result.intent || plan.intent,
        status: result.status,
        sensitive,
        userText: text,
        assistantText: result.answer?.speechText,
      });
      return result;
    };
    try {
      plan = await planner(text, { registry: registry.describe(), signal: controller.signal, memory: memoryStore?.snapshot(sessionId) || { sessionId, turns: [] } });
      trace.push({ type: "plan.completed", at: now(), intent: plan.intent, tool: plan.tool });
      if (!plan.tool) return finish({ ok: true, runId, sessionId, turnId, status: "completed", intent: plan.intent, answer: { speechText: publicAnswer(plan) }, toolTrace: [], trace });
      const tool = registry.get(plan.tool);
      sensitive = Boolean(tool && tool.sensitivity !== "public");
      const policy = evaluatePolicy({ tool, actor: input.actor, input: plan.arguments });
      trace.push({ type: "policy.evaluated", at: now(), decision: policy.decision, reasonCode: policy.reasonCode });
      if (policy.decision !== "ALLOW") {
        return finish({ ok: true, runId, sessionId, turnId, status: policy.decision === "AUTH_REQUIRED" ? "auth_required" : "denied", intent: plan.intent, policy, answer: null, toolTrace: [], trace });
      }
      const toolStarted = now();
      const data = await registry.invoke(plan.tool, plan.arguments, { runId, sessionId, turnId, signal: controller.signal, actor: input.actor || {} });
      const toolTrace = [{ tool: plan.tool, status: "ok", durationMs: Math.max(0, now() - toolStarted) }];
      trace.push({ type: "tool.completed", at: now(), tool: plan.tool, status: "ok" });
      return finish({ ok: true, runId, sessionId, turnId, status: "completed", intent: plan.intent, policy, answer: { speechText: publicAnswer(plan, data), facts: data.factIds || [] }, data, toolTrace, trace });
    } catch (error) {
      const code = error?.code || "HARNESS_ERROR";
      trace.push({ type: "run.failed", at: now(), code });
      return finish({ ok: false, runId, sessionId, turnId, status: code === "CANCELLED" ? "cancelled" : "recoverable_error", intent: plan.intent, error: { code, message: String(error?.message || "执行失败").slice(0, 160) }, toolTrace: [], trace });
    } finally {
      if (active.get(runId) === controller) active.delete(runId);
    }
  }

  function cancel(runId) {
    const key = sanitizeId(runId, "run");
    const controller = active.get(key);
    if (!controller) return false;
    controller.abort("cancelled");
    active.delete(key);
    return true;
  }

  function memory(sessionId) {
    const key = String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
    return key ? memoryStore?.snapshot(key) || { sessionId: key, turns: [], expiresAt: null } : { sessionId: null, turns: [], expiresAt: null };
  }

  function clearSession(sessionId) {
    const key = String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
    return Boolean(key && memoryStore?.clear(key));
  }

  return {
    run,
    cancel,
    memory,
    clearSession,
    status: () => ({ ready: true, tools: registry.describe(), activeRuns: active.size, memory: memoryStore?.status() || { mode: "disabled", persistent: false } }),
  };
}

module.exports = { createAgentRuntime, defaultPlan };
