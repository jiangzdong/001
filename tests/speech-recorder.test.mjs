import assert from "node:assert/strict";
import test from "node:test";
import { computeRms, createAdaptiveVad, createPreviewSamples } from "../src/speechRecorder.js";

test("adaptive VAD separates a quiet room from speech energy", () => {
  const vad = createAdaptiveVad({ calibrationFrames: 3 });
  for (let index = 0; index < 3; index += 1) assert.equal(vad.observe(new Float32Array(128).fill(0.001)).speech, false);
  assert.equal(vad.observe(new Float32Array(128).fill(0.04)).speech, false);
  const voice = vad.observe(new Float32Array(128).fill(0.04));
  assert.equal(voice.speech, true);
  assert.ok(voice.threshold >= 0.00045);
});

test("adaptive VAD detects sustained far-field speech above the measured Realtek baseline", () => {
  const vad = createAdaptiveVad();
  for (let index = 0; index < 4; index += 1) assert.equal(vad.observe(new Float32Array(128).fill(0.0001)).speech, false);
  assert.equal(vad.observe(new Float32Array(128).fill(0.0008)).speech, false);
  const speech = vad.observe(new Float32Array(128).fill(0.0008));
  assert.equal(speech.speech, true);
  assert.ok(speech.threshold < 0.001);
});

test("adaptive VAD ignores a single transient click", () => {
  const vad = createAdaptiveVad();
  for (let index = 0; index < 4; index += 1) vad.observe(new Float32Array(128).fill(0.0001));
  assert.equal(vad.observe(new Float32Array(128).fill(0.01)).speech, false);
  assert.equal(vad.observe(new Float32Array(128).fill(0.0001)).speech, false);
});

test("RMS calculation is deterministic", () => {
  assert.equal(computeRms(new Float32Array([1, -1])), 1);
  assert.equal(computeRms(new Float32Array()), 0);
});

test("preview samples keep only the newest bounded audio and resample to 16 kHz", () => {
  const chunks = [new Float32Array(8000).fill(0.1), new Float32Array(8000).fill(0.2), new Float32Array(8000).fill(0.3)];
  const preview = createPreviewSamples(chunks, 8000, { maxDurationMs: 2000 });
  assert.equal(preview.length, 32000);
  assert.ok(Math.abs(preview[0] - 0.2) < 0.0001);
  assert.ok(Math.abs(preview.at(-1) - 0.3) < 0.0001);
});
