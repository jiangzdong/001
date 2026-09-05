"use strict";

// Candidate-policy helpers. The policy is intentionally mechanical: it may
// split only at punctuation already present in the scripted question and must
// reconstruct byte-for-byte to avoid silently changing the business request.
function splitQuestionAtExistingPunctuation(question) {
  const source = String(question || "");
  const segments = source.match(/[^。！？!?]+[。！？!?]?/gu)?.map((item) => item.trim()).filter(Boolean) || [];
  if (!segments.length || segments.join("") !== source) throw new Error("QA segmentation changed the scripted question");
  return segments;
}

function summarizeCandidate(attempts) {
  if (!Array.isArray(attempts) || attempts.length !== 10) throw new Error("candidate requires exactly 10 retained attempts");
  const ids = new Set();
  for (const attempt of attempts) {
    if (!attempt?.attemptId || ids.has(attempt.attemptId)) throw new Error("candidate attempt id missing or duplicated");
    ids.add(attempt.attemptId);
    if (!Array.isArray(attempt.segments) || attempt.segments.length !== 2) throw new Error("candidate must retain both original-punctuation segments");
    for (const segment of attempt.segments) {
      if (segment?.metrics?.termination_reason !== "eos") continue;
      if (!/^[a-f0-9]{64}$/.test(segment.source24kSha256 || "")) throw new Error("EOS segment is missing retained source audio hash");
    }
  }
  const passed = attempts.filter((attempt) => attempt.status === "passed" && attempt.criticalTerms?.valid === true && attempt.allSegmentsEos === true).length;
  return { attempts: attempts.length, passed, passRate: passed / attempts.length, gate: passed === attempts.length ? "passed" : "failed", eligibleForFullPilot: passed === attempts.length };
}

module.exports = { splitQuestionAtExistingPunctuation, summarizeCandidate };
