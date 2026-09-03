import test from "node:test";
import assert from "node:assert/strict";
import harnessModule from "../electron/harness/index.cjs";

const { createXiaoanHarness, createToolRegistry, createAgentRuntime, createSessionMemoryStore } = harnessModule;

test("Harness exposes registered tools without executable functions", () => {
  const runtime = createXiaoanHarness();
  const status = runtime.status();
  assert.equal(status.ready, true);
  assert.equal(status.tools.length, 16);
  assert.deepEqual([...new Set(status.tools.map((tool) => tool.server))], [
    "health_risk_assessment_mcp",
    "health_evaluation_service_mcp_cms",
    "identity_permission_mcp",
    "member_asset_mcp",
    "station_content_mcp",
  ]);
  assert.equal(status.mcp.mode, "local-unconfigured");
  assert.ok(status.tools.every((tool) => !("execute" in tool)));
});

test("MCP catalog matches the latest 5-server 16-tool contract and health ID types", () => {
  const tools = createXiaoanHarness().status().tools;
  assert.equal(tools.some((item) => item.server === "onsite_action_gateway_mcp"), false);
  const byName = Object.fromEntries(tools.map((item) => [item.name, item]));
  assert.equal(byName["health_risk_assessment_mcp.get_risk_assessment_context"].inputSchema.properties.seniorId.type, "integer");
  assert.equal(byName["health_risk_assessment_mcp.get_risk_assessment_context"].inputSchema.properties.businessId.type, "number");
  assert.equal(byName["health_risk_assessment_mcp.get_latest_health_labels"].inputSchema.properties.seniorId.type, "string");
  assert.equal(byName["health_risk_assessment_mcp.save_risk_assessment_result"].inputSchema.properties.orgId.type, "string");
});

test("Harness exposes four scoped station scenarios and only shows their allowed tools to the planner", async () => {
  const seen = [];
  const runtime = createXiaoanHarness({
    planner: async (_text, context) => {
      seen.push({ scenario: context.scenario.id, tools: context.registry.map((tool) => tool.name) });
      return { intent: context.scenario.id, tool: null, arguments: {} };
    },
  });
  assert.equal(runtime.status().scenarios.length, 4);
  await runtime.run({ text: "助餐服务有哪些" });
  await runtime.run({ text: "查询我的积分" });
  await runtime.run({ text: "头痛怎么办" });
  assert.equal(seen[0].scenario, "station-public-info-v1");
  assert.equal(seen[0].tools.length, 4);
  assert.equal(seen[1].scenario, "member-self-service-v1");
  assert.equal(seen[1].tools.length, 4);
  assert.equal(seen[2].scenario, "health-general-guidance-v1");
  assert.deepEqual(seen[2].tools, []);
});

test("ordinary symptoms use the health guidance scenario without MCP or authorization", async () => {
  const runtime = createXiaoanHarness();
  const result = await runtime.run({ text: "我今天头痛" });
  assert.equal(result.status, "completed");
  assert.equal(result.scenario, "health-general-guidance-v1");
  assert.equal(result.intent, "health.general");
  assert.deepEqual(result.toolTrace, []);
  assert.match(result.answer.speechText, /什么时候|严重/);
});

test("scenario boundary rejects a registered tool from another scenario", async () => {
  const runtime = createXiaoanHarness({ planner: async () => ({ intent: "member.points.self", tool: "member_asset_mcp.get_member_points", arguments: { seniorId: 1, orgId: 1 } }) });
  const result = await runtime.run({ text: "站点今天有什么活动" });
  assert.equal(result.status, "recoverable_error");
  assert.equal(result.error.code, "SCENARIO_TOOL_NOT_ALLOWED");
});

