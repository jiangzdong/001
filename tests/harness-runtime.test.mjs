import test from "node:test";
import assert from "node:assert/strict";
import harnessModule from "../electron/harness/index.cjs";

const { createXiaoanHarness, createToolRegistry, createAgentRuntime, createSessionMemoryStore } = harnessModule;

test("Harness exposes registered tools without executable functions", () => {
  const runtime = createXiaoanHarness();
  const status = runtime.status();
  assert.equal(status.ready, true);
  assert.deepEqual(status.tools.map((tool) => tool.name), ["station.get_service_schedule", "station.get_activity", "member.get_points", "member.get_balance"]);
  assert.ok(status.tools.every((tool) => !("execute" in tool)));
});

test("public station questions execute through plan, policy, tool and trace", async () => {
  const runtime = createXiaoanHarness();
  const result = await runtime.run({ requestId: "req-meal", sessionId: "sess-1", turnId: "turn-1", text: "助餐服务几点开始" });
  assert.equal(result.status, "completed");
  assert.equal(result.policy.decision, "ALLOW");
  assert.equal(result.toolTrace[0].tool, "station.get_service_schedule");
  assert.match(result.answer.speechText, /十一点半到十三点/);
  assert.deepEqual(result.trace.map((event) => event.type), ["run.started", "plan.completed", "policy.evaluated", "tool.completed"]);
});

test("different activity intents return fixture-grounded answers", async () => {
  const runtime = createXiaoanHarness();
  const lecture = await runtime.run({ text: "健康讲堂讲什么" });
  const exercise = await runtime.run({ text: "八段锦在哪里参加" });
  assert.match(lecture.answer.speechText, /慢病管理/);
  assert.match(exercise.answer.speechText, /一楼活动区/);
  assert.notEqual(lecture.answer.speechText, exercise.answer.speechText);
});

test("personal tools require verified self scope", async () => {
  const runtime = createXiaoanHarness();
  const anonymous = await runtime.run({ text: "查询我的积分", actor: { authLevel: "none", scopes: [] } });
  assert.equal(anonymous.status, "auth_required");
  const verified = await runtime.run({ text: "查询我的积分", actor: { authLevel: "verified", subjectToken: "opaque", scopes: ["member:read:self"] } });
  assert.equal(verified.status, "completed");
  assert.match(verified.answer.speechText, /2680/);
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
