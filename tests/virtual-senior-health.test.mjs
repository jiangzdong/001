import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCommunityDataset, entityRecord, residentGlobalIndex } = require("../electron/harness/virtual-senior-community-dataset.cjs");
const dataset = createCommunityDataset({ profile: "regression" });
const residents = Array.from({ length: dataset.residents }, (_, index) => dataset.residentAt(index));
const call = (resident, tool, args = {}) => dataset.toolResponse(`health_risk_assessment_mcp.${tool}`, { seniorId: resident.seniorId, ...args });

test("all 1000 residents have consistent health absence and eight-metric coverage", () => {
  const values = new Set();
  for (const resident of residents) {
    const labels = call(resident, "get_latest_health_labels");
    const context = call(resident, "get_risk_assessment_context");
    if (resident.healthState === "no-record") {
      assert.equal(labels.vitalSigns.length, 0);
      assert.equal(context.indicatorSummary.evidenceCount, 0);
      assert.equal(entityRecord(dataset, "indicatorEvidence", resident.residentIndex).value, null);
    } else {
      assert.equal(new Set(labels.vitalSigns.map((item) => item.metric)).size, 8);
      values.add(labels.vitalSigns[0].value);
      for (const item of labels.vitalSigns) assert.equal(item.seniorId, resident.seniorId);
    }
  }
  assert.ok(values.size > 30, "values vary between residents");
});

test("time window, metric filter and stable pagination use exact exported evidence", () => {
  const resident = residents.find((item) => item.healthState === "routine" && item.dataQuality === "complete");
  const day = call(resident, "get_indicator_evidence", { timeType: 1 });
  const sixMonths = call(resident, "get_indicator_evidence", { timeType: 180, limit: 13 });
  assert.equal(day.total, 8);
  assert.equal(sixMonths.total, 120);
  let cursor = null;
  const seen = new Set();
  do {
    const page = call(resident, "get_indicator_evidence", { timeType: 180, limit: 13, cursor });
    for (const item of page.evidence) {
      assert.ok(!seen.has(item.evidenceId)); seen.add(item.evidenceId);
      const ordinal = Number(item.evidenceId.split("-").at(-1));
      assert.deepEqual(item, entityRecord(dataset, "indicatorEvidence", residentGlobalIndex(dataset, resident, ordinal)));
      assert.equal(Object.hasOwn(item, "currency"), false);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 120);
  const filtered = call(resident, "get_indicator_evidence", { timeType: 180, signsTypeList: [3] });
  assert.equal(filtered.total, 15);
  assert.ok(filtered.evidence.every((item) => item.metric === "heart_rate"));
  assert.ok(call(resident, "get_indicator_evidence", { timeType: 0 }).error);
  assert.ok(call(resident, "get_indicator_evidence", { signsTypeList: [99] }).error);
});

test("stale and insufficient residents do not manufacture recent complete history", () => {
  for (const resident of residents.filter((item) => item.healthState === "stale")) assert.equal(call(resident, "get_indicator_evidence", { timeType: 180 }).total, 0);
  for (const resident of residents.filter((item) => item.healthState === "insufficient")) assert.equal(call(resident, "get_risk_assessment_context").indicatorSummary.evidenceCount, 8);
});
