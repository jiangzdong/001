import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createVirtualSeniorLiveSession } = require("../electron/harness/virtual-senior-live-session.cjs");
const { createCommunityDataset } = require("../electron/harness/virtual-senior-community-dataset.cjs");
const { createVirtualSeniorFixtureMcp } = require("../electron/harness/virtual-senior-fixture-mcp.cjs");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");
const { MCP_TOOL_CATALOG } = require("../electron/harness/mcp-tools.cjs");
const dataset = createCommunityDataset();
const residents = Array.from({ length: 1000 }, (_, i) => dataset.residentAt(i));
const verified = residents.find((r) => r.permissionState === "verified-self" && r.healthState === "routine" && r.dataQuality === "complete");

async function journey(t, resident = verified, options = {}) {
  const events = []; let resolve;
  const finished = new Promise((r) => { resolve = r; });
  const service = createVirtualSeniorLiveSession({ dataset, turnDelayMs: 0, ackTimeoutMs: 2000, ...options, onEvent(owner, event) {
    events.push(event);
    if (["question", "answer"].includes(event.type)) queueMicrotask(() => service.acknowledge(owner, event));
    if (["completed", "failed", "cancelled"].includes(event.type)) resolve(event.payload.report);
    options.observe?.(event, service);
  } });
  t.after(() => service.close());
  const prepared = service.prepare(1, { binding: service.detail({ residentId: resident.seniorId }).binding });
  service.begin(1, prepared.runId);
  return { service, events, report: await finished, prepared };
}

test("default full journey runs 22 contextual turns and all 16 real HTTP tools in one session", async (t) => {
  assert.deepEqual([...new Set(JOURNEY.map((s) => s.tool))].sort(), MCP_TOOL_CATALOG.map(([s, n]) => `${s}.${n}`).sort());
  const { report, events, prepared } = await journey(t);
  assert.equal(report.status, "completed", JSON.stringify(report.error));
  assert.equal(report.outcome, "completed", JSON.stringify(report.turns.filter((t) => t.status !== "completed")));
  assert.equal(report.turns.length, 22);
  assert.equal(report.renderedSequences.length, 44);
  assert.equal(report.coverage.successfulTools, 16);
  assert.equal(report.coverage.calledMcp, 5);
  assert.equal(report.coverage.completedTurns, 22);
  assert.ok(events.every((e) => e.runId === prepared.runId && e.sessionId === prepared.sessionId && e.residentId === verified.seniorId));
  const get = (id) => report.turns.find((s) => s.id === id);
  assert.equal(get("identity").result.data.candidates[0].seniorId, verified.seniorId);
  assert.equal(get("service-detail").arguments.serviceId, get("services").result.data.items[0].serviceId);
  for (const field of ["serviceId", "name", "location", "schedule", "bookingRequired"]) assert.equal(get("service-detail").result.data[field], get("services").result.data.items[0][field]);
  assert.ok(report.turns.every((s) => !/undefined|NaN/.test(s.answer)));
  for (const id of ["activities", "recharge", "consumption", "history"]) assert.equal(get(`${id}-next`).arguments.cursor, get(id).result.data.nextCursor);
  assert.deepEqual(get("save").arguments.riskAssessmentDraft.evidence, get("history").result.data.evidence.map((i) => i.evidenceId));
  assert.equal(get("save-replay").result.data.resultId, get("save").result.data.resultId);
  assert.equal(get("save-replay").result.data.replayed, true);
  assert.ok(report.turns.every((s) => s.result.sessionId === prepared.sessionId));
  assert.doesNotThrow(() => JSON.stringify(report));
  assert.ok(JSON.stringify(report).length < 2_000_000);
});

for (const permission of ["anonymous", "auth-required", "expired", "scope-limited", "cross-subject"]) test(`full journey respects ${permission} and still renders all turns`, async (t) => {
  const r = residents.find((r) => r.permissionState === permission);
  const { report } = await journey(t, r);
  assert.equal(report.outcome, "journey_partial");
  assert.equal(report.renderedSequences.length, 44);
  assert.ok(report.coverage.blockedTurns > 0);
  assert.ok(report.coverage.successfulTools < 16);
  assert.ok(!report.events.some((e) => e.type === "tool-start" && (e.payload.tool.startsWith("member_asset") || e.payload.tool.startsWith("health_risk"))));
  assert.equal(report.turns.find((s) => s.id === "save").status, "skipped");
});

test("missing health evidence skips save and dependent pagination without invented records", async (t) => {
  const r = residents.find((r) => r.permissionState === "verified-self" && r.healthState === "no-record");
  const { report } = await journey(t, r);
  assert.equal(report.coverage.successfulTools, 15);
  assert.equal(report.turns.find((s) => s.id === "history").result.data.total, 0);
  assert.equal(report.turns.find((s) => s.id === "save").result.reason, "NO_HEALTH_EVIDENCE");
});

test("tool error is recorded, dependent step skipped, independent scenarios continue", async (t) => {
  const { report } = await journey(t, verified, { fixtureFactory: ({ dataset }) => { const fixture = createVirtualSeniorFixtureMcp({ dataset }); fixture.configure({ health_evaluation_service_mcp_cms: { missingTool: "list_station_services_brief" } }); return fixture; } });
  assert.equal(report.outcome, "partial_failure");
  assert.equal(report.turns.find((s) => s.id === "services").status, "failed");
  assert.equal(report.turns.find((s) => s.id === "service-detail").status, "skipped");
  assert.equal(report.turns.at(-1).status, "completed");
  assert.equal(report.coverage.successfulTools, 14);
});

test("cancel during inter-turn observation wakes immediately and no next question leaks", async (t) => {
  let cancelAt;
  const { report } = await journey(t, verified, { turnDelayMs: 10000, observe(e, service) {
    if (e.type === "stage" && e.payload.label.includes("稍后")) queueMicrotask(() => { cancelAt = Date.now(); void service.cancel(1, e.runId); });
  } });
  assert.equal(report.status, "cancelled");
  assert.equal(report.turns.length, 1);
  assert.equal(report.renderedSequences.length, 2);
  assert.ok(Date.now() - cancelAt < 2000);
});
