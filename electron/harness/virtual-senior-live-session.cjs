"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createCommunityDataset, validateSuccessContract } = require("./virtual-senior-community-dataset.cjs");
const { JOURNEY, FULL_JOURNEY, argumentsFor, describeJourney, coverageFor } = require("./virtual-senior-live-journey.cjs");
const { createVirtualSeniorResidentSelection } = require("./virtual-senior-resident-selection.cjs");
const { createVirtualSeniorFixtureMcp } = require("./virtual-senior-fixture-mcp.cjs");
const { createXiaoanHarness, createMcpGateway } = require("./index.cjs");

const SCENARIOS = Object.freeze([
  FULL_JOURNEY,
  { id: "station-service", title: "站点服务咨询", question: "助餐服务几点开放？", tool: "health_evaluation_service_mcp_cms.get_station_service_detail", intent: "station.service.schedule" },
  { id: "member-points", title: "本人会员积分", question: "查一下我的会员积分", tool: "member_asset_mcp.get_member_points", intent: "member.points.self" },
  { id: "health-vitals", title: "本人健康体征", question: "查看我的最新健康体征", tool: "health_risk_assessment_mcp.get_latest_health_labels", intent: "qa.health.vitals.self" },
  { id: "health-history", title: "本人半年体征记录", question: "查看我的半年体征记录", tool: "health_risk_assessment_mcp.get_indicator_evidence", intent: "qa.health.history.self" },
  { id: "health-evaluations", title: "本人健康测评", question: "查看我的健康测评记录", tool: "health_evaluation_service_mcp_cms.get_health_evaluation_results", intent: "qa.health.evaluations.self" },
]);
const fail = (code, message) => Object.assign(new Error(message), { code });
const terminal = (state) => ["completed", "cancelled", "failed"].includes(state);

function describeData(scenario, data) {
  if (scenario.id === "station-service") return `${data.name}开放时间：${data.schedule}。地点：${data.location || "尚未提供"}。`;
  if (scenario.id === "member-points") return `该合成长者当前有 ${data.points} 积分。`;
  if (scenario.id === "health-vitals") return data.vitalSigns?.length ? data.vitalSigns.map((item) => `${item.displayName || item.metric} ${item.value} ${item.unit}`).join("；") + `。记录日期：${data.vitalSigns[0].observedAt.slice(0, 10)}。${data.vitalSigns.some((item) => item.quality === "stale") ? "资料已过期，不能当作当前体征。" : data.vitalSigns.some((item) => item.quality === "conflicting") ? "资料标记为冲突，需核对来源。" : ""}以上是合成测试记录，不作诊断。` : "该合成长者没有可用的健康体征记录。";
  if (scenario.id === "health-history") return `指定时间窗内有 ${data.total} 条合成体征记录，本次返回 ${data.evidence?.length || 0} 条。`;
  return data.results?.length ? `查到 ${data.results.length} 份合成健康测评，${data.results.filter((item) => item.status === "completed").length} 份已完成。` : "该合成长者没有可用的健康测评记录。";
}

