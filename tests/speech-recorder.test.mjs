import assert from "node:assert/strict";
import test from "node:test";
import { computeRms, createAdaptiveVad, createPreviewSamples, recordSpeech } from "../src/speechRecorder.js";

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

function createAbortHarness() {
  const listeners = new Set();
  const metrics = { added: 0, removed: 0 };
  const signal = {
    aborted: false,
    addEventListener(type, listener) {
      if (type !== "abort") return;
      metrics.added += 1;
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type !== "abort") return;
      metrics.removed += 1;
      listeners.delete(listener);
    },
  };
  return {
    signal,
    metrics,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
    listenerCount() { return listeners.size; },
  };
}

function createMediaHarness({ state = "running", resume, failProcessorCreation = false } = {}) {
  const metrics = {
    closeCalls: 0,
    resumeCalls: 0,
    trackStops: [0, 0],
    disconnects: { processor: 0, sink: 0, source: 0 },
  };
  const tracks = metrics.trackStops.map((_, index) => ({ stop() { metrics.trackStops[index] += 1; } }));
  const stream = { getTracks: () => tracks };
  const makeNode = (name) => ({
    connect() {},
    disconnect() { metrics.disconnects[name] += 1; },
  });
  const source = makeNode("source");
  const processor = { ...makeNode("processor"), onaudioprocess: null };
  const sink = { ...makeNode("sink"), gain: { value: 1 } };
  class FakeAudioContext {
    constructor() {
      this.destination = {};
      this.sampleRate = 16000;
      this.state = state;
      metrics.context = this;
    }
    resume() {
      metrics.resumeCalls += 1;
      if (resume) return resume(this);
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      metrics.closeCalls += 1;
      this.state = "closed";
      return Promise.resolve();
    }
    createMediaStreamSource() { return source; }
    createScriptProcessor() {
      if (failProcessorCreation) throw new Error("processor creation failed");
      return processor;
    }
    createGain() { return sink; }
  }
  return { AudioContext: FakeAudioContext, metrics, processor, stream };
}

function installRecordingEnvironment(t, harness, AudioContextClass = harness.AudioContext) {
  replaceGlobal(t, "navigator", { mediaDevices: { getUserMedia: async () => harness.stream } });
  replaceGlobal(t, "window", { AudioContext: AudioContextClass });
}

function audioEvent(samples) {
  return { inputBuffer: { getChannelData: () => samples } };
}

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

