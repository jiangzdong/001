"use strict";

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function increment(target, key) {
  const clean = String(key || "未分类");
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
  for (const report of safeReports) {
    const category = report.category || "未分类";
    const scenario = report.scenarioId || "unknown";
    const persona = report.personaId || "unknown";
    byCategory[category] ||= { total: 0, passed: 0, failed: 0 };
    byScenario[scenario] ||= { total: 0, passed: 0, failed: 0, durationMs: 0 };
    byPersona[persona] ||= { total: 0, passed: 0, failed: 0 };
    for (const bucket of [byCategory[category], byScenario[scenario], byPersona[persona]]) {
      bucket.total += 1;
      bucket[report.result === "PASS" ? "passed" : "failed"] += 1;
    }
    byScenario[scenario].durationMs += Number(report.durationMs) || 0;
    if (report.result !== "PASS") {
      increment(failureClusters, category);
      increment(errorCodes, report.observed?.errorCode || "ASSERTION_FAILED");
      for (const assertion of report.assertions || []) if (assertion.result !== "PASS") increment(failureAssertions, assertion.id);
    }
  }
  const total = safeReports.length;
  const passed = total - failed.length;
  const passRate = total ? Math.round((passed / total) * 1000) / 10 : 0;
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
    failureClusters,
    errorCodes,
    failureAssertions,
    trend: previous ? { previousPassRate: Number(previous.passRate) || 0, deltaPassRate: Math.round((passRate - (Number(previous.passRate) || 0)) * 10) / 10 } : null,
    recommendations: recommendationsFrom(failureClusters, errorCodes),
  };
}

module.exports = { analyzeVirtualSeniorReports, percentile };
