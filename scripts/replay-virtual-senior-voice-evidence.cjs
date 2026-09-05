"use strict";

// QA-only exact-PCM replay. It deliberately never synthesizes: the stored
// Float32 input and SHA-256 are the evidence being replayed through local ASR.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSpeechService } = require("../electron/speech-service.cjs");
const { REAL_ASR_PROVIDER, characterErrorRate } = require("../electron/harness/virtual-senior-asr-gate.cjs");
const { validateRoundTranscript } = require("../electron/harness/virtual-senior-voice-oracle.cjs");

const root = path.resolve(__dirname, "..");
const inputPath = path.resolve(process.argv[2] || "");
const requestedRoundIds = process.argv.slice(3);
if (!inputPath) throw new Error("Usage: replay-virtual-senior-voice-evidence.cjs <report.json> [roundId ...]");

const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => root } });
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function main() {
  const source = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const sourceCases = Array.isArray(source.cases) ? source.cases : [];
  const selected = requestedRoundIds.length
    ? sourceCases.filter((item) => requestedRoundIds.includes(item.roundId))
    : sourceCases.filter((item) => item.asrStatus !== "passed");
  if (!selected.length || (requestedRoundIds.length && selected.length !== requestedRoundIds.length)) throw new Error("没有找到全部要求重放的语音轮次");
  const outputDirectory = path.join(path.dirname(inputPath), "replays", crypto.randomUUID());
  const report = {
    evidence: "actual-local-model-inference",
    mode: "exact-retained-f32-asr-replay",
    sourceReport: inputPath,
    fullVoiceAcceptance: false,
    status: "blocked",
    blocker: "GUI_PLAYBACK_NOT_VERIFIED",
    microphone: "not-verified",
    acousticOutput: "not-verified",
    startedAt: new Date().toISOString(),
    cases: [],
  };
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const sourceCase of selected) {
    const audio = sourceCase.questionAudio;
    const absoluteAudioPath = path.resolve(path.dirname(inputPath), audio?.relativePath || "");
    const bytes = await fs.readFile(absoluteAudioPath);
    const expectedBytes = Number(audio?.samples) * Float32Array.BYTES_PER_ELEMENT;
    const actualSha256 = sha256(bytes);
    const formatValid = audio?.format === "f32le-mono" && Number.isInteger(audio?.sampleRate) && bytes.length === expectedBytes && actualSha256 === audio?.sha256;
    const row = {
      roundId: sourceCase.roundId,
      question: sourceCase.question,
      original: { transcript: sourceCase.transcript, cer: sourceCase.cer, asrStatus: sourceCase.asrStatus, criticalTerms: sourceCase.criticalTerms, questionAudio: audio },
      replayedAudio: { relativePath: path.relative(outputDirectory, absoluteAudioPath), bytes: bytes.length, sha256: actualSha256, formatValid },
      maxCer: 0.25,
    };
    if (!formatValid) {
      row.asrStatus = "blocked";
      row.error = "RETAINED_PCM_EVIDENCE_MISMATCH";
      report.cases.push(row);
      continue;
    }
    const sourceSamples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / Float32Array.BYTES_PER_ELEMENT);
    const actual = await speech.recognize({ samples: Float32Array.from(sourceSamples), sampleRate: audio.sampleRate });
    row.transcript = String(actual.text || "").trim();
    row.provider = actual.provider;
    row.cer = characterErrorRate(row.transcript, row.question);
    row.criticalTerms = validateRoundTranscript(row.roundId, row.transcript);
    row.asrStatus = actual.ok && actual.trustedFinal === true && actual.provider === REAL_ASR_PROVIDER && row.cer <= row.maxCer && row.criticalTerms.valid ? "passed" : "failed";
    if (!actual.ok) row.error = actual.message || "LOCAL_ASR_FAILED";
    report.cases.push(row);
    console.log(JSON.stringify({ roundId: row.roundId, sha256: row.replayedAudio.sha256, asrStatus: row.asrStatus, cer: row.cer, transcript: row.transcript, missing: row.criticalTerms.missing }));
  }
  report.finishedAt = new Date().toISOString();
  report.asrPassed = report.cases.filter((item) => item.asrStatus === "passed").length;
  report.asrTotal = report.cases.length;
  const output = path.join(outputDirectory, "report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ actualAsr: `${report.asrPassed}/${report.asrTotal}`, fullVoiceAcceptance: false, output }));
  if (report.asrPassed !== report.asrTotal) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => speech.close());
