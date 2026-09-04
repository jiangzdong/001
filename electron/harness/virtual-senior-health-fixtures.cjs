"use strict";

// Fixture-only metric IDs; these are NOT the as-yet-unconfirmed production
// signsTypeList enum. Values are test inputs, not clinical interpretations.
const METRICS = Object.freeze([
  ["systolic_bp", "收缩压", "mmHg", 105, 55, 0],
  ["diastolic_bp", "舒张压", "mmHg", 62, 35, 0],
  ["heart_rate", "心率", "bpm", 58, 43, 0],
  ["blood_glucose", "血糖", "mmol/L", 4, 5, 1],
  ["spo2", "血氧", "%", 92, 8, 0],
  ["temperature", "体温", "°C", 36, 2, 1],
  ["weight", "体重", "kg", 42, 45, 1],
  ["steps", "步数", "steps", 200, 7800, 0],
]);
const DAY = 86400000;

function healthFields(dataset, resident, entity, ordinal) {
  const offset = ordinal - 1;
  const available = resident.healthState !== "no-record" && !(resident.healthState === "insufficient" && ordinal > 8);
  const stale = resident.healthState === "stale" || resident.dataQuality === "stale";
  const observedAt = new Date(Date.parse(dataset.generatedAt) - (stale ? 210 : 0) * DAY - Math.floor(offset / 8) * 12 * DAY).toISOString();
  const quality = resident.healthState === "conflicting" ? "conflicting" : resident.dataQuality;
  const common = { available, quality, observedAt, absenceReason: available ? null : resident.healthState };
  if (entity === "indicatorEvidence") {
    const [metric, displayName, unit, minimum, span, decimals] = METRICS[offset % METRICS.length];
    const variation = ((resident.residentIndex * 37 + offset * 17 + dataset.seed) % 997) / 997;
    return { ...common, evidenceId: `evidence-${resident.seniorId}-${ordinal}`, metric, displayName, signsType: offset % METRICS.length + 1,
      value: available ? (minimum + variation * span).toFixed(decimals) : null, unit, source: "synthetic-device", timeWindow: "180d" };
  }
  if (entity === "healthLabels") return { ...common, labelId: `label-${resident.seniorId}-${ordinal}`, labelType: ["blood-pressure", "mobility", "sleep", "nutrition"][offset % 4], level: !available ? "unavailable" : resident.healthState.includes("attention") ? "attention" : "routine", sourceSystem: "synthetic-health" };
  if (entity === "healthEvaluations") return { ...common, evaluationId: `eval-${resident.seniorId}-${ordinal}`, evaluationType: ["functional", "nutrition", "fall-risk", "cognition"][offset % 4], status: !available ? "unavailable" : quality === "partial" && ordinal === 4 ? "incomplete" : "completed", score: available ? 60 + ((resident.residentIndex + offset * 7) % 41) : null, evaluatedAt: observedAt };
  if (entity === "riskAssessments") return { ...common, assessmentId: `risk-${resident.seniorId}-${ordinal}`, level: !available ? "unavailable" : resident.healthState.includes("attention") ? "attention" : "routine", evidenceIds: available ? [`evidence-${resident.seniorId}-${ordinal}`] : [], idempotencyKey: `seed-${dataset.seed}-${resident.seniorId}-${ordinal}`, createdAt: observedAt };
  return null;
}

module.exports = { healthFields, METRICS, DAY };
