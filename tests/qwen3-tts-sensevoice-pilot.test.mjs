import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { summarizePilot, validatePilotBatches } = require("../electron/harness/qwen3-tts-sensevoice-pilot.cjs");
const { splitQuestionAtExistingPunctuation, summarizeCandidate } = require("../electron/harness/qwen3-tts-sensevoice-candidate.cjs");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");
const hash = "a".repeat(64);

function batch(id, mutate = () => {}) {
  const value = { batchId: id, cases: JOURNEY.map((step) => ({ roundId: step.id, source24kSha256: hash, converted16kSha256: hash, pcm16leSha256: hash, metrics: { termination_reason: "eos" }, provider: "sherpa-onnx-sensevoice-local", asrStatus: "passed", criticalTerms: { valid: true, oracle: "fixed-question-critical-terms-v1", missing: [] } })) };
  mutate(value); return value;
}

test("Qwen pilot rejects incomplete, duplicate, or non-EOS batch evidence", () => {
  assert.throws(() => validatePilotBatches([batch("a"), batch("b"), batch("c", (item) => item.cases.pop())]), /all 22 rounds|incomplete/);
  assert.throws(() => validatePilotBatches([batch("a"), batch("a"), batch("c")]), /duplicated/);
  assert.throws(() => validatePilotBatches([batch("a"), batch("b"), batch("c", (item) => { item.cases[0].metrics.termination_reason = "max_tokens_reached"; })]), /non-EOS/);
});

test("Qwen pilot does not permit the 30-batch phase if one strict business round fails", () => {
  const result = summarizePilot([batch("a"), batch("b"), batch("c", (item) => { const row = item.cases.find((entry) => entry.roundId === "identity"); row.asrStatus = "failed"; row.error = "strict oracle missing 合成授权"; row.criticalTerms = { valid: false, oracle: "fixed-question-critical-terms-v1", missing: ["合成授权"] }; })]);
  assert.equal(result.gate, "failed");
  assert.equal(result.eligibleForThirtyBatchStabilityRun, false);
  assert.equal(result.criticalDomains.identity.passRate, 2 / 3);
});

test("segmentation candidate preserves the exact question and rejects any non-EOS or oracle failure", () => {
  assert.deepEqual(splitQuestionAtExistingPunctuation("还有哪些消费？接着上一页往后看。"), ["还有哪些消费？", "接着上一页往后看。"]);
  assert.throws(() => splitQuestionAtExistingPunctuation(" 还有哪些消费？"), /changed/);
  const attempts = Array.from({ length: 10 }, (_, index) => ({ attemptId: `attempt-${index}`, status: "passed", allSegmentsEos: true, criticalTerms: { valid: true }, segments: Array.from({ length: 2 }, () => ({ metrics: { termination_reason: "eos" }, source24kSha256: hash })) }));
  assert.equal(summarizeCandidate(attempts).eligibleForFullPilot, true);
  attempts[9].status = "failed"; attempts[9].criticalTerms.valid = false;
  assert.equal(summarizeCandidate(attempts).eligibleForFullPilot, false);
});
