"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createXiaoanHarness } = require("./index.cjs");
const { getPersona, getScenario, listVirtualSeniorCatalog, SCENARIOS } = require("./virtual-senior-catalog.cjs");
const { analyzeVirtualSeniorReports } = require("./virtual-senior-analysis.cjs");
const VERIFIED_ASR = Symbol("verified-virtual-senior-asr");

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

function persistBatch(batch) {
  if (!batch.reportDirectory) return;
  fs.mkdirSync(batch.reportDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(batch.reportDirectory, "batch-manifest.json"), `${JSON.stringify(batch, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function createVirtualSeniorOrchestrator({ fixtureMcp, skillsRoot, appVersion = "0.0.0", reportRoot, artifactStore, variantGenerator, now = () => Date.now(), harnessFactory = createXiaoanHarness } = {}) {
  if (!fixtureMcp) throw new Error("缺少虚拟长者 Fixture MCP");
  const active = new Map();
  const activeBatches = new Map();
  const batches = loadRecentBatches(reportRoot, appVersion);

  function generateVariant(input = {}) {
    if (input.testMode !== "generated-artifact") throw Object.assign(new Error("LLM 变体生成必须使用显式 generated-artifact 模式"), { code: "TEST_MODE_REQUIRED" });
    if (!variantGenerator) throw Object.assign(new Error("未配置 LLM 变体生成器"), { code: "TEST_VARIANT_GENERATOR_NOT_CONFIGURED" });
    const { testMode: _testMode, ...request } = input;
    return variantGenerator.generate(request);
  }

  function runAsrCase(input = {}) {
    if (!input.asrEvidence?.verified || typeof input.transcript !== "string" || !input.transcript.trim()) {
      throw Object.assign(new Error("固定 WAV ASR 缺少已验证的识别证据"), { code: "ASR_EVIDENCE_REQUIRED" });
    }
    return runCase({ ...input, testMode: "fixed-wav-asr", _verifiedAsr: VERIFIED_ASR });
  }

  async function runCase(input = {}) {
    const testMode = input.testMode || "fixed";
    if (!["fixed", "generated-artifact", "fixed-wav-asr"].includes(testMode)) throw Object.assign(new Error("测试模式无效"), { code: "TEST_MODE_INVALID" });
    if (testMode === "fixed-wav-asr" && input._verifiedAsr !== VERIFIED_ASR) throw Object.assign(new Error("固定 WAV ASR 只能由已验证音频门禁调用"), { code: "ASR_EVIDENCE_REQUIRED" });
    if (testMode !== "generated-artifact" && input.artifactHash) throw Object.assign(new Error("变体制品必须使用显式 generated-artifact 模式"), { code: "TEST_MODE_REQUIRED" });
    if (testMode === "generated-artifact" && !input.artifactHash) throw Object.assign(new Error("generated-artifact 模式缺少制品哈希"), { code: "TEST_ARTIFACT_REQUIRED" });
    if (testMode === "generated-artifact" && !artifactStore) throw Object.assign(new Error("未配置变体制品存储"), { code: "TEST_ARTIFACT_STORE_NOT_CONFIGURED" });
    const artifact = testMode === "generated-artifact" ? artifactStore.get(input.artifactHash) : null;
    const scenarioId = artifact?.candidate?.scenarioId || input.scenarioId;
    if (input.scenarioId && artifact && input.scenarioId !== scenarioId) throw Object.assign(new Error("变体制品与请求场景不匹配"), { code: "TEST_ARTIFACT_SCENARIO_MISMATCH" });
    const scenario = getScenario(scenarioId);
    if (!scenario) throw Object.assign(new Error("测试场景不存在"), { code: "TEST_SCENARIO_NOT_FOUND" });
    const personaId = artifact?.candidate?.personaId || input.personaId || scenario.personaId;
    if (input.personaId && artifact && input.personaId !== personaId) throw Object.assign(new Error("变体制品与请求画像不匹配"), { code: "TEST_ARTIFACT_PERSONA_MISMATCH" });
    const persona = getPersona(personaId);
    if (!persona?.synthetic) throw Object.assign(new Error("测试画像必须是合成数据"), { code: "TEST_PERSONA_INVALID" });
    const turns = testMode === "fixed-wav-asr" ? [{ utterance: input.transcript.trim() }] : (artifact?.candidate?.turns || scenario.turns);
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
      for (let index = 0; index < turns.length; index += 1) {
        const agentRunId = `${runId}-agent-${index + 1}`;
        active.get(runId).currentAgentRunId = agentRunId;
        results.push(await harness.run({
          runId: agentRunId,
          sessionId,
          turnId: `${runId}-turn-${index + 1}`,
          text: turns[index].utterance,
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
      testMode,
      category: scenario.category,
      personaId: persona.personaId,
      seed: persona.seed,
      scenarioId: scenario.scenarioId,
      environment: { mode: scenario.environment?.mode || "test-fixture", source: scenario.environment?.mode === "unconfigured" ? "none" : "test-fixture", faults: scenario.environment?.faults || {} },
      input: { kind: "text", source: testMode === "fixed-wav-asr" ? "fixed-wav-asr" : artifact ? "generated-artifact" : "fixed-manifest", turns: turns.map((turn) => ({ text: turn.utterance })) },
      generation: artifact ? {
        artifactHash: artifact.artifactHash,
        candidateHash: artifact.candidateHash,
        requestHash: artifact.requestHash,
        ...artifact.generation,
      } : null,
      asr: testMode === "fixed-wav-asr" ? { ...input.asrEvidence } : null,
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
    const testMode = input.testMode || "fixed";
    if (!["fixed", "generated-artifact"].includes(testMode)) throw Object.assign(new Error("测试模式无效"), { code: "TEST_MODE_INVALID" });
    const artifactHashes = Array.isArray(input.artifactHashes) ? input.artifactHashes : [];
    if (testMode === "generated-artifact" && artifactHashes.length === 0) throw Object.assign(new Error("generated-artifact 批次缺少制品哈希"), { code: "TEST_ARTIFACT_REQUIRED" });
    if (testMode === "fixed" && artifactHashes.length) throw Object.assign(new Error("变体制品必须使用显式 generated-artifact 模式"), { code: "TEST_MODE_REQUIRED" });
    const selected = testMode === "generated-artifact"
      ? artifactHashes.map((artifactHash) => ({ artifactHash }))
      : (Array.isArray(input.scenarioIds) && input.scenarioIds.length ? input.scenarioIds : SCENARIOS.map((item) => item.scenarioId)).map((scenarioId) => ({ scenarioId }));
    const recoverable = input.resume === true ? batches.find((item) => item.batchId === batchId && ["paused", "cancelled", "failed"].includes(item.status)) : null;
    const reports = [...(recoverable?.reports || [])];
    const pendingCases = [...(recoverable?.pendingCases || selected)];
    const control = { cancelled: false, paused: false, currentRunId: null };
    const batch = recoverable || {
      reportVersion: "1.1.0", batchId, appVersion, suiteVersion: "community-suite-v1.0.0", testMode,
      profile: input.profile || "smoke", cohort: input.cohort || { type: "fixed-baseline" }, createdAt: new Date(now()).toISOString(),
      selectedCases: selected, pendingCases, reports, checkpoint: { completed: reports.length, total: reports.length + pendingCases.length, updatedAt: new Date(now()).toISOString() }, status: "running",
    };
    if (reportRoot) batch.reportDirectory = path.join(reportRoot, appVersion, batchId);
    batch.status = "running";
    batch.resumedAt = recoverable ? new Date(now()).toISOString() : null;
    persistBatch(batch);
    activeBatches.set(batchId, control);
    try {
      while (pendingCases.length) {
        if (control.cancelled || control.paused) break;
        const selectedCase = pendingCases[0];
        const caseKey = selectedCase.scenarioId || selectedCase.artifactHash;
        control.currentRunId = safeId(`${batchId}-${caseKey}`, "test-run");
        try {
          const report = await runCase({ batchId, testMode, ...selectedCase, runId: control.currentRunId });
          if (!control.cancelled) { reports.push(report); pendingCases.shift(); }
        } catch (error) {
          if (!control.cancelled) { reports.push({ reportVersion: "1.0.0", batchId, runId: control.currentRunId, scenarioId: selectedCase.scenarioId || null, result: "FAIL", category: "执行", personaId: "community", durationMs: 0, observed: { errorCode: error?.code || "BATCH_RUN_FAILED" }, assertions: [{ id: "RUN_COMPLETED", result: "FAIL" }] }); pendingCases.shift(); }
        }
        batch.pendingCases = pendingCases;
        batch.checkpoint = { completed: reports.length, total: reports.length + pendingCases.length, updatedAt: new Date(now()).toISOString(), lastRunId: control.currentRunId };
        persistBatch(batch);
      }
    } finally {
      activeBatches.delete(batchId);
    }
    const previous = batches.at(-1)?.analysis || null;
    const analysis = analyzeVirtualSeniorReports(reports, previous);
    batch.scenarioIds = reports.map((report) => report.scenarioId);
    batch.artifactHashes = reports.map((report) => report.generation?.artifactHash).filter(Boolean);
    batch.executedScenarioIds = reports.map((report) => report.scenarioId);
    batch.cancelled = control.cancelled;
    batch.paused = control.paused;
    batch.status = control.cancelled ? "cancelled" : control.paused ? "paused" : pendingCases.length ? "failed" : "completed";
    batch.completedAt = batch.status === "completed" ? new Date(now()).toISOString() : null;
    batch.analysis = analysis;
    if (!batches.some((item) => item.batchId === batchId)) batches.push(batch);
    if (batches.length > 12) batches.shift();
    persistBatch(batch);
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

  function pause(batchId) {
    const batch = activeBatches.get(String(batchId || ""));
    if (!batch) return false;
    batch.paused = true;
    return true;
  }

  function resume(batchId) {
    return runBatch({ batchId, resume: true });
  }

  async function rerunFailed(batchId) {
    const previous = batches.find((item) => item.batchId === String(batchId || ""));
    if (!previous) throw Object.assign(new Error("未找到可重跑批次"), { code: "BATCH_NOT_FOUND" });
    const failed = (previous.reports || []).filter((report) => report.result !== "PASS").map((report) => report.scenarioId).filter(Boolean);
    return runBatch({ batchId: `${previous.batchId}-retry-${crypto.randomBytes(2).toString("hex")}`, scenarioIds: failed, profile: previous.profile, cohort: { type: "rerun-failed", sourceBatchId: previous.batchId } });
  }

  return {
    cancel,
    catalog: () => ({ ...listVirtualSeniorCatalog(), community: typeof fixtureMcp.dataset === "function" ? fixtureMcp.dataset() : null }),
    generateVariant,
    latest: () => batches.at(-1) || null,
    pause,
    rerunFailed,
    resume,
    runAsrCase,
    runBatch,
    runCase,
    status: () => ({ available: true, enabled: true, variantGenerationAvailable: Boolean(variantGenerator), fixture: fixtureMcp.status(), activeRuns: active.size, activeBatches: activeBatches.size, recentBatches: batches.map((batch) => ({ batchId: batch.batchId, createdAt: batch.createdAt, cancelled: batch.cancelled, analysis: batch.analysis })) }),
  };
}

module.exports = { createVirtualSeniorOrchestrator, evaluateScenario, loadRecentBatches };