test("automatic-listening VAD rejects a short startup noise burst", () => {
  const vad = createAdaptiveVad({ calibrationFrames: 8, activationFrames: 4, quietFramesBeforeActivation: 4 });
  for (let index = 0; index < 12; index += 1) assert.equal(vad.observe(new Float32Array(128).fill(0.02)).speech, false);
  for (let index = 0; index < 4; index += 1) assert.equal(vad.observe(new Float32Array(128).fill(0.0001)).speech, false);
  for (let index = 0; index < 3; index += 1) assert.equal(vad.observe(new Float32Array(128).fill(0.02)).speech, false);
  assert.equal(vad.observe(new Float32Array(128).fill(0.02)).speech, true);
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

test("recording stops every track when AudioContext construction fails", async (t) => {
  const harness = createMediaHarness();
  const abort = createAbortHarness();
  class BrokenAudioContext {
    constructor() { throw new Error("context creation failed"); }
  }
  installRecordingEnvironment(t, harness, BrokenAudioContext);

  await assert.rejects(recordSpeech({ signal: abort.signal }), /context creation failed/);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
  assert.equal(abort.metrics.removed, 1);
});

test("recording closes the context and tracks when resume rejects", async (t) => {
  const harness = createMediaHarness({ state: "suspended", resume: () => Promise.reject(new Error("resume failed")) });
  const abort = createAbortHarness();
  installRecordingEnvironment(t, harness);

  await assert.rejects(recordSpeech({ signal: abort.signal }), /resume failed/);
  assert.equal(harness.metrics.resumeCalls, 1);
  assert.equal(harness.metrics.closeCalls, 1);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
});

test("abort releases a microphone while AudioContext resume is still pending", async (t) => {
  const harness = createMediaHarness({ state: "suspended", resume: () => new Promise(() => {}) });
  const abort = createAbortHarness();
  installRecordingEnvironment(t, harness);

  const pending = recordSpeech({ signal: abort.signal });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.metrics.resumeCalls, 1);
  abort.abort();
  const result = await pending;

  assert.equal(result.heardSpeech, false);
  assert.equal(result.samples.length, 0);
  assert.equal(harness.metrics.closeCalls, 1);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
});

test("partial audio-node initialization is cleaned after a setup error", async (t) => {
  const harness = createMediaHarness({ failProcessorCreation: true });
  const abort = createAbortHarness();
  installRecordingEnvironment(t, harness);

  await assert.rejects(recordSpeech({ signal: abort.signal }), /processor creation failed/);
  assert.equal(harness.metrics.disconnects.source, 1);
  assert.equal(harness.metrics.closeCalls, 1);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
});

test("an audio callback exception rejects only after every resource is released", async (t) => {
  const harness = createMediaHarness();
  const abort = createAbortHarness();
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  installRecordingEnvironment(t, harness);

  const pending = recordSpeech({
    signal: abort.signal,
    onReady: markReady,
    onLevel: () => { throw new Error("level callback failed"); },
  });
  await ready;
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.01)));
  await assert.rejects(pending, /level callback failed/);

  assert.deepEqual(harness.metrics.disconnects, { processor: 1, sink: 1, source: 1 });
  assert.equal(harness.metrics.closeCalls, 1);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
  assert.equal(harness.processor.onaudioprocess, null);
});

test("abort during active recording returns captured speech after cleanup", async (t) => {
  const harness = createMediaHarness();
  const abort = createAbortHarness();
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  installRecordingEnvironment(t, harness);

  const pending = recordSpeech({ signal: abort.signal, onReady: markReady });
  await ready;
  for (let index = 0; index < 4; index += 1) harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.0001)));
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.04)));
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.04)));
  abort.abort();
  const result = await pending;

  assert.equal(result.heardSpeech, true);
  assert.ok(result.samples.length > 0);
  assert.deepEqual(harness.metrics.disconnects, { processor: 1, sink: 1, source: 1 });
  assert.equal(harness.metrics.closeCalls, 1);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
});

test("normal recording still captures speech and performs the same final cleanup", async (t) => {
  const harness = createMediaHarness();
  const abort = createAbortHarness();
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  let speechStarts = 0;
  installRecordingEnvironment(t, harness);

  const pending = recordSpeech({
    maxDurationMs: 30,
    maxIdleMs: 30,
    signal: abort.signal,
    onReady: markReady,
    onSpeechStart: () => { speechStarts += 1; },
  });
  await ready;
  for (let index = 0; index < 4; index += 1) harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.0001)));
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.04)));
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.04)));
  const result = await pending;

  assert.equal(result.heardSpeech, true);
  assert.equal(speechStarts, 1);
  assert.ok(result.samples.length > 0);
  assert.deepEqual(harness.metrics.disconnects, { processor: 1, sink: 1, source: 1 });
  assert.equal(harness.metrics.closeCalls, 1);
  assert.deepEqual(harness.metrics.trackStops, [1, 1]);
  assert.equal(abort.listenerCount(), 0);
});

test("maximum utterance duration starts only after VAD detects speech", async (t) => {
  const harness = createMediaHarness();
  installRecordingEnvironment(t, harness);
  const recording = recordSpeech({ maxDurationMs: 15, maxIdleMs: 80, silenceMs: 50 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.04)));
  harness.processor.onaudioprocess(audioEvent(new Float32Array(128).fill(0.04)));
  const result = await recording;
  assert.equal(result.heardSpeech, true);
});
