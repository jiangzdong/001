"use strict";

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function increment(target, key) {
  const clean = key == null || key === "" ? "未分类" : String(key);
  target[clean] = (target[clean] || 0) + 1;
}

function recommendationsFrom(clusters, errors) {
  const ordered = Object.entries(clusters).sort((a, b) => b[1] - a[1]);
  const advice = [];
  for (const [name, count] of ordered.slice(0, 3)) {
    const action = name === "权限" ? "优先核查 actor、scope 与跨主体策略断言"
      : name === "MCP" || name === "合同" ? "优先核查 MCP 可用性、tools/list 合同与事实来源"
        : name === "性能" ? "检查超时阈值、慢工具与取消后的迟到结果"
          : name === "路由" ? "检查场景 Skill 选择和最小 Tool 白名单"
            : "按首个失败断言复现并补充固定回归用例";
    advice.push({ priority: advice.length + 1, cluster: name, failures: count, action });
  }
  if (!advice.length && Object.keys(errors).length === 0) advice.push({ priority: 1, cluster: "通过", failures: 0, action: "保持当前基准，新增语言变体时先冻结 artifact 再比较趋势" });
  return advice;
}

function recordResultBucket(target, key, result) {
  const clean = key == null || key === "" ? "未分类" : String(key);
  target[clean] ||= { total: 0, passed: 0, failed: 0, nonGating: 0 };
  target[clean].total += 1;
  if (result === "PASS") target[clean].passed += 1;
  else if (result === "NON_GATING") target[clean].nonGating += 1;
  else target[clean].failed += 1;
}