function createVirtualSeniorLiveSession({ dataset = createCommunityDataset(), onEvent = () => {}, reportRoot = null, ackTimeoutMs = 10000, turnDelayMs = 1600, fixtureFactory = createVirtualSeniorFixtureMcp, harnessFactory = createXiaoanHarness } = {}) {
  const selector = createVirtualSeniorResidentSelection({ dataset });
  const runs = new Map();
  const owners = new Map();
  const history = [];
  const owned = (owner, runId) => {
    const run = runs.get(runId);
    if (!run || run.owner !== owner) throw fail("LIVE_RUN_NOT_FOUND", "当前窗口没有该测试会话");
    return run;
  };
  function emit(run, type, payload = {}) {
    if (run.closed) return null;
    const event = { runId: run.runId, sessionId: run.sessionId, residentId: run.binding.residentId, sequence: ++run.sequence, at: Date.now(), type, payload: { ...(run.currentTurn ? { turn: run.currentTurn } : {}), ...payload } };
    run.events.push(event);
    onEvent(run.owner, event);
    return event;
  }
  function acknowledge(owner, { runId, sequence } = {}) {
    const run = owned(owner, runId);
    const pending = run.pending;
    if (!pending || pending.sequence !== sequence || run.cancelled) return false;
    run.rendered.push(sequence);
    run.pending = null;
    clearTimeout(pending.timer);
    pending.resolve();
    return true;
  }
  function render(run, type, payload) {
    if (run.cancelled) return Promise.reject(fail("CANCELLED", "已停止"));
    return new Promise((resolve, reject) => {
      const sequence = run.sequence + 1;
      const timer = setTimeout(() => { run.pending = null; reject(fail("OBSERVER_TIMEOUT", "右侧观察界面未确认呈现，请重试")); }, ackTimeoutMs);
      run.pending = { sequence, timer, resolve, reject };
      emit(run, type, payload);
    });
  }
  function prepare(owner, input = {}) {
    if (owners.has(owner)) throw fail("LIVE_RUN_BUSY", "请先停止当前测试");
    const binding = selector.resolveBinding(input);
    const scenario = SCENARIOS.find((item) => item.id === (input.scenarioId || FULL_JOURNEY.id));
    if (!scenario) throw fail("INVALID_LIVE_SCENARIO", "请选择支持的测试场景");
    const runId = `live-${crypto.randomUUID()}`;
    const run = { owner, runId, sessionId: `qa-${crypto.randomUUID()}`, binding, scenario, turns: [], planned: scenario.id === FULL_JOURNEY.id ? JOURNEY : [scenario], state: "prepared", sequence: 0, events: [], rendered: [], startedAt: Date.now(), cancelled: false, closed: false };
    runs.set(runId, run); owners.set(owner, runId);
    run.prepareTimer = setTimeout(() => { void cancel(owner, runId); }, 60000);
    run.prepareTimer.unref?.();
    return { runId, sessionId: run.sessionId, binding, scenario, state: run.state };
  }
  async function finish(run, state, result = null, error = null) {
    if (run.closed) return;
    clearTimeout(run.prepareTimer);
    run.state = state;
    const report = { lane: "single-resident-live", synthetic: true, dataClassification: "synthetic-test-only", runId: run.runId, sessionId: run.sessionId, residentId: run.binding.residentId, binding: run.binding, scenarioId: run.scenario.id, startedAt: run.startedAt, endedAt: Date.now(), durationMs: Date.now() - run.startedAt, status: state, outcome: result?.status || null, renderedSequences: run.rendered, events: run.events, turns: run.turns, coverage: coverageFor(run.turns, run.events, run.planned), result, error, layers: { text: state === "completed" ? "rendered" : "incomplete", asr: "not-run", tts: "not-run", lipsync: "not-run", productionMcp: "not-run", fixtureMcp: true } };
    try {
      if (reportRoot) {
        await fs.mkdir(reportRoot, { recursive: true });
        await fs.writeFile(path.join(reportRoot, `${run.runId}.json`), JSON.stringify(report, null, 2), { flag: "wx" });
      }
    } catch { report.persistenceError = "报告保存失败，本次结果仅保留在当前应用"; }
    // The terminal event carries this report. Detach the pre-terminal event
    // array so history/report JSON cannot contain a circular self-reference.
    report.events = structuredClone(run.events);
    history.unshift(report); if (history.length > 50) history.pop();
    emit(run, state, { report });
    run.closed = true;
    if (owners.get(run.owner) === run.runId) owners.delete(run.owner);
    runs.delete(run.runId);
  }
  async function execute(run) {
    let fixture;
    try {
      fixture = fixtureFactory({ dataset });
      await fixture.start();
      if (run.cancelled) throw fail("CANCELLED", "已停止");
      const resident = dataset.resident(run.binding.residentId);
      const baseGateway = createMcpGateway({ servers: fixture.serverConfigs() });
      const gateway = { status: baseGateway.status, invoke: async (server, tool, args, context) => {
        if (run.cancelled) throw fail("CANCELLED", "已停止");
        const bound = { ...args };
        // Override only inside this QA gateway, after a canonical server-side
        // resident binding. The production planner/policy/credentials are untouched.
        for (const key of ["seniorId", "orgId", "tenantId"]) if (Object.hasOwn(bound, key)) bound[key] = typeof bound[key] === "string" ? String(resident[key]) : resident[key];
        emit(run, "tool-start", { tool: `${server}.${tool}`, residentId: resident.seniorId });
        const value = await baseGateway.invoke(server, tool, bound, context);
        if (run.cancelled) throw fail("CANCELLED", "已停止");
        if (value.data?.seniorId != null && String(value.data.seniorId) !== String(resident.seniorId)) throw fail("RESIDENT_MISMATCH", "接口返回的居民与选中画像不一致");
        const contract = validateSuccessContract(`${server}.${tool}`, value.data);
        if (!contract.valid) throw fail("FIXTURE_CONTRACT_INVALID", `${tool} 返回数据未通过结构与语义校验`);
        if (tool === "match_face_to_senior" && value.data.candidates.some((item) => String(item.seniorId) !== String(resident.seniorId))) throw fail("RESIDENT_MISMATCH", "身份结果不是当前居民");
        const businessOutcome = tool === "check_data_permission" && value.data.decision !== "ALLOW" ? value.data.decision === "AUTH_REQUIRED" ? "auth_required" : "denied" : tool === "match_face_to_senior" && value.data.outcome !== "MATCHED" ? "denied" : "completed";
        emit(run, "tool-complete", { tool: `${server}.${tool}`, data: value.data, businessOutcome });
        return value;
      } };
      const full = run.scenario.id === FULL_JOURNEY.id;
      const actor = ["verified-self", "scope-limited", "cross-subject"].includes(resident.permissionState) && resident.consentState === "valid" ? { subjectToken: `synthetic-${resident.seniorId}`, authLevel: "demo_verified", scopes: resident.permissionState === "scope-limited" ? [] : ["member:read:self", "health:read:self"] } : {};
      // Only pre-authorized synthetic profiles can exercise identity/policy.
      // Save scope is added only for the explicitly confirmed scripted save turn.
      if (full && actor.scopes?.length) actor.scopes.push("identity:verify", "policy:evaluate");
      let scenario, args;
      run.harness = harnessFactory({ gateway,
        scenarioResolver: { resolve: () => ({ id: `qa-live-${scenario.id}`, allowedTools: [scenario.tool, "identity_permission_mcp.check_data_permission"], content: "仅合成数据；不连接生产；不作诊断。" }), describe: () => ({ mode: "qa-only" }) },
        planner: () => ({ intent: scenario.intent, tool: scenario.tool, arguments: args, policyInput: { owner: "self" } }),
        composer: (_plan, data) => full ? describeJourney(scenario, data) : describeData(scenario, data),
      });
      const completed = new Map();
      let lastResult;
      for (const [index, item] of run.planned.entries()) {
        if (run.cancelled) throw fail("CANCELLED", "已停止");
        scenario = item;
        run.currentTurn = { index: index + 1, total: run.planned.length, id: item.id, title: item.title, tool: item.tool };
        const turn = { ...run.currentTurn, question: item.question, startedAt: Date.now(), status: "running", rendered: false };
        run.turns.push(turn);
        await render(run, "question", { text: scenario.question });
        let prepared;
        if (full) prepared = argumentsFor(scenario, resident, completed, run.runId);
        else {
          args = { seniorId: resident.seniorId, orgId: resident.orgId };
          if (scenario.id === "station-service") { delete args.seniorId; args.serviceId = "service-1"; }
          if (scenario.id === "health-vitals") Object.assign(args, { seniorId: String(resident.seniorId), orgId: String(resident.orgId), tenantId: String(resident.tenantId), types: "all" });
          if (scenario.id === "health-history") Object.assign(args, { signsTypeList: [], timeType: 180 });
          prepared = { args };
        }
        args = prepared.args;
        turn.arguments = args || null;
        if (prepared.skip) {
          lastResult = { ok: true, status: "skipped", answer: { speechText: prepared.skip }, reason: prepared.reason };
        } else {
          const turnActor = { ...actor, scopes: [...(actor.scopes || [])] };
          if (full && item.id.startsWith("save") && resident.permissionState === "verified-self" && turnActor.scopes.includes("health:read:self") && args.riskAssessmentDraft?.userConfirmed) turnActor.scopes.push("health:write:self");
          emit(run, "stage", { label: "正在执行权限校验与合成业务查询" });
          const queryStarted = Date.now();
          lastResult = await run.harness.run({ runId: run.runId, sessionId: run.sessionId, turnId: `${run.runId}-${item.id}`, text: scenario.question, actor: turnActor });
          turn.queryMs = Date.now() - queryStarted;
          if (run.cancelled) throw fail("CANCELLED", "已停止");
          if (full && item.id === "identity" && lastResult.data?.outcome !== "MATCHED") actor.scopes = [];
          if (full && item.id === "permission" && lastResult.data?.decision !== "ALLOW") actor.scopes = [];
          if (lastResult.data?.decision && lastResult.data.decision !== "ALLOW") lastResult.status = lastResult.data.decision === "AUTH_REQUIRED" ? "auth_required" : "denied";
          if (item.id === "identity" && lastResult.data && lastResult.data.outcome !== "MATCHED") lastResult.status = "denied";
          if (item.id === "save-replay" && lastResult.ok && lastResult.status === "completed" && (!lastResult.data?.replayed || lastResult.data.resultId !== completed.get("save")?.data?.resultId)) lastResult = { ...lastResult, ok: false, error: { code: "IDEMPOTENCY_MISMATCH", message: "重复提交没有返回同一合成记录" } };
        }
        if (run.cancelled) throw fail("CANCELLED", "已停止");
        turn.status = lastResult.ok ? lastResult.status : "failed";
        turn.result = lastResult;
        const text = !lastResult.ok ? `本轮执行失败：${lastResult.error?.message || "业务接口未返回有效结果"}。${full ? "将继续检查其它场景。" : "请重试。"}` : lastResult.answer?.speechText || (lastResult.status === "auth_required" ? "需要先完成本人身份确认与授权，本次没有读取个人业务数据。" : "本次访问未获授权，没有读取个人业务数据。");
        turn.answer = text;
        await render(run, "answer", { text, outcome: turn.status });
        turn.rendered = true; turn.endedAt = Date.now();
        if (turn.status === "completed") completed.set(item.id, { data: lastResult.data, arguments: args });
        if (!full && !lastResult.ok) throw fail(lastResult.error?.code || "LIVE_FAILED", lastResult.error?.message || "测试执行失败");
        if (full && index < run.planned.length - 1 && turnDelayMs > 0) {
          emit(run, "stage", { label: "本轮已呈现，稍后继续下一轮" });
          await new Promise((resolve) => { const timer = setTimeout(() => { run.wake = null; resolve(); }, turnDelayMs); run.wake = () => { clearTimeout(timer); run.wake = null; resolve(); }; });
        }
      }
      if (run.cancelled) throw fail("CANCELLED", "已停止");
      const coverage = coverageFor(run.turns, run.events, run.planned);
      await finish(run, "completed", full ? { ok: !coverage.failedTurns, status: coverage.failedTurns ? "partial_failure" : coverage.blockedTurns || coverage.skippedTurns ? "journey_partial" : "completed" } : lastResult);
    } catch (error) {
      const turn = run.turns.at(-1);
      if (turn && !turn.rendered) { turn.status = run.cancelled ? "cancelled" : "failed"; turn.error = { code: error.code, message: error.message }; }
      await finish(run, run.cancelled ? "cancelled" : "failed", null, { code: error.code || "LIVE_ERROR", message: String(error.message || "测试失败").slice(0, 200) });
    } finally {
      run.harness?.clearSession(run.sessionId);
      await fixture?.close();
    }
  }
  function begin(owner, runId) {
    const run = owned(owner, runId);
    if (run.state !== "prepared") throw fail("LIVE_ALREADY_STARTED", "测试已经开始");
    clearTimeout(run.prepareTimer); run.state = "running";
    run.done = execute(run);
    return { runId, state: run.state };
  }
  async function cancel(owner, runId) {
    const run = runs.get(runId);
    if (!run || run.owner !== owner || terminal(run.state)) return false;
    run.cancelled = true;
    run.wake?.();
    run.harness?.cancel(runId);
    if (run.pending) { clearTimeout(run.pending.timer); run.pending.reject(fail("CANCELLED", "已停止")); run.pending = null; }
    if (run.state === "prepared") await finish(run, "cancelled");
    else await run.done;
    return true;
  }
  async function reports() {
    const saved = new Map(history.map((item) => [item.runId, item]));
    if (reportRoot) {
      let names;
      try { names = await fs.readdir(reportRoot); } catch (error) { if (error.code !== "ENOENT") throw error; names = []; }
      const files = await Promise.all(names.filter((name) => /^live-[a-f0-9-]{36}\.json$/.test(name)).map(async (name) => {
        try { const stat = await fs.lstat(path.join(reportRoot, name)); return stat.isFile() && stat.size < 2_000_000 ? { name, time: stat.mtimeMs } : null; } catch { return null; }
      }));
      for (const file of files.filter(Boolean).sort((a, b) => b.time - a.time).slice(0, 50)) {
        try {
          const item = JSON.parse(await fs.readFile(path.join(reportRoot, file.name), "utf8"));
          if (item.lane === "single-resident-live" && item.synthetic === true && item.dataClassification === "synthetic-test-only" && `${item.runId}.json` === file.name && item.binding?.residentId === item.residentId && Array.isArray(item.renderedSequences) && !saved.has(item.runId)) saved.set(item.runId, item);
        } catch { /* An incomplete/corrupt historical file cannot break the UI. */ }
      }
    }
    return structuredClone([...saved.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50));
  }
  return { search: selector.search, detail: selector.detail, catalog: () => SCENARIOS, prepare, begin, acknowledge, cancel,
    reports,
    closeOwner: (owner) => owners.has(owner) ? cancel(owner, owners.get(owner)) : Promise.resolve(false),
    close: () => Promise.all([...owners].map(([owner, runId]) => cancel(owner, runId))),
  };
}

module.exports = { SCENARIOS, createVirtualSeniorLiveSession };