test("unconfigured local MCP never returns invented station service facts", async () => {
  const runtime = createXiaoanHarness();
  const result = await runtime.run({ requestId: "req-meal", sessionId: "sess-1", turnId: "turn-1", text: "助餐服务几点开始" });
  assert.equal(result.status, "recoverable_error");
  assert.equal(result.error.code, "DATA_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify(result), /11:30|13:00|一楼助餐区|无需预约/);
  assert.deepEqual(result.trace.map((event) => event.type), ["run.started", "scenario.selected", "plan.completed", "policy.evaluated", "run.failed"]);
});

test("unconfigured local MCP never returns invented activity facts", async () => {
  const runtime = createXiaoanHarness();
  const lecture = await runtime.run({ text: "健康讲堂讲什么" });
  const exercise = await runtime.run({ text: "八段锦在哪里参加" });
  assert.equal(lecture.error.code, "DATA_NOT_CONFIGURED");
  assert.equal(exercise.error.code, "DATA_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify([lecture, exercise]), /慢病管理|一楼活动区|09:30/);
});

test("personal tools require verified self scope", async () => {
  const runtime = createXiaoanHarness();
  const anonymous = await runtime.run({ text: "查询我的积分", actor: { authLevel: "none", scopes: [] } });
  assert.equal(anonymous.status, "auth_required");
  const verified = await runtime.run({ text: "查询我的积分", actor: { authLevel: "verified", subjectToken: "opaque", scopes: ["member:read:self"] } });
  assert.equal(verified.status, "recoverable_error");
  assert.equal(verified.error.code, "DATA_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify(verified), /2680/);
  assert.doesNotMatch(JSON.stringify(verified), /policy-authorized/);
});

test("cross-subject queries are denied before tool execution", async () => {
  const runtime = createXiaoanHarness();
  const result = await runtime.run({ text: "查询别人的积分", actor: { authLevel: "verified", subjectToken: "opaque", scopes: ["member:read:self"] } });
  assert.equal(result.status, "denied");
  assert.equal(result.policy.reasonCode, "CROSS_SUBJECT_DENIED");
  assert.equal(result.toolTrace.length, 0);
});

test("unknown tools and invalid input fail closed", async () => {
  const registry = createToolRegistry();
  const runtime = createAgentRuntime({ registry, planner: async () => ({ intent: "test", tool: "unknown.execute", arguments: {} }) });
  const result = await runtime.run({ text: "test" });
  assert.equal(result.status, "denied");
  assert.equal(result.policy.reasonCode, "TOOL_NOT_FOUND");
  registry.register({ name: "test.validate", sensitivity: "public", validate: (input) => input.id ? [] : ["缺少 id"], execute: () => ({ ok: true }) });
  const invalidRuntime = createAgentRuntime({ registry, planner: async () => ({ intent: "test.validate", tool: "test.validate", arguments: {} }) });
  const invalid = await invalidRuntime.run({ text: "test" });
  assert.equal(invalid.error.code, "INVALID_TOOL_INPUT");
});

test("tool deadline and cancellation produce bounded statuses", async () => {
  const registry = createToolRegistry();
  registry.register({ name: "test.wait", sensitivity: "public", timeoutMs: 50, execute: () => new Promise(() => {}) });
  const runtime = createAgentRuntime({ registry, planner: async () => ({ intent: "test.wait", tool: "test.wait", arguments: {} }) });
  const timedOut = await runtime.run({ runId: "timeout-run", text: "wait" });
  assert.equal(timedOut.error.code, "TOOL_TIMEOUT");
  const pending = runtime.run({ runId: "cancel-run", text: "wait" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runtime.cancel("cancel-run"), true);
  assert.equal((await pending).status, "cancelled");
});

test("session memory is bounded and supplied only to the same session planner", async () => {
  const seen = [];
  const registry = createToolRegistry();
  const memoryStore = createSessionMemoryStore({ maxTurns: 2 });
  const runtime = createAgentRuntime({
    registry,
    memoryStore,
    planner: async (text, context) => {
      seen.push({ text, turns: context.memory.turns.map((turn) => turn.userText) });
      return { intent: "unknown", tool: null, arguments: {} };
    },
  });
  await runtime.run({ sessionId: "alpha", text: "第一问" });
  await runtime.run({ sessionId: "alpha", text: "第二问" });
  await runtime.run({ sessionId: "alpha", text: "第三问" });
  await runtime.run({ sessionId: "beta", text: "另一个会话" });
  assert.deepEqual(seen[1].turns, ["第一问"]);
  assert.deepEqual(runtime.memory("alpha").turns.map((turn) => turn.userText), ["第二问", "第三问"]);
  assert.deepEqual(seen[3].turns, []);
});

test("personal results and actor credentials are absent from session memory", async () => {
  const runtime = createXiaoanHarness();
  await runtime.run({
    sessionId: "private-session",
    text: "查询我的积分",
    actor: { authLevel: "verified", subjectToken: "secret-subject-token", scopes: ["member:read:self"] },
  });
  const memory = runtime.memory("private-session");
  assert.equal(memory.turns[0].sensitive, true);
  assert.equal(memory.turns[0].userText, null);
  assert.equal(memory.turns[0].assistantText, null);
  assert.doesNotMatch(JSON.stringify(memory), /2680|secret-subject-token/);
});

test("session memory expires and can be explicitly cleared", async () => {
  let clock = 1000;
  const memoryStore = createSessionMemoryStore({ maxIdleMs: 100, now: () => clock });
  const runtime = createXiaoanHarness({ memoryStore, now: () => clock });
  await runtime.run({ sessionId: "expiring", text: "助餐服务几点开始" });
  assert.equal(runtime.memory("expiring").turns.length, 1);
  assert.equal(runtime.clearSession("expiring"), true);
  assert.equal(runtime.memory("expiring").turns.length, 0);
  await runtime.run({ sessionId: "expiring", text: "健康讲堂讲什么" });
  clock += 101;
  assert.equal(runtime.memory("expiring").turns.length, 0);
  assert.equal(runtime.status().memory.persistent, false);
});

test("MCP gateway performs initialize, discovery and tools/call over Streamable HTTP", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ body, headers: options.headers });
    const result = body.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : body.method === "tools/list"
        ? { tools: [{ name: "list_station_activities", inputSchema: { type: "object" } }] }
        : body.method === "tools/call"
          ? { structuredContent: { items: [{ title: "远端活动" }] } }
          : null;
    return {
      ok: true,
      status: body.method === "notifications/initialized" ? 202 : 200,
      headers: { get: (name) => name.toLowerCase() === "mcp-session-id" ? "session-remote" : "application/json" },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    };
  };
  const gateway = harnessModule.createMcpGateway({
    servers: { station_content_mcp: { url: "https://mcp.example.test/rpc", token: "secret" } },
    localExecutors: {},
    fetchImpl,
  });
  const result = await gateway.invoke("station_content_mcp", "list_station_activities", { orgId: 1 });
  assert.equal(result.data.items[0].title, "远端活动");
  assert.equal(result.meta.transport, "streamable-http");
  assert.deepEqual(calls.map((call) => call.body.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  assert.equal(calls[1].headers["Mcp-Session-Id"], "session-remote");
});

test("configured Harness uses DeepSeek for planning and post-MCP response composition", async () => {
  let modelCalls = 0;
  const fetchImpl = async (_url, options) => {
    modelCalls += 1;
    const content = modelCalls === 1
      ? { intent: "station.service.schedule", confidence: 0.98, tool: "health_evaluation_service_mcp_cms.get_station_service_detail", arguments: { orgId: 1, serviceId: "meal_service" }, policyInput: { owner: "self" }, selection: null }
      : { title: "助餐信息", speechText: "您问的是助餐服务，以下内容来自已连接的业务系统。", suggestions: [{ id: "station-service-detail" }] };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
  };
  const gateway = {
    status: () => ({ mode: "remote", servers: [] }),
    invoke: async (server, tool) => ({
      __mcpResult: true,
      data: { serviceId: "meal_service", name: "助餐服务", schedule: "以业务系统返回为准", location: "以业务系统返回为准", bookingRequired: null, factIds: ["remote:test:meal"] },
      meta: { server, tool, transport: "streamable-http", source: "remote" },
    }),
  };
  const runtime = createXiaoanHarness({ getDeepSeekKey: () => "sk-test-key-1234567890", fetchImpl, gateway });
  const result = await runtime.run({ text: "请问今天助餐几点开始" });
  assert.equal(modelCalls, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.answer.title, "助餐信息");
  assert.match(result.answer.speechText, /来自已连接的业务系统/);
  assert.equal(result.toolTrace[0].source, "remote");
});

test("general symptom stays in health.general without membership or personal-data tools", async () => {
  const modelRequests = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    modelRequests.push(request);
    const content = modelRequests.length === 1
      ? { intent: "health.general", confidence: 0.99, tool: null, arguments: {}, policyInput: { owner: "self" }, selection: null }
      : { title: "先了解头痛情况", speechText: "听到您说头痛了。请告诉我是突然剧烈疼痛，还是已经持续了一段时间？", suggestions: [] };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
  };
  const runtime = createXiaoanHarness({ getDeepSeekKey: () => "sk-test-key-1234567890", fetchImpl });
  const result = await runtime.run({ text: "头痛。", actor: { authLevel: "none", scopes: [] } });
  assert.equal(modelRequests.length, 2);
  assert.match(modelRequests[0].messages[0].content, /一般症状[\s\S]*health\.general[\s\S]*tool=null/);
  assert.equal(result.status, "completed");
  assert.equal(result.intent, "health.general");
  assert.deepEqual(result.toolTrace, []);
  assert.match(result.answer.speechText, /头痛/);
  assert.doesNotMatch(JSON.stringify(result), /会员积分|member\.points/);
});
