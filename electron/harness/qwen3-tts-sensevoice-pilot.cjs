"use strict";

// Shared, deliberately strict accounting for the isolated Qwen3-TTS to
// product-SenseVoice pilot.  This does not make Qwen3 a product dependency.
const { JOURNEY } = require("./virtual-senior-live-journey.cjs");

const PILOT_THRESHOLDS = Object.freeze({
  batches: 3,
  allCasePassRate: 0.98,
  perRoundPassRate: 0.95,
  criticalPassRate: 1,
});

const CRITICAL_DOMAINS = Object.freeze({
  identity: ["identity"],
  authorization: ["permission"],
  save: ["save", "save-replay"],
});

function assertEvidence(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: "QWEN_PILOT_EVIDENCE_INVALID" });
}

function validatePilotBatches(batches) {
  assertEvidence(Array.isArray(batches) && batches.length === PILOT_THRESHOLDS.batches, `pilot must retain exactly ${PILOT_THRESHOLDS.batches} batches`);
  const expectedRounds = new Set(JOURNEY.map((step) => step.id));
  const ids = new Set();
  for (const batch of batches) {
    assertEvidence(typeof batch?.batchId === "string" && batch.batchId && !ids.has(batch.batchId), "batch id missing or duplicated");
    ids.add(batch.batchId);
    assertEvidence(Array.isArray(batch.cases) && batch.cases.length === JOURNEY.length, `${batch.batchId}: must retain all ${JOURNEY.length} rounds`);
    const actualRounds = new Set();
    for (const row of batch.cases) {
      assertEvidence(expectedRounds.has(row?.roundId) && !actualRounds.has(row.roundId), `${batch.batchId}: missing, unknown, or duplicate round`);
      actualRounds.add(row.roundId);
      // A rejected synthesis (for example max tokens before EOS) has no
      // publishable WAV by design. It is still retained as a failed attempted
      // round, not mistaken for malformed evidence or silently removed.
      if (row.asrStatus === "passed") {
        assertEvidence(typeof row.source24kSha256 === "string" && /^[a-f0-9]{64}$/.test(row.source24kSha256), `${batch.batchId}/${row.roundId}: missing source audio hash`);
        assertEvidence(typeof row.converted16kSha256 === "string" && /^[a-f0-9]{64}$/.test(row.converted16kSha256), `${batch.batchId}/${row.roundId}: missing converted audio hash`);
        assertEvidence(typeof row.pcm16leSha256 === "string" && /^[a-f0-9]{64}$/.test(row.pcm16leSha256), `${batch.batchId}/${row.roundId}: missing PCM hash`);
        assertEvidence(row.metrics?.termination_reason === "eos", `${batch.batchId}/${row.roundId}: non-EOS TTS cannot pass`);
        assertEvidence(row.provider === "sherpa-onnx-sensevoice-local", `${batch.batchId}/${row.roundId}: product SenseVoice provider unverified`);
      } else {
        assertEvidence(typeof row.error === "string" && row.error, `${batch.batchId}/${row.roundId}: failed round must retain its error`);
      }
      assertEvidence(row.criticalTerms?.oracle, `${batch.batchId}/${row.roundId}: strict oracle evidence missing`);
    }
    assertEvidence(actualRounds.size === expectedRounds.size, `${batch.batchId}: incomplete round set`);
  }
  return true;
}

function summarizePilot(batches) {
  validatePilotBatches(batches);
  const rows = batches.flatMap((batch) => batch.cases.map((row) => ({ ...row, batchId: batch.batchId })));
  const passed = (row) => row.asrStatus === "passed" && row.criticalTerms?.valid === true;
  const perRound = Object.fromEntries(JOURNEY.map((step) => {
    const values = rows.filter((row) => row.roundId === step.id);
    const count = values.filter(passed).length;
    return [step.id, { passed: count, total: values.length, passRate: values.length ? count / values.length : 0 }];
  }));
  const criticalDomains = Object.fromEntries(Object.entries(CRITICAL_DOMAINS).map(([domain, ids]) => {
    const values = rows.filter((row) => ids.includes(row.roundId));
    const count = values.filter(passed).length;
    return [domain, { passed: count, total: values.length, passRate: values.length ? count / values.length : 0 }];
  }));
  const passedCases = rows.filter(passed).length;
  const allCasePassRate = rows.length ? passedCases / rows.length : 0;
  const failures = rows.filter((row) => !passed(row)).map((row) => ({ batchId: row.batchId, roundId: row.roundId, transcript: row.transcript, cer: row.cer, missingTerms: row.criticalTerms?.missing || [], error: row.error || null }));
  const gatePassed = allCasePassRate >= PILOT_THRESHOLDS.allCasePassRate
    && Object.values(perRound).every((row) => row.passRate >= PILOT_THRESHOLDS.perRoundPassRate)
    && Object.values(criticalDomains).every((row) => row.passRate === PILOT_THRESHOLDS.criticalPassRate);
  return {
    thresholds: PILOT_THRESHOLDS,
    batches: batches.length,
    totalCases: rows.length,
    passedCases,
    allCasePassRate,
    perRound,
    criticalDomains,
    failures,
    gate: gatePassed ? "passed" : "failed",
    eligibleForThirtyBatchStabilityRun: gatePassed,
  };
}

module.exports = { PILOT_THRESHOLDS, CRITICAL_DOMAINS, validatePilotBatches, summarizePilot };
