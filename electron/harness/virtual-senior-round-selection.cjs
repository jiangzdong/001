"use strict";

const { JOURNEY } = require("./virtual-senior-live-journey.cjs");
const invalid = () => Object.assign(new Error("请选择 1 至 22 个有效轮次；不能空选、重复或提交未知项目。"), { code: "INVALID_ROUND_SELECTION" });

function selectJourneyRounds(selectedRoundIds) {
  const ids = selectedRoundIds === undefined ? JOURNEY.map((step) => step.id) : selectedRoundIds;
  const catalog = new Map(JOURNEY.map((step) => [step.id, step]));
  if (!Array.isArray(ids) || !ids.length || ids.length > JOURNEY.length || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !catalog.has(id))) throw invalid();
  const selected = new Set(ids);
  const required = new Set(ids);
  const include = (id) => {
    const dependency = catalog.get(id).dependsOn;
    if (dependency && !required.has(dependency)) { required.add(dependency); include(dependency); }
  };
  ids.forEach(include);
  // Always use canonical conversation order, never renderer order. A next-page
  // or save replay cannot manufacture a previous cursor, evidence, or result.
  const rounds = JOURNEY.filter((step) => required.has(step.id)).map((step) => ({ ...step, selectionReason: selected.has(step.id) ? "selected" : "prerequisite" }));
  return {
    selectionVersion: "journey-selection-v1",
    selectedRoundIds: JOURNEY.filter((step) => selected.has(step.id)).map((step) => step.id),
    prerequisiteRoundIds: rounds.filter((step) => !selected.has(step.id)).map((step) => step.id),
    rounds,
    selectedCount: selected.size,
    executionCount: rounds.length,
    speechRequired: true,
  };
}

module.exports = { selectJourneyRounds };
