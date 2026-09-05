import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCommunityDataset } = require("../electron/harness/virtual-senior-community-dataset.cjs");
const { createVirtualSeniorLiveSession } = require("../electron/harness/virtual-senior-live-session.cjs");
const { createVirtualSeniorVoiceTrial } = require("../electron/harness/virtual-senior-voice-trial.cjs");

const dataset = createCommunityDataset({ profile: "smoke" });
const resident = Array.from({ length: 64 }, (_, index) => dataset.residentAt(index)).find((item) => item.permissionState === "verified-self");
const bindingFor = (service) => service.detail({ residentId: resident.seniorId }).binding;
const sample = () => Float32Array.from({ length: 1600 }, (_, index) => Math.sin(index / 7) * 0.2);

function runService(t, options = {}) {
  const events = [];
  let resolve;
  const finished = new Promise((done) => { resolve = done; });
  const service = createVirtualSeniorLiveSession({
    dataset,
    turnDelayMs: 0,
    ackTimeoutMs: 250,
    ...options,
    onEvent(owner, event) {
      events.push(event);
      if (["question", "answer"].includes(event.type)) queueMicrotask(() => service.acknowledge(owner, event));
      if (event.type === "voice-audio") queueMicrotask(() => service.acknowledge(owner, { ...event, receipt: { ended: true, contextState: "running", muted: false, playedMs: event.payload.audio.durationMs } }));
      if (["completed", "failed", "cancelled"].includes(event.type)) resolve(event.payload.report);
    },
  });
  t.after(() => service.close());
  return { service, events, finished };
}

test("live speech path uses the recognized transcript, confirms playback and omits PCM from the report", async (t) => {
  const recognized = "查看我的最新健康体征";
  const harnessInputs = [];
  const speech = {
    status: () => ({ ready: true }),
    synthesize: async () => ({ ok: true, samples: sample(), sampleRate: 16000, visemes: [{ atMs: 0, shape: "A" }] }),
    recognize: async () => ({ ok: true, provider: "sherpa-onnx-sensevoice-local", trustedFinal: true, text: recognized }),
    cancelTurn: () => true,
  };
  const { service, events, finished } = runService(t, {
    speech,
    voiceTrialFactory: (input) => createVirtualSeniorVoiceTrial({ ...input, evidenceMode: "unit-test" }),
    harnessFactory: () => ({
      async run(input) {
        harnessInputs.push(input);
        return { ok: true, status: "completed", data: { seniorId: resident.seniorId }, answer: { speechText: "最近一次合成体征记录正常。" }, toolTrace: [] };
      },
      clearSession() {},
      cancel() {},
    }),
  });
  const prepared = service.prepare(11, { binding: bindingFor(service), scenarioId: "health-vitals" });
  service.begin(11, prepared.runId);
  const report = await finished;

  assert.equal(report.status, "completed");
  assert.equal(report.acceptance.status, "passed");
  assert.equal(report.acceptance.scope, "synthetic-speech-loopback");
  assert.equal(report.layers.asr, "passed");
  assert.equal(report.layers.playback, "passed");
  assert.equal(report.layers.answerAudioSemanticFidelity, "not-verified");
  assert.equal(report.layers.microphone, "not-verified");
  assert.equal(harnessInputs.length, 1);
  assert.equal(harnessInputs[0].text, recognized);
  assert.equal(report.turns[0].recognizedText, recognized);
  assert.equal(report.turns[0].voice.status, "passed");
  assert.equal(events.filter((event) => event.type === "voice-audio").length, 2);
  const storedAudio = report.events.filter((event) => event.type === "voice-audio");
  assert.equal(storedAudio.length, 2);
  assert.ok(storedAudio.every((event) => event.payload.samplesOmitted === true && !("samples" in event.payload)));
  assert.ok(JSON.stringify(report).length < 200_000);
});

test("unavailable mandatory speech is recorded as blocked and never falls back to a text business call", async (t) => {
  let harnessCalls = 0;
  const { service, finished } = runService(t, {
    speech: { status: () => ({ ready: false }), cancelTurn: () => true },
    voiceTrialFactory: (input) => createVirtualSeniorVoiceTrial({ ...input, evidenceMode: "unit-test" }),
    harnessFactory: () => ({ run: async () => { harnessCalls += 1; }, clearSession() {}, cancel() {} }),
  });
  const prepared = service.prepare(12, { binding: bindingFor(service), scenarioId: "health-vitals" });
  service.begin(12, prepared.runId);
  const report = await finished;

  assert.equal(report.status, "completed");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.acceptance.status, "blocked");
  assert.equal(report.acceptance.code, "MANDATORY_VOICE_BLOCKED");
  assert.equal(report.turns[0].status, "blocked");
  assert.match(report.turns[0].answer, /语音测试受阻/);
  assert.equal(report.coverage.voiceBlockedTurns, 1);
  assert.equal(harnessCalls, 0);
});
