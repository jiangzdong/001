"use strict";

const crypto = require("crypto");
const { evaluatePolicy } = require("./policy-engine.cjs");

function sanitizeId(value, prefix) {
  const clean = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  return clean || `${prefix}_${crypto.randomUUID()}`;
}

function defaultPlan(text) {
  if (/(头痛|头晕|失眠|睡不着|胸痛|呼吸困难|不舒服)/.test(text)) return { intent: "health.general", tool: null, arguments: {} };
  if (/助餐/.test(text) && /(几点|时间|开始|开放)/.test(text)) return { intent: "station.service.schedule", tool: "health_evaluation_service_mcp_cms.get_station_service_detail", arguments: { orgId: 1, serviceId: "meal_service" } };
  if (/(今天|今日|近期|最近).*(活动)|有什么活动|活动安排/.test(text)) return { intent: "station.activity.list", tool: "station_content_mcp.list_station_activities", arguments: { orgId: 1 } };
  if (/健康讲堂/.test(text)) return { intent: "station.activity.detail", tool: "station_content_mcp.list_station_activities", arguments: { orgId: 1 }, selection: "health_lecture" };
  if (/八段锦/.test(text)) return { intent: "station.activity.detail", tool: "station_content_mcp.list_station_activities", arguments: { orgId: 1 }, selection: "baduanjin" };
  if (/(积分)/.test(text)) return { intent: "member.points.self", tool: "member_asset_mcp.get_member_points", arguments: { seniorId: 1, orgId: 1 }, policyInput: { owner: /他人|别人|老伴|家人/.test(text) ? "other" : "self" } };
  return { intent: "station.knowledge.search", tool: "station_content_mcp.search_station_knowledge", arguments: { orgId: 1, query: text, limit: 3 } };
}

// The model proposes a plan, but it cannot downgrade an explicit personal
// member request into a general-health conversation. The policy gate below
// still prevents any personal MCP read until identity has been verified.
function enforceExplicitMemberIntent(text, plan = {}) {
  const value = String(text || "");
  if (!/积分/.test(value)) return plan;
  return {
    ...plan,
    intent: "member.points.self",
    tool: "member_asset_mcp.get_member_points",
    arguments: { ...(plan.arguments || {}), seniorId: 1, orgId: 1 },
    policyInput: { ...(plan.policyInput || {}), owner: /他人|别人|老伴|家人/.test(value) ? "other" : "self" },
  };
}

function publicAnswer(plan, data) {
  if (plan.intent === "health.general" && !plan.tool) return "我先了解一下：这种不适从什么时候开始，现在严重吗？如果突然很剧烈或伴有意识、说话、肢体异常，请立即就医。";
  if (plan.tool === "health_evaluation_service_mcp_cms.get_station_service_detail") return `${data.name}时间是${data.speechSchedule || data.schedule}，地点在${data.location}。`;
  if (plan.tool === "station_content_mcp.list_station_activities") {
    const activity = data.items?.find((item) => item.activityId === plan.selection) || data.items?.[0];
    return activity ? `${activity.title}：${activity.summary}。地点在${activity.location}。` : "暂时没有查到符合条件的站点活动。";
  }
  if (plan.tool === "member_asset_mcp.get_member_points") return `您当前有${data.total}积分。`;
  if (plan.tool === "station_content_mcp.search_station_knowledge") return data.items?.[0]?.summary || "这个问题暂时没有查到已发布的站点资料。";
  return "这个问题我暂时无法通过已注册工具核实。";
}

