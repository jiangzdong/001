"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSpeechService } = require("../electron/speech-service.cjs");
const { REAL_ASR_PROVIDER, characterErrorRate } = require("../electron/harness/virtual-senior-asr-gate.cjs");
const { validateRoundTranscript } = require("../electron/harness/virtual-senior-voice-oracle.cjs");
const { validateFixtureManifest, sha256 } = require("../electron/harness/virtual-senior-voice-regression.cjs");

const root = path.resolve(__dirname, "..");
const fixtureDirectory = path.resolve(process.argv[2] || path.join(root, "QA-EXTERNAL/virtual-senior-community/voice-regression-v1"));
const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => root } });

async function main() {
  const manifestBytes = await fs.readFile(path.join(fixtureDirectory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateFixtureManifest(manifest, fixtureDirectory);
  const outputDirectory = path.join(fixtureDirectory, "replays", crypto.randomUUID());
  await fs.mkdir(outputDirectory, { recursive: true });
  const report = { evidence: "actual-local-model-inference", mode: "immutable-curated-f32-asr-regression", fixtureManifestSha256: sha256(manifestBytes), fixturePayloadSha256: manifest.integrity.payloadSha256, fullVoiceAcceptance: false, status: "blocked", blocker: "GUI_PLAYBACK_NOT_VERIFIED", startedAt: new Date().toISOString(), cases: [] };
  for (const entry of manifest.entries) {
    const bytes = await fs.readFile(path.join(fixtureDirectory, entry.pcmPath));
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    const actual = await speech.recognize({ samples: Float32Array.from(samples), sampleRate: entry.sampleRate });
    const transcript = String(actual.text || "").trim();
    const cer = characterErrorRate(transcript, entry.question);
    const criticalTerms = validateRoundTranscript(entry.roundId, transcript);
    const asrStatus = actual.ok && actual.trustedFinal === true && actual.provider === REAL_ASR_PROVIDER && cer <= 0.25 && criticalTerms.valid ? "passed" : "failed";
    report.cases.push({ roundId: entry.roundId, question: entry.question, pcmPath: entry.pcmPath, sha256: sha256(bytes), transcript, cer, provider: actual.provider, criticalTerms, asrStatus });
    console.log(JSON.stringify({ roundId: entry.roundId, asrStatus, cer, missing: criticalTerms.missing }));
  }
  report.finishedAt = new Date().toISOString();
  report.asrPassed = report.cases.filter((item) => item.asrStatus === "passed").length;
  report.asrTotal = report.cases.length;
  const output = path.join(outputDirectory, "report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ actualAsr: `${report.asrPassed}/${report.asrTotal}`, output }));
  if (report.asrPassed !== report.asrTotal) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => speech.close());
