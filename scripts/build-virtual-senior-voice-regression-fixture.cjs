"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");
const { ORACLE_VERSION, validateRoundTranscript } = require("../electron/harness/virtual-senior-voice-oracle.cjs");
const { FIXTURE_VERSION, sha256, manifestPayloadSha256, validateFixtureManifest } = require("../electron/harness/virtual-senior-voice-regression.cjs");

const root = path.resolve(__dirname, "..");
const fixtureDirectory = path.join(root, "QA-EXTERNAL/virtual-senior-community/voice-regression-v1");
const primaryReport = "QA-EXTERNAL/virtual-senior-community/voice-selection-20260904/probes/25ddcee5-12c1-4e18-ab6b-5ab88abcd779/report.json";
const fallbackReport = "QA-EXTERNAL/virtual-senior-community/voice-selection-20260904/probes/0dc8beb3-97a0-4790-bfe9-776ecc7d0c36/report.json";

async function loadReport(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const bytes = await fs.readFile(absolutePath);
  return { relativePath, absolutePath, sha256: sha256(bytes), data: JSON.parse(bytes.toString("utf8")) };
}

async function main() {
  const [primary, fallback] = await Promise.all([loadReport(primaryReport), loadReport(fallbackReport)]);
  const reports = [primary, fallback];
  const manifest = { fixtureVersion: FIXTURE_VERSION, oracleVersion: ORACLE_VERSION, purpose: "curated deterministic ASR regression; not a TTS stability result", entries: [] };
  await fs.mkdir(path.join(fixtureDirectory, "audio"), { recursive: true });
  for (const step of JOURNEY) {
    let choice;
    for (const report of reports) {
      const row = report.data.cases?.find((item) => item.roundId === step.id);
      if (!row?.questionAudio || !row.transcript || row.question !== step.question) continue;
      if (row.cer > 0.25 || !validateRoundTranscript(step.id, row.transcript).valid) continue;
      choice = { report, row }; break;
    }
    if (!choice) throw new Error(`没有可用于严格固定回归的通过 PCM：${step.id}`);
    const sourceAudio = path.join(path.dirname(choice.report.absolutePath), choice.row.questionAudio.relativePath);
    const bytes = await fs.readFile(sourceAudio);
    if (bytes.length !== choice.row.questionAudio.samples * 4 || sha256(bytes) !== choice.row.questionAudio.sha256) throw new Error(`来源 PCM 校验失败：${step.id}`);
    const pcmPath = `audio/${step.id}.f32`;
    await fs.writeFile(path.join(fixtureDirectory, pcmPath), bytes, { flag: "wx" });
    manifest.entries.push({ roundId: step.id, question: step.question, oracleVersion: ORACLE_VERSION, sourceReport: choice.report.relativePath, sourceReportSha256: choice.report.sha256, sourceAudio: choice.row.questionAudio.relativePath, pcmPath, bytes: bytes.length, sampleRate: choice.row.questionAudio.sampleRate, sha256: sha256(bytes), expectedTranscript: choice.row.transcript, selectionReason: "source report transcript passed current CER and strict oracle" });
  }
  manifest.integrity = { payloadSha256: manifestPayloadSha256(manifest) };
  validateFixtureManifest(manifest, fixtureDirectory);
  await fs.writeFile(path.join(fixtureDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ fixtureDirectory, cases: manifest.entries.length, manifestSha256: manifest.integrity.payloadSha256 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