function createAgentRuntime({ registry, planner = defaultPlan, composer = publicAnswer, memoryStore = null, scenarioResolver = null, capabilities = {}, now = () => Date.now() }) {
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
    let selectedScenario = null;
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
      const scenario = scenarioResolver?.resolve(text) || { id: "unscoped", allowedTools: registry.describe().map((tool) => tool.name), content: "" };
      selectedScenario = scenario;
      const allowed = new Set(scenario.allowedTools);
      const visibleTools = registry.describe().filter((tool) => allowed.has(tool.name));
      trace.push({ type: "scenario.selected", at: now(), scenario: scenario.id, toolCount: visibleTools.length });
      plan = enforceExplicitMemberIntent(text, await planner(text, { registry: visibleTools, scenario, scenarioSkill: scenario.content, signal: controller.signal, memory: memoryStore?.snapshot(sessionId) || { sessionId, turns: [] } }));
      if (plan.tool && registry.get(plan.tool) && !allowed.has(plan.tool)) throw Object.assign(new Error("场景不允许调用该工具"), { code: "SCENARIO_TOOL_NOT_ALLOWED" });
      trace.push({ type: "plan.completed", at: now(), intent: plan.intent, tool: plan.tool });
      if (!plan.tool) {
        const composed = await composer(plan, null, { text, scenario: scenario.id, scenarioSkill: scenario.content, memory: memoryStore?.snapshot(sessionId), signal: controller.signal });
        const answer = typeof composed === "string" ? { speechText: composed } : composed;
        return finish({ ok: true, runId, sessionId, turnId, status: "completed", scenario: scenario.id, intent: plan.intent, answer, toolTrace: [], trace });
      }
      const tool = registry.get(plan.tool);
      sensitive = Boolean(tool && tool.sensitivity !== "public");
      const policy = evaluatePolicy({ tool, actor: input.actor, input: plan.policyInput || plan.arguments });
      trace.push({ type: "policy.evaluated", at: now(), decision: policy.decision, reasonCode: policy.reasonCode });
      if (policy.decision !== "ALLOW") {
        return finish({ ok: true, runId, sessionId, turnId, status: policy.decision === "AUTH_REQUIRED" ? "auth_required" : "denied", scenario: scenario.id, intent: plan.intent, policy, answer: null, toolTrace: [], trace });
      }
      const toolTrace = [];
      const toolArguments = { ...(plan.arguments || {}) };
      const needsRemoteAuthorization = tool.sensitivity === "personal" && tool.server !== "identity_permission_mcp";
      if (needsRemoteAuthorization) {
        delete toolArguments.authorizationId;
        const permissionToolName = "identity_permission_mcp.check_data_permission";
        const permissionStarted = now();
        const permissionInvocation = await registry.invoke(permissionToolName, {
          orgId: Number(toolArguments.orgId ?? input.tenantId ?? 1),
          operatorId: String(input.actor?.operatorId || input.terminalId || "kiosk"),
          seniorId: Number(toolArguments.seniorId ?? 1),
          action: tool.action,
          authToken: input.actor?.subjectToken || null,
        }, { runId, sessionId, turnId, signal: controller.signal, actor: input.actor || {} });
        const permissionData = permissionInvocation?.__mcpResult ? permissionInvocation.data : permissionInvocation;
        toolTrace.push({ tool: permissionToolName, server: permissionInvocation?.meta?.server || "identity_permission_mcp", transport: permissionInvocation?.meta?.transport || "mcp", source: permissionInvocation?.meta?.source || "remote", status: "ok", durationMs: Math.max(0, now() - permissionStarted) });
        if (permissionData?.decision !== "ALLOW" || !permissionData.authorizationId) {
          const decision = permissionData?.decision || "DENY";
          return finish({ ok: true, runId, sessionId, turnId, status: decision === "AUTH_REQUIRED" ? "auth_required" : "denied", scenario: scenario.id, intent: plan.intent, policy: permissionData || { decision: "DENY", reasonCode: "PERMISSION_SERVICE_DENIED" }, answer: null, toolTrace, trace });
        }
        toolArguments.authorizationId = permissionData.authorizationId;
      }
      const toolStarted = now();
      const invoked = await registry.invoke(plan.tool, toolArguments, { runId, sessionId, turnId, signal: controller.signal, actor: input.actor || {} });
      const data = invoked?.__mcpResult ? invoked.data : invoked;
      toolTrace.push({ tool: plan.tool, server: invoked?.meta?.server || tool.server || null, transport: invoked?.meta?.transport || tool.transport, source: invoked?.meta?.source || "local", status: "ok", durationMs: Math.max(0, now() - toolStarted) });
      trace.push({ type: "tool.completed", at: now(), tool: plan.tool, status: "ok" });
      const composed = await composer(plan, data, { text, scenario: scenario.id, scenarioSkill: scenario.content, memory: memoryStore?.snapshot(sessionId), signal: controller.signal });
      const answer = typeof composed === "string" ? { speechText: composed } : composed;
      return finish({ ok: true, runId, sessionId, turnId, status: "completed", scenario: scenario.id, intent: plan.intent, policy, answer: { ...answer, facts: data.factIds || data.fact_ids || answer?.facts || [] }, data, toolTrace, trace });
    } catch (error) {
      const code = error?.code || "HARNESS_ERROR";
      trace.push({ type: "run.failed", at: now(), code });
      return finish({ ok: false, runId, sessionId, turnId, status: code === "CANCELLED" ? "cancelled" : "recoverable_error", scenario: selectedScenario?.id || null, intent: plan.intent, error: { code, message: String(error?.message || "执行失败").slice(0, 160) }, toolTrace: [], trace });
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
    status: () => ({ ready: true, tools: registry.describe(), activeRuns: active.size, memory: memoryStore?.status() || { mode: "disabled", persistent: false }, ...Object.fromEntries(Object.entries(capabilities).map(([key, value]) => [key, typeof value === "function" ? value() : value])) }),
  };
}

module.exports = { createAgentRuntime, defaultPlan, enforceExplicitMemberIntent };
