"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createXiaoanHarness } = require("./index.cjs");
const { getPersona, getScenario, listVirtualSeniorCatalog, SCENARIOS } = require("./virtual-senior-catalog.cjs");
const { analyzeVirtualSeniorReports } = require("./virtual-senior-analysis.cjs");

function assertion(id, expected, actual, pass, category) {
  return { id, category, expected, actual, result: pass ? "PASS" : "FAIL" };
}

function evaluateScenario(scenario, results, durationMs) {
  const expected = scenario.expected || {};
  const finalResult = results.at(-1) || {};
  const actualTools = results.flatMap((result) => result.toolTrace || []).map((item) => item.tool);
  const assertions = [];
  assertions.push(assertion("STATUS_MATCH", expected.status, finalResult.status, finalResult.status === expected.status, scenario.category));
  assertions.push(assertion("SCENARIO_MATCH", expected.scenario, finalResult.scenario, finalResult.scenario === expected.scenario, "路由"));
  if (expected.errorCodes?.length) assertions.push(assertion("ERROR_CODE_ALLOWED", expected.errorCodes, finalResult.error?.code || null, expected.errorCodes.includes(finalResult.error?.code), scenario.category));
  if (expected.policyReason) assertions.push(assertion("POLICY_REASON_MATCH", expected.policyReason, finalResult.policy?.reasonCode || null, finalResult.policy?.reasonCode === expected.policyReason, "权限"));
  if (expected.tools) assertions.push(assertion("TOOL_SEQUENCE_MATCH", expected.tools, actualTools, JSON.stringify(actualTools) === JSON.stringify(expected.tools), "MCP"));
  for (const forbidden of expected.forbiddenTools || []) assertions.push(assertion(`FORBIDDEN_TOOL:${forbidden}`, false, actualTools.includes(forbidden), !actualTools.includes(forbidden), "权限"));
  if (expected.fixtureSource) assertions.push(assertion("FIXTURE_SOURCE_MARKED", "test-fixture", finalResult.data?.source || null, finalResult.data?.source === "test-fixture", "MCP"));
  if (expected.factsRequired) assertions.push(assertion("FACT_IDS_PRESENT", true, finalResult.answer?.facts || [], Array.isArray(finalResult.answer?.facts) && finalResult.answer.facts.length > 0, "MCP"));
  for (const fragment of expected.forbiddenAnswer || []) assertions.push(assertion(`FORBIDDEN_ANSWER:${fragment}`, false, String(finalResult.answer?.speechText || "").includes(fragment), !String(finalResult.answer?.speechText || "").includes(fragment), "回答"));
  if (expected.maximumDurationMs) assertions.push(assertion("DURATION_BOUNDED", `<=${expected.maximumDurationMs}`, durationMs, durationMs <= expected.maximumDurationMs, "性能"));
  return { assertions, result: assertions.every((item) => item.result === "PASS") ? "PASS" : "FAIL", actualTools, finalResult };
}

function safeId(value, prefix) {
  const clean = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return clean || `${prefix}-${crypto.randomUUID()}`;
}