function analyzeVirtualSeniorReports(reports, previous = null) {
  const safeReports = Array.isArray(reports) ? reports : [];
  const durations = safeReports.map((report) => Number(report.durationMs) || 0);
  const failed = safeReports.filter((report) => report.result !== "PASS");
  const byCategory = {};
  const byScenario = {};
  const byPersona = {};
  const errorCodes = {};
  const failureAssertions = {};
  const failureClusters = {};
  const dimensions = { resident: {}, entity: {}, field: {}, mcp: {}, tool: {}, state: {}, permission: {}, pagination: {}, timeWindow: {}, scenario: {}, cohort: {}, latency: {}, error: {}, failureCluster: {}, trendComparable: true };
  const lanes = { fixed: { total: 0, passed: 0, failed: 0 }, exploratory: { total: 0, passed: 0, failed: 0 } };
  const generation = { artifactCount: 0, byModel: {}, byPromptHash: {}, bySchemaHash: {}, bySeed: {} };
  const asr = { total: 0, passed: 0, failed: 0, nonGating: 0, durations: [], byScenario: {}, byPersona: {}, byAudioCondition: {}, errorCodes: {}, failureClusters: {} };
  for (const report of safeReports) {
    const category = report.category || "未分类";
    const scenario = report.scenarioId || "unknown";
    const persona = report.personaId || "unknown";
    const lane = report.testMode === "generated-artifact" ? "exploratory" : "fixed";
    lanes[lane].total += 1;
    lanes[lane][report.result === "PASS" ? "passed" : "failed"] += 1;
    increment(dimensions.resident, report.communityResidentId || persona);
    increment(dimensions.entity, report.entity || "scenario-report");
    increment(dimensions.field, report.field || "hard-assertions");
    increment(dimensions.state, report.result || "unknown");
    increment(dimensions.permission, report.observed?.policyReason || (report.observed?.errorCode?.includes("AUTH") ? "authorization" : "not-applicable"));
    increment(dimensions.pagination, report.paginationState || "not-applicable");
    increment(dimensions.timeWindow, report.timeWindow || "not-applicable");
    increment(dimensions.scenario, scenario);
    increment(dimensions.cohort, report.cohort?.type || "fixed-baseline");
    increment(dimensions.latency, (Number(report.durationMs) || 0) < 100 ? "under-100ms" : (Number(report.durationMs) || 0) < 1000 ? "under-1s" : "over-1s");
    for (const toolName of report.observed?.actualTools || []) { const [mcp] = toolName.split("."); increment(dimensions.mcp, mcp); increment(dimensions.tool, toolName); }
    byCategory[category] ||= { total: 0, passed: 0, failed: 0 };
    byScenario[scenario] ||= { total: 0, passed: 0, failed: 0, durationMs: 0 };
    byPersona[persona] ||= { total: 0, passed: 0, failed: 0 };
    for (const bucket of [byCategory[category], byScenario[scenario], byPersona[persona]]) {
      bucket.total += 1;
      bucket[report.result === "PASS" ? "passed" : "failed"] += 1;
    }
    byScenario[scenario].durationMs += Number(report.durationMs) || 0;
    if (report.generation?.artifactHash) {
      generation.artifactCount += 1;
      increment(generation.byModel, `${report.generation.provider || "unknown"}/${report.generation.model || "unknown"}`);
      increment(generation.byPromptHash, report.generation.promptHash);
      increment(generation.bySchemaHash, report.generation.schemaHash);
      increment(generation.bySeed, report.generation.seed);
    }
    if (report.asr) {
      asr.total += 1;
      if (report.asr.result === "PASS") asr.passed += 1;
      else if (report.asr.result === "NON_GATING") asr.nonGating += 1;
      else asr.failed += 1;
      asr.durations.push(Number(report.asr.recognitionDurationMs) || 0);
      recordResultBucket(asr.byScenario, scenario, report.asr.result);
      recordResultBucket(asr.byPersona, persona, report.asr.result);
      recordResultBucket(asr.byAudioCondition, report.asr.audioCondition, report.asr.result);
      if (report.asr.errorCode) increment(asr.errorCodes, report.asr.errorCode);
      if (report.asr.result !== "PASS") increment(asr.failureClusters, report.asr.errorCode || "ASR_FAILED");
    }
    if (report.result !== "PASS") {
      increment(failureClusters, category);
      increment(errorCodes, report.observed?.errorCode || "ASSERTION_FAILED");
      increment(dimensions.error, report.observed?.errorCode || "ASSERTION_FAILED");
      increment(dimensions.failureCluster, category);
      for (const assertion of report.assertions || []) if (assertion.result !== "PASS") increment(failureAssertions, assertion.id);
    }
  }
  const total = safeReports.length;
  const passed = total - failed.length;
  const passRate = total ? Math.round((passed / total) * 1000) / 10 : 0;
  generation.trend = previous ? {
    previousArtifactCount: Number(previous.generation?.artifactCount) || 0,
    artifactCountDelta: generation.artifactCount - (Number(previous.generation?.artifactCount) || 0),
  } : null;
  const asrDurations = asr.durations;
  asr.passRate = asr.total ? Math.round((asr.passed / asr.total) * 1000) / 10 : 0;
  asr.duration = { totalMs: asrDurations.reduce((sum, value) => sum + value, 0), p50Ms: percentile(asrDurations, 0.5), p95Ms: percentile(asrDurations, 0.95), maxMs: asrDurations.length ? Math.max(...asrDurations) : 0 };
  asr.trend = previous ? { previousPassRate: Number(previous.asr?.passRate) || 0, deltaPassRate: Math.round((asr.passRate - (Number(previous.asr?.passRate) || 0)) * 10) / 10 } : null;
  delete asr.durations;
  return {
    total,
    passed,
    failed: failed.length,
    passRate,
    coverage: { scenarios: Object.keys(byScenario).length, personas: Object.keys(byPersona).length, categories: Object.keys(byCategory).length },
    duration: { totalMs: durations.reduce((sum, value) => sum + value, 0), p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), maxMs: durations.length ? Math.max(...durations) : 0 },
    byCategory,
    byScenario,
    byPersona,
    generation,
    asr,
    failureClusters,
    errorCodes,
    failureAssertions,
    dimensions,
    lanes,
    trend: previous ? { previousPassRate: Number(previous.passRate) || 0, deltaPassRate: Math.round((passRate - (Number(previous.passRate) || 0)) * 10) / 10 } : null,
    recommendations: recommendationsFrom(failureClusters, errorCodes),
  };
}

module.exports = { analyzeVirtualSeniorReports, percentile };
