"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSpeechService } = require("../electron/speech-service.cjs");
const { createVirtualSeniorFixtureMcp } = require("../electron/harness/virtual-senior-fixture-mcp.cjs");
const { createVirtualSeniorOrchestrator } = require("../electron/harness/virtual-senior-orchestrator.cjs");
const { createVirtualSeniorAsrGate } = require("../electron/harness/virtual-senior-asr-gate.cjs");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const manifestPath = path.join(projectRoot, "tests", "fixtures", "virtual-senior-asr", "manifest.v1.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const reportArgument = process.argv.find((argument) => argument.startsWith("--report-root="));
const reportRoot = path.resolve(projectRoot, reportArgument ? reportArgument.slice("--report-root=".length) : "qa/virtual-senior-m2b-asr");

async function main() {
  const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => projectRoot } });
  const fixture = createVirtualSeniorFixtureMcp();
  try {
    const status = speech.status();
    if (!status.ready) throw Object.assign(new Error(`离线语音模型不完整：${status.missing.join(", ")}`), { code: "ASR_RUNTIME_NOT_READY" });
    await fixture.start();
    const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: packageJson.version });
    const gate = createVirtualSeniorAsrGate({
      manifest,
      audioRoot: path.dirname(manifestPath),
      recognize: speech.recognize,
      orchestrator,
      reportRoot,
      asrMode: "real-local",
    });
    const batch = await gate.runBatch();
    process.stdout.write(`${JSON.stringify({ result: batch.result, batchId: batch.batchId, reportRoot, asr: batch.analysis.asr, reports: batch.reports.map((report) => ({ scenarioId: report.scenarioId, result: report.result, transcript: report.asr.transcript, wavHash: report.asr.wavHash, provider: report.asr.provider, characterErrorRate: report.asr.characterErrorRate, harnessStatus: report.observed?.status, tools: report.observed?.actualTools })) }, null, 2)}\n`);
    if (batch.result !== "PASS") process.exitCode = 1;
  } finally {
    speech.close();
    await fixture.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ result: "FAIL", code: error?.code || "ASR_GATE_ERROR", message: error?.message || String(error), details: error?.details || null }, null, 2)}\n`);
  process.exitCode = 1;
});