function loadRecentBatches(reportRoot, appVersion) {
  if (!reportRoot) return [];
  const versionRoot = path.join(reportRoot, appVersion);
  try {
    return fs.readdirSync(versionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(versionRoot, entry.name);
        try {
          const batch = JSON.parse(fs.readFileSync(path.join(directory, "batch-manifest.json"), "utf8"));
          return { ...batch, reportDirectory: directory };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      .slice(-12);
  } catch {
    return [];
  }
}

function createVirtualSeniorOrchestrator({ fixtureMcp, skillsRoot, appVersion = "0.0.0", reportRoot, now = () => Date.now(), harnessFactory = createXiaoanHarness } = {}) {
  if (!fixtureMcp) throw new Error("缺少虚拟长者 Fixture MCP");
  const active = new Map();
  const activeBatches = new Map();
  const batches = loadRecentBatches(reportRoot, appVersion);

  async function runCase(input = {}) {
    const scenario = getScenario(input.scenarioId);
    if (!scenario) throw Object.assign(new Error("测试场景不存在"), { code: "TEST_SCENARIO_NOT_FOUND" });
    const persona = getPersona(input.personaId || scenario.personaId);
    if (!persona?.synthetic) throw Object.assign(new Error("测试画像必须是合成数据"), { code: "TEST_PERSONA_INVALID" });
    const batchId = safeId(input.batchId, "batch");
    const runId = safeId(input.runId, "test-run");
    const sessionId = `test-${batchId}-${persona.personaId}`;
    const startedAtMs = now();
    fixtureMcp.configure(scenario.environment?.faults || {});
    const mcpServers = scenario.environment?.mode === "unconfigured" ? {} : fixtureMcp.serverConfigs();
    const harness = harnessFactory({ skillsRoot, mcpServers, clientVersion: appVersion });
    active.set(runId, { harness, currentAgentRunId: null });
    const results = [];
    try {
      for (let index = 0; index < scenario.turns.length; index += 1) {
        const agentRunId = `${runId}-agent-${index + 1}`;
        active.get(runId).currentAgentRunId = agentRunId;
        results.push(await harness.run({
          runId: agentRunId,
          sessionId,
          turnId: `${runId}-turn-${index + 1}`,
          text: scenario.turns[index].utterance,
          actor: { ...persona.actorFixture },
        }));
      }
    } finally {
      active.delete(runId);
      fixtureMcp.configure({});
      harness.clearSession(sessionId);
    }
    const durationMs = Math.max(0, now() - startedAtMs);
    const evaluated = evaluateScenario(scenario, results, durationMs);
    const report = {
      reportVersion: "1.0.0",
      batchId,
      runId,
      appVersion,
      suiteVersion: "1.0.0",
      category: scenario.category,
      personaId: persona.personaId,
      seed: persona.seed,
      scenarioId: scenario.scenarioId,
      environment: { mode: scenario.environment?.mode || "test-fixture", source: scenario.environment?.mode === "unconfigured" ? "none" : "test-fixture", faults: scenario.environment?.faults || {} },
      input: { kind: "text", turns: scenario.turns.map((turn) => ({ text: turn.utterance })) },
      observed: {
        scenarioSkill: evaluated.finalResult.scenario || null,
        status: evaluated.finalResult.status || "unknown",
        errorCode: evaluated.finalResult.error?.code || null,
        actualTools: evaluated.actualTools,
        answer: evaluated.finalResult.answer?.speechText || null,
        facts: evaluated.finalResult.answer?.facts || [],
        trace: results.flatMap((result) => result.trace || []),
      },
      assertions: evaluated.assertions,
      result: evaluated.result,
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs,
    };
    if (reportRoot) {
      const directory = path.join(reportRoot, appVersion, batchId, "runs", runId);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    return report;
  }

  async function runBatch(input = {}) {
    const timestamp = new Date(now()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const batchId = safeId(input.batchId || `batch-${timestamp}-${crypto.randomBytes(3).toString("hex")}`, "batch");
    const selected = Array.isArray(input.scenarioIds) && input.scenarioIds.length ? input.scenarioIds : SCENARIOS.map((item) => item.scenarioId);
    const reports = [];
    const control = { cancelled: false, currentRunId: null };
    activeBatches.set(batchId, control);
    try {
      for (const scenarioId of selected) {
        if (control.cancelled) break;
        control.currentRunId = safeId(`${batchId}-${scenarioId}`, "test-run");
        reports.push(await runCase({ batchId, scenarioId, runId: control.currentRunId }));
      }
    } finally {
      activeBatches.delete(batchId);
    }
    const previous = batches.at(-1)?.analysis || null;
    const analysis = analyzeVirtualSeniorReports(reports, previous);
    const batch = { reportVersion: "1.0.0", batchId, appVersion, suiteVersion: "1.0.0", createdAt: new Date(now()).toISOString(), scenarioIds: selected, executedScenarioIds: reports.map((report) => report.scenarioId), cancelled: control.cancelled, reports, analysis };
    if (reportRoot) batch.reportDirectory = path.join(reportRoot, appVersion, batchId);
    batches.push(batch);
    if (batches.length > 12) batches.shift();
    if (reportRoot) {
      const directory = batch.reportDirectory;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(directory, "batch-manifest.json"), `${JSON.stringify(batch, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    return batch;
  }

  function cancel(runId) {
    const id = String(runId || "");
    const batch = activeBatches.get(id);
    if (batch) {
      batch.cancelled = true;
      const item = active.get(batch.currentRunId);
      if (item?.currentAgentRunId) item.harness.cancel(item.currentAgentRunId);
      return true;
    }
    const item = active.get(id);
    return Boolean(item?.currentAgentRunId && item.harness.cancel(item.currentAgentRunId));
  }

  return {
    cancel,
    catalog: listVirtualSeniorCatalog,
    latest: () => batches.at(-1) || null,
    runBatch,
    runCase,
    status: () => ({ available: true, enabled: true, fixture: fixtureMcp.status(), activeRuns: active.size, activeBatches: activeBatches.size, recentBatches: batches.map((batch) => ({ batchId: batch.batchId, createdAt: batch.createdAt, cancelled: batch.cancelled, analysis: batch.analysis })) }),
  };
}

module.exports = { createVirtualSeniorOrchestrator, evaluateScenario, loadRecentBatches };
