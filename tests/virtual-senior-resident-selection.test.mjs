import assert from "node:assert/strict";
import test from "node:test";
import communityModule from "../electron/harness/virtual-senior-community-dataset.cjs";
import selectionModule from "../electron/harness/virtual-senior-resident-selection.cjs";

const { createCommunityDataset } = communityModule;
const { ResidentSelectionError, createVirtualSeniorResidentSelection } = selectionModule;

function selection() {
  return createVirtualSeniorResidentSelection({ dataset: createCommunityDataset({ profile: "regression", seed: 104729 }) });
}

test("resident selection searches deterministic display codes and senior IDs with stable cohort pagination", () => {
  const service = selection();
  const dataset = createCommunityDataset({ profile: "regression", seed: 104729 });
  const target = dataset.residentAt(42);
  const byDisplay = service.search({ query: target.displayCode, limit: 1 });
  const byId = service.search({ query: target.seniorId, limit: 1 });
  assert.equal(byDisplay.total, 1);
  assert.equal(byDisplay.items[0].seniorId, target.seniorId);
  assert.equal(byId.items[0].displayCode, target.displayCode);
  assert.equal(byDisplay.items[0].synthetic, true);
  assert.equal(byDisplay.items[0].dataClassification, "synthetic-test-only");

  const broad = service.search({ cohort: { age: target.ageBand }, limit: 2 });
  const next = service.search({ cohort: { age: target.ageBand }, cursor: broad.nextCursor, limit: 2 });
  assert.ok(broad.total > 2);
  assert.equal(broad.items.length, 2);
  assert.equal(next.items.length, 2);
  assert.notEqual(broad.items[0].seniorId, next.items[0].seniorId);
  assert.ok(broad.items.every((item) => item.profile.ageBand === target.ageBand));
});

test("resident detail reads existing synthetic health records without creating health values", () => {
  const service = selection();
  const target = createCommunityDataset({ profile: "regression", seed: 104729 }).residentAt(9);
  const detail = service.detail({ seniorId: target.seniorId });
  assert.equal(detail.synthetic, true);
  assert.equal(detail.dataClassification, "synthetic-test-only");
  assert.equal(detail.resident.seniorId, target.seniorId);
  assert.equal(detail.resident.health.state, target.healthState);
  assert.equal(detail.health.profile.seniorId, target.seniorId);
  assert.equal(detail.health.riskContext.seniorId, target.seniorId);
  assert.equal(detail.health.labels.seniorId, target.seniorId);
  assert.equal(detail.health.evaluations.seniorId, target.seniorId);
  assert.ok(Array.isArray(detail.health.labels.vitalSigns));
  assert.ok(Array.isArray(detail.health.evaluations.results));
  assert.equal(detail.health.sourceQuality.status, "limited-fixture-preview");
  assert.ok(detail.health.sourceQuality.notAcceptedFor.includes("complete-health-record"));
});

test("resident binding is immutable and correlates the exact community dataset resident", () => {
  const service = selection();
  const target = createCommunityDataset({ profile: "regression", seed: 104729 }).residentAt(76);
  const binding = service.bind({ residentId: target.seniorId });
  assert.equal(binding.residentId, target.seniorId);
  assert.equal(binding.seniorId, target.seniorId);
  assert.equal(binding.profile, "regression");
  assert.equal(binding.seed, 104729);
  assert.match(binding.manifestHash, /^sha256:/);
  assert.equal(Object.isFrozen(binding), true);
  assert.throws(() => { binding.residentId = 1; }, TypeError);
  assert.equal(service.resolveBinding({ binding }).manifestHash, binding.manifestHash);
});

test("selection rejects unknown residents, malformed pagination, forged bindings and client actor overrides", () => {
  const service = selection();
  const target = createCommunityDataset({ profile: "regression", seed: 104729 }).residentAt(3);
  const binding = service.bind({ seniorId: target.seniorId });
  const expectCode = (callback, code) => assert.throws(callback, (error) => error instanceof ResidentSelectionError && error.code === code);
  expectCode(() => service.detail({ seniorId: "not-a-synthetic-resident" }), "RESIDENT_NOT_FOUND");
  expectCode(() => service.search({ cursor: "-1" }), "INVALID_CURSOR");
  expectCode(() => service.search({ cohort: { unexpected: "value" } }), "INVALID_COHORT");
  expectCode(() => service.bind({ seniorId: target.seniorId, actor: { authLevel: "verified" } }), "CLIENT_ACTOR_FORBIDDEN");
  expectCode(() => service.resolveBinding({ binding: { ...binding, manifestHash: "sha256:forged" } }), "BINDING_MISMATCH");
  expectCode(() => service.resolveBinding({ binding, scopes: ["member:read:self"] }), "CLIENT_ACTOR_FORBIDDEN");
  expectCode(() => service.resolveBinding({ binding: { ...binding, actor: { authLevel: "verified" } } }), "CLIENT_ACTOR_FORBIDDEN");
});
