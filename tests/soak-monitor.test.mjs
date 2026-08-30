import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { evaluateSoakReport, parseSoakDuration } = require("../electron/soak-monitor.cjs");

test("soak duration accepts seconds and minutes with a bounded maximum", () => {
  assert.equal(parseSoakDuration(["--soak-test-seconds=5"]), 5000);
  assert.equal(parseSoakDuration(["--soak-test-minutes=2"]), 120000);
  assert.equal(parseSoakDuration(["--soak-test-minutes=bad"]), 0);
  assert.equal(parseSoakDuration(["--soak-test-seconds=999999"]), 86400000);
});

test("soak report separates runtime stability from the physical display gate", () => {
  const base = {
    version: "1.3.0", packaged: true, durationMs: 60000,
    startedAt: "2026-08-28T00:00:00.000Z", finishedAt: "2026-08-28T00:01:00.000Z",
    samples: [{ totalWorkingSetKb: 1024 }, { totalWorkingSetKb: 2048 }],
    events: { rendererGone: 0, unresponsive: 0, loadError: 0 }, speechReady: true,
  };
  const target = evaluateSoakReport({ ...base, display: { bounds: { width: 1200, height: 1920 }, rotation: 90 } });
  assert.equal(target.ok, true);
  assert.equal(target.expectedKioskViewport.contentRotation, 0);
  assert.deepEqual(target.gates, { runtimeStable: true, displayMatched: true, speechReady: true });
  assert.equal(target.memory.maxWorkingSetKb, 2048);

  const development = evaluateSoakReport({ ...base, display: { bounds: { width: 1920, height: 1080 }, rotation: 0 } });
  assert.equal(development.ok, false);
  assert.equal(development.gates.runtimeStable, true);
  assert.equal(development.gates.displayMatched, false);
});
