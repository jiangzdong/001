import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createVirtualSeniorLiveSession } = require("../electron/harness/virtual-senior-live-session.cjs");
const { createCommunityDataset } = require("../electron/harness/virtual-senior-community-dataset.cjs");
const dataset = createCommunityDataset({ profile: "smoke" });
const resident = Array.from({ length: 64 }, (_, index) => dataset.residentAt(index)).find((item) => item.permissionState === "verified-self" && item.healthState !== "no-record");

function setup(t, overrides = {}) {
  const events = []; let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const service = createVirtualSeniorLiveSession({ dataset, ackTimeoutMs: 100, turnDelayMs: 0, ...overrides, onEvent: (owner, event) => {
    events.push(event);
    if (["question", "answer"].includes(event.type) && overrides.autoAck !== false) queueMicrotask(() => service.acknowledge(owner, event));
    if (["completed", "failed", "cancelled"].includes(event.type)) done(event.payload.report);
  } });
  t.after(() => service.close());
  const binding = service.detail({ residentId: resident.seniorId }).binding;
  return { service, binding, events, finished };
}

for (const scenarioId of ["station-service", "member-points", "health-vitals", "health-history", "health-evaluations"]) test(`real isolated HTTP MCP and Harness: ${scenarioId}`, async (t) => {
  const { service, binding, finished, events } = setup(t, { ackTimeoutMs: 3000 });
  const prepared = service.prepare(1, { binding, scenarioId });
  service.begin(1, prepared.runId);
  const report = await finished;
  assert.equal(report.status, "completed", JSON.stringify(report.error));
  assert.equal(report.outcome, "completed");
  assert.equal(report.residentId, resident.seniorId);
  assert.equal(report.renderedSequences.length, 2);
  assert.ok(events.every((event) => event.runId === prepared.runId && event.residentId === resident.seniorId && event.sessionId === prepared.sessionId));
  assert.ok(report.result.toolTrace.length > 0);
  assert.equal(report.layers.tts, "not-run");
  assert.doesNotThrow(() => JSON.stringify(report));
  const reports = await service.reports();
  assert.doesNotThrow(() => JSON.stringify(reports));
  assert.equal(reports[0].runId, report.runId);
  if (scenarioId !== "station-service") {
    assert.equal(report.result.data.seniorId, resident.seniorId);
    assert.ok(report.result.toolTrace.some((item) => item.tool === "identity_permission_mcp.check_data_permission"));
  }
});

test("missing observer ack cannot count as a passed visible test", async (t) => {
  const { service, binding, finished } = setup(t, { autoAck: false });
  const prepared = service.prepare(1, { binding, scenarioId: "health-vitals" });
  service.begin(1, prepared.runId);
  const report = await finished;
  assert.equal(report.status, "failed");
  assert.equal(report.error.code, "OBSERVER_TIMEOUT");
  assert.deepEqual(report.renderedSequences, []);
});

test("owner, duplicate start, forged binding and cancellation isolate the run", async (t) => {
  const { service, binding, finished, events } = setup(t, { autoAck: false });
  assert.throws(() => service.prepare(1, { binding: { ...binding, residentId: 1 }, scenarioId: "health-vitals" }));
  const prepared = service.prepare(1, { binding, scenarioId: "health-vitals" });
  assert.throws(() => service.begin(2, prepared.runId));
  assert.throws(() => service.prepare(1, { binding, scenarioId: "health-vitals" }));
  service.begin(1, prepared.runId);
  assert.throws(() => service.begin(1, prepared.runId));
  assert.equal(await service.cancel(2, prepared.runId), false);
  assert.equal(await service.cancel(1, prepared.runId), true);
  const report = await finished;
  assert.equal(report.status, "cancelled");
  assert.equal(events.filter((event) => event.type === "answer").length, 0);
  const next = service.prepare(1, { binding, scenarioId: "health-vitals" });
  assert.notEqual(next.runId, prepared.runId);
  assert.notEqual(next.sessionId, prepared.sessionId);
});

test("anonymous resident preserves authorization block, never reads health values", async (t) => {
  const { service, finished, events } = setup(t);
  const anonymous = Array.from({ length: 64 }, (_, index) => dataset.residentAt(index)).find((item) => item.permissionState === "anonymous");
  const binding = service.detail({ residentId: anonymous.seniorId }).binding;
  const prepared = service.prepare(1, { binding, scenarioId: "health-vitals" });
  service.begin(1, prepared.runId);
  const report = await finished;
  assert.equal(report.outcome, "auth_required");
  assert.equal(events.filter((event) => event.type === "tool-start").length, 0);
});

test("late Harness result after cancellation cannot publish an answer", async (t) => {
  let release; let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const { service, binding, events, finished } = setup(t, { harnessFactory: () => ({
    run: () => { entered(); return new Promise((resolve) => { release = resolve; }); }, cancel: () => {}, clearSession: () => {},
  }) });
  const prepared = service.prepare(1, { binding, scenarioId: "health-vitals" });
  service.begin(1, prepared.runId);
  await started;
  const cancelled = service.cancel(1, prepared.runId);
  release({ ok: true, status: "completed", answer: { speechText: "this late answer must be ignored" } });
  await cancelled;
  assert.equal((await finished).status, "cancelled");
  assert.equal(events.some((event) => event.type === "answer"), false);
});

test("single-resident reports reload after restart without mixing batch reports", async (t) => {
  const reportRoot = await fs.mkdtemp(path.join(os.tmpdir(), "live-report-test-"));
  t.after(() => fs.rm(reportRoot, { recursive: true, force: true }));
  const { service, binding, finished } = setup(t, { reportRoot });
  const prepared = service.prepare(1, { binding, scenarioId: "station-service" });
  service.begin(1, prepared.runId);
  const report = await finished;
  const restarted = createVirtualSeniorLiveSession({ dataset, reportRoot });
  t.after(() => restarted.close());
  const reports = await restarted.reports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].runId, report.runId);
  assert.equal(reports[0].lane, "single-resident-live");
  assert.equal(reports[0].renderedSequences.length, 2);
  const preparedOnly = restarted.prepare(3, { binding, scenarioId: "health-vitals" });
  await restarted.closeOwner(3);
  assert.equal((await restarted.reports()).find((item) => item.runId === preparedOnly.runId).status, "cancelled");
});
