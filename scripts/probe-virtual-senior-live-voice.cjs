"use strict";

// Developer diagnostic only. Actual inference is useful evidence, but this
// script cannot accept GUI playback, acoustic input/output, or the whole app.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSpeechService } = require("../electron/speech-service.cjs");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");
const { REAL_ASR_PROVIDER, characterErrorRate } = require("../electron/harness/virtual-senior-asr-gate.cjs");
const { audioEvidence } = require("../electron/harness/virtual-senior-voice-trial.cjs");
const { validateRoundTranscript } = require("../electron/harness/virtual-senior-voice-oracle.cjs");
const root = path.resolve(__dirname, "..");
const probeRoot = path.resolve(process.env.VIRTUAL_SENIOR_VOICE_PROBE_ROOT || path.join(root, "QA-EXTERNAL/virtual-senior-community/voice-selection-20260904/probes"));
const outputDirectory = path.join(probeRoot, crypto.randomUUID());
const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => root } });
const report = { evidence: "actual-local-model-inference", fullVoiceAcceptance: false, status: "blocked", blocker: "GUI_PLAYBACK_NOT_VERIFIED", microphone: "not-verified", acousticOutput: "not-verified", startedAt: new Date().toISOString(), cases: [] };

async function main() {
  await fs.mkdir(path.join(outputDirectory, "audio"), { recursive: true });
  for (const step of JOURNEY) {
    const row = { roundId: step.id, question: step.question, maxCer: 0.25, speed: 1 };
    const started = performance.now();
    try {
      const output = await speech.synthesize({ text: step.question, speed: 1, voiceId: "zh-ll-2", turnId: `voice-probe-${step.id}` });
      const pcm = audioEvidence(output);
      row.questionAudio = pcm.metadata;
      row.questionAudio.relativePath = `audio/${step.id}.f32`;
      row.questionAudio.format = "f32le-mono";
      // Retain exact PCM because synthesis can vary between runs. The stored
      // buffer is the exact ASR input and its hash is part of this record.
      await fs.writeFile(path.join(outputDirectory, row.questionAudio.relativePath), Buffer.from(pcm.samples.buffer), { flag: "wx" });
      const actual = await speech.recognize({ samples: pcm.samples, sampleRate: pcm.metadata.sampleRate });
      row.transcript = actual.text || "";
      row.cer = characterErrorRate(row.transcript, step.question);
      row.provider = actual.provider;
      row.criticalTerms = validateRoundTranscript(step.id, row.transcript);
      row.characterAccuracyPassed = actual.ok && actual.trustedFinal === true && actual.provider === REAL_ASR_PROVIDER && row.cer <= row.maxCer;
      row.asrStatus = row.characterAccuracyPassed && row.criticalTerms.valid ? "passed" : "failed";
      if (!actual.ok) row.error = actual.message;
    } catch (error) { row.asrStatus = "blocked"; row.error = error.message; }
    row.durationMs = performance.now() - started;
    report.cases.push(row);
    console.log(JSON.stringify({ round: row.roundId, asr: row.asrStatus, cer: row.cer, durationMs: Math.round(row.durationMs), error: row.error }));
  }
  report.finishedAt = new Date().toISOString();
  report.asrPassed = report.cases.filter((row) => row.asrStatus === "passed").length;
  report.asrTotal = report.cases.length;
  const output = path.join(outputDirectory, "report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ actualAsr: `${report.asrPassed}/${report.asrTotal}`, fullVoiceAcceptance: false, output }));
  if (report.asrPassed !== report.asrTotal) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => speech.close());
