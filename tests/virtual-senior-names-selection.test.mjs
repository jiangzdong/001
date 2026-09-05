import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCommunityDataset, entityRecord } = require("../electron/harness/virtual-senior-community-dataset.cjs");
const { createVirtualSeniorResidentSelection } = require("../electron/harness/virtual-senior-resident-selection.cjs");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");
const { selectJourneyRounds } = require("../electron/harness/virtual-senior-round-selection.cjs");
const { createVirtualSeniorLiveSession } = require("../electron/harness/virtual-senior-live-session.cjs");

test("all 10,000 residents have stable synthetic Chinese names, same across export/profile/context/search", () => {
  const a = createCommunityDataset(), b = createCommunityDataset();
  const selector = createVirtualSeniorResidentSelection({ dataset: a });
  const names = new Set(), ids = new Set();
  for (let index = 0; index < a.residents; index++) {
    const r = a.residentAt(index);
    assert.match(r.displayName, /^[\u4e00-\u9fff]{3}$/);
    assert.equal(r.displayName, b.residentAt(index).displayName);
    assert.equal(r.nameSource, "synthetic-generator");
    assert.equal(entityRecord(a, "residents", index).displayName, r.displayName);
    names.add(r.displayName); ids.add(r.seniorId);
  }
  assert.equal(ids.size, 10000);
  assert.ok(names.size > 4000, `name diversity: ${names.size}`);
  const r = a.residentAt(230), detail = selector.detail({ residentId: r.seniorId });
  assert.equal(detail.resident.displayName, r.displayName);
  assert.equal(detail.binding.displayName, r.displayName);
  assert.equal(detail.health.profile.profile.displayName, r.displayName);
  assert.equal(detail.health.riskContext.profile.displayName, r.displayName);
  assert.ok(selector.search({ query: r.displayName }).items.some((item) => item.seniorId === r.seniorId));
  // A label is not identity. Untrusted names never override the canonical label.
  assert.equal(selector.resolveBinding({ binding: { ...detail.binding, displayName: "伪造名" } }).displayName, r.displayName);
  assert.equal(r.seniorId, 672900230);
  assert.equal(r.permissionState, "verified-self");
  assert.equal(r.healthState, "routine");
});

test("all, single and multi selections use canonical order and explicit prerequisite closure", () => {
  const all = selectJourneyRounds();
  assert.equal(all.rounds.length, 22);
  assert.deepEqual(all.selectedRoundIds, JOURNEY.map((step) => step.id));
  assert.deepEqual(all.prerequisiteRoundIds, []);
  assert.equal(all.speechRequired, true);
  assert.deepEqual(selectJourneyRounds(["vitals"]).rounds.map((s) => s.id), ["vitals"]);
  const multi = selectJourneyRounds(["save-replay", "service-detail", "points"]);
  assert.deepEqual(multi.selectedRoundIds, ["service-detail", "points", "save-replay"]);
  assert.deepEqual(multi.prerequisiteRoundIds, ["services", "history", "save"]);
  assert.equal(multi.executionCount, 6);
  assert.equal(multi.selectedCount, 3);
  assert.deepEqual(multi.rounds.map((s) => s.selectionReason), ["prerequisite", "selected", "selected", "prerequisite", "prerequisite", "selected"]);
});

test("empty, duplicate, unknown, oversized and non-array selections fail closed", () => {
  for (const value of [null, [], {}, "all", ["wrong"], ["vitals", "vitals"], [1], Array(23).fill("vitals")]) assert.throws(() => selectJourneyRounds(value), { code: "INVALID_ROUND_SELECTION" });
});

test("selected execution and report retry preserve resident/rounds, use new run/session and reject client overrides", async (t) => {
  const dataset = createCommunityDataset();
  const pending = [];
  const service = createVirtualSeniorLiveSession({ dataset, turnDelayMs: 0, onEvent(owner, event) {
    if (["question", "answer"].includes(event.type)) queueMicrotask(() => service.acknowledge(owner, event));
    if (["completed", "failed", "cancelled"].includes(event.type)) pending.shift()?.(event.payload.report);
  } });
  t.after(() => service.close());
  const binding = service.detail({ residentId: dataset.residentAt(230).seniorId }).binding;
  const initial = service.prepare(1, { binding, selectedRoundIds: ["save-replay"] });
  const execute = async (prepared) => { const completed = new Promise((resolve) => pending.push(resolve)); service.begin(1, prepared.runId); return completed; };
  const first = await execute(initial);
  assert.equal(first.outcome, "completed");
  assert.equal(first.acceptance.status, "blocked");
  assert.equal(first.acceptance.speechRequired, true);
  assert.deepEqual(first.turns.map((step) => step.id), ["history", "save", "save-replay"]);
  assert.equal(first.coverage.totalTurns, 3);
  const snapshot = JSON.stringify(first);
  await assert.rejects(service.prepareRetry(1, { reportId: first.runId, actor: {} }), { code: "INVALID_RETRY_REQUEST" });
  await assert.rejects(service.prepareRetry(1, { reportId: "../../escape" }), { code: "INVALID_RETRY_REQUEST" });
  const retry = await service.prepareRetry(1, { reportId: first.runId });
  assert.notEqual(retry.runId, first.runId);
  assert.notEqual(retry.sessionId, first.sessionId);
  assert.equal(retry.binding.residentId, first.residentId);
  assert.deepEqual(retry.selection, first.selection);
  const second = await execute(retry);
  assert.equal(second.outcome, "completed");
  assert.equal(second.retryOf, first.runId);
  assert.notEqual(second.turns[1].arguments.idempotencyKey, first.turns[1].arguments.idempotencyKey);
  assert.equal(JSON.stringify((await service.reports()).find((r) => r.runId === first.runId)), snapshot);
});
