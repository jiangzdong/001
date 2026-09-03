import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fixtureModule from "../electron/harness/virtual-senior-fixture-mcp.cjs";
import orchestratorModule from "../electron/harness/virtual-senior-orchestrator.cjs";
import analysisModule from "../electron/harness/virtual-senior-analysis.cjs";
import catalogModule from "../electron/harness/virtual-senior-catalog.cjs";

const { createVirtualSeniorFixtureMcp } = fixtureModule;
const { createVirtualSeniorOrchestrator } = orchestratorModule;
const { analyzeVirtualSeniorReports } = analysisModule;
const { listVirtualSeniorCatalog } = catalogModule;

test("virtual senior catalog exposes synthetic personas without actor credentials", () => {
  const catalog = listVirtualSeniorCatalog();
  assert.equal(catalog.personas.length, 3);
  assert.equal(catalog.scenarios.length, 10);
  assert.ok(catalog.personas.every((persona) => persona.synthetic === true));
  assert.ok(catalog.personas.every((persona) => !("actorFixture" in persona)));
  assert.ok(catalog.scenarios.every((scenario) => !("expected" in scenario)));
});

test("fixture MCP uses real Streamable HTTP and marks synthetic facts", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const config = fixture.serverConfigs().station_content_mcp;
  const initialize = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(initialize.ok, true);
  assert.match(initialize.headers.get("mcp-session-id"), /^fixture-/);
  const call = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_station_activities", arguments: { orgId: 1 } } }),
  });
  const payload = await call.json();
  assert.equal(payload.result.structuredContent.source, "test-fixture");
  assert.ok(payload.result.structuredContent.factIds.length > 0);
});

test("orchestrator runs fixed cases through Harness and emits hard assertions", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18" });
  const activity = await orchestrator.runCase({ scenarioId: "PUB-ACTIVITY-001", runId: "activity" });
  assert.equal(activity.result, "PASS");
  assert.deepEqual(activity.observed.actualTools, ["station_content_mcp.list_station_activities"]);
  assert.equal(activity.environment.source, "test-fixture");
  const crossSubject = await orchestrator.runCase({ scenarioId: "MEMBER-CROSS-001", runId: "cross-subject" });
  assert.equal(crossSubject.result, "PASS");
  assert.equal(crossSubject.observed.status, "denied");
  assert.deepEqual(crossSubject.observed.actualTools, []);
});

test("batch analysis aggregates coverage, failures, latency and optimization advice", () => {
  const reports = [
    { result: "PASS", category: "路由", scenarioId: "A", personaId: "P1", durationMs: 20, assertions: [], observed: {} },
    { result: "FAIL", category: "MCP", scenarioId: "B", personaId: "P2", durationMs: 80, assertions: [{ id: "FACT_IDS_PRESENT", result: "FAIL" }], observed: { errorCode: "MCP_HTTP_ERROR" } },
  ];
  const analysis = analyzeVirtualSeniorReports(reports, { passRate: 80 });
  assert.equal(analysis.total, 2);
  assert.equal(analysis.passRate, 50);
  assert.equal(analysis.coverage.scenarios, 2);
  assert.equal(analysis.duration.p95Ms, 80);
  assert.equal(analysis.failureClusters.MCP, 1);
  assert.equal(analysis.errorCodes.MCP_HTTP_ERROR, 1);
  assert.equal(analysis.failureAssertions.FACT_IDS_PRESENT, 1);
  assert.equal(analysis.trend.deltaPassRate, -30);
  assert.match(analysis.recommendations[0].action, /MCP/);
});

test("batch history persists across orchestrator restarts for trend comparison", async (t) => {
  const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-history-"));
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(async () => {
    await fixture.close();
    fs.rmSync(reportRoot, { recursive: true, force: true });
  });
  const first = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18", reportRoot });
  const initialBatch = await first.runBatch({ batchId: "batch-history-1", scenarioIds: ["PUB-ACTIVITY-001"] });
  assert.equal(initialBatch.reportDirectory, path.join(reportRoot, "1.5.18", "batch-history-1"));

  const restarted = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18", reportRoot });
  assert.equal(restarted.latest().batchId, "batch-history-1");
  const nextBatch = await restarted.runBatch({ batchId: "batch-history-2", scenarioIds: ["HEALTH-GENERAL-001"] });
  assert.equal(nextBatch.analysis.trend.previousPassRate, initialBatch.analysis.passRate);
  assert.equal(nextBatch.analysis.trend.deltaPassRate, 0);
});

test("test console is startup-gated and avoids single-side status strokes", async () => {
  const [mainSource, preloadSource, appSource, styles] = await Promise.all([
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../src/StationAdvisorApp.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/station-advisor.css", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /process\.argv\.includes\("--virtual-senior-test"\)/);
  assert.match(mainSource, /virtualSeniorEnabled \? \["--virtual-senior-test"\] : \[\]/);
  assert.match(preloadSource, /virtualSeniorAvailable: process\.argv\.includes\("--virtual-senior-test"\)/);
  assert.match(appSource, /window\.kioskBridge\?\.virtualSeniorAvailable/);
  const consoleStyles = styles.slice(styles.indexOf("\/\* Virtual-senior QA console"), styles.indexOf(".advisor-header {"));
  assert.doesNotMatch(consoleStyles, /border-(?:left|right)\s*:/);
  assert.match(consoleStyles, /\.virtual-senior-metric[^}]*background:/);
  assert.match(consoleStyles, /\.virtual-senior-footer > button\.is-cancel/);
});
