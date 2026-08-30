import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareVisemeTimelines, createMfaVisemeTimeline, parseMfaPhoneIntervals } = require("../scripts/lib/mfa-viseme-audit.cjs");

const fixture = {
  xmin: 0,
  xmax: 0.72,
  tiers: [
    { name: "words", entries: [[0, 0.72, "发知"]] },
    { name: "phones", entries: [[0, 0.08, ""], [0.08, 0.16, "f"], [0.16, 0.38, "a˥"], [0.38, 0.48, "ʈʂ"], [0.48, 0.68, "ʐ̩˥"], [0.68, 0.72, ""]] },
  ],
};

test("MFA JSON phone tier becomes the kiosk viseme set", () => {
  assert.equal(parseMfaPhoneIntervals(fixture).length, 6);
  const timeline = createMfaVisemeTimeline(fixture);
  assert.deepEqual(timeline.map((event) => event.shape), ["CLOSED", "F", "A", "SH", "E", "CLOSED"]);
  assert.deepEqual(timeline.map((event) => event.timeMs), [0, 80, 160, 380, 480, 680]);
});

test("MFA calibration gate reports coverage and timing drift", () => {
  const reference = createMfaVisemeTimeline(fixture);
  const comparison = compareVisemeTimelines(reference, {
    visemes: [
      { timeMs: 70, shape: "F" },
      { timeMs: 170, shape: "A" },
      { timeMs: 410, shape: "SH" },
      { timeMs: 520, shape: "E" },
    ],
  });
  assert.equal(comparison.pass, true);
  assert.equal(comparison.metrics.coverage, 1);
  assert.ok(comparison.metrics.p95DriftMs <= 40);
});
