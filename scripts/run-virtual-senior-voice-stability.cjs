"use strict";

// Full-batch TTS/ASR stability runner. Every attempted batch is retained;
// this deliberately has no retry, filtering, or best-batch selection path.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");

const root = path.resolve(__dirname, "..");
const batches = Number((process.argv.find((arg) => arg.startsWith("--batches=")) || "--batches=3").split("=")[1]);
if (!Number.isInteger(batches) || batches < 1 || batches > 30) throw new Error("--batches must be an integer from 1 to 30");
const runDirectory = path.join(root, "QA-EXTERNAL/virtual-senior-community/voice-stability-v1", crypto.randomUUID());
const probe = path.join(root, "scripts/probe-virtual-senior-live-voice.cjs");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const percentile = (values, p) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;

function runBatch(batchRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probe], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VIRTUAL_SENIOR_VOICE_PROBE_ROOT: batchRoot }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const final = stdout.trim().split("\n").reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item?.output);
      if (!final?.output) return reject(new Error(`batch report missing (exit ${code}): ${stderr.slice(-240)}`));
      resolve({ code, output: final.output, stdout, stderr });
    });
  });
}

function summarize(batchReports) {
  const rows = batchReports.flatMap((batch) => batch.report.cases.map((row) => ({ ...row, batch: batch.index })));
  const perRound = Object.fromEntries(JOURNEY.map((step) => {
    const values = rows.filter((row) => row.roundId === step.id);
    const passed = values.filter((row) => row.asrStatus === "passed").length;
    return [step.id, { passed, total: values.length, passRate: values.length ? passed / values.length : 0 }];
  }));
  const criticalDomains = { identity: ["identity"], authorization: ["permission"], save: ["save", "save-replay"] };
  const critical = Object.fromEntries(Object.entries(criticalDomains).map(([domain, ids]) => {
    const values = rows.filter((row) => ids.includes(row.roundId));
    const passed = values.filter((row) => row.asrStatus === "passed" && row.criticalTerms?.valid).length;
    return [domain, { passed, total: values.length, passRate: values.length ? passed / values.length : 0 }];
  }));
  const transitions = {};
  for (const step of JOURNEY) {
    for (let index = 1; index < batchReports.length; index++) {
      const before = batchReports[index - 1].report.cases.find((row) => row.roundId === step.id)?.asrStatus === "passed" ? "pass" : "fail";
      const after = batchReports[index].report.cases.find((row) => row.roundId === step.id)?.asrStatus === "passed" ? "pass" : "fail";
      const key = `${before}->${after}`; transitions[key] = (transitions[key] || 0) + 1;
    }
  }
  const cer = rows.map((row) => row.cer).filter(Number.isFinite).sort((a, b) => a - b);
  const passedCases = rows.filter((row) => row.asrStatus === "passed").length;
  const fullPassBatches = batchReports.filter((batch) => batch.report.asrPassed === JOURNEY.length).length;
  const thresholds = { minimumBatches: 30, perRoundPassRate: 0.95, allCasePassRate: 0.98, criticalPassRate: 1 };
  const enoughBatches = batchReports.length >= thresholds.minimumBatches;
  const thresholdPass = enoughBatches && Object.values(perRound).every((item) => item.passRate >= thresholds.perRoundPassRate) && passedCases / rows.length >= thresholds.allCasePassRate && Object.values(critical).every((item) => item.passRate === thresholds.criticalPassRate);
  return { batches: batchReports.length, totalCases: rows.length, passedCases, allCasePassRate: passedCases / rows.length, fullPassBatches, fullBatchPassRate: fullPassBatches / batchReports.length, perRound, criticalDomains: critical, cer: { min: cer[0] ?? null, p50: percentile(cer, 0.5), p95: percentile(cer, 0.95), max: cer.at(-1) ?? null }, failureTransitions: transitions, thresholds, gate: enoughBatches ? (thresholdPass ? "passed" : "failed") : "pilot" };
}

async function main() {
  await fs.mkdir(path.join(runDirectory, "batches"), { recursive: true });
  const batchReports = [];
  for (let index = 1; index <= batches; index++) {
    const result = await runBatch(path.join(runDirectory, "batches"));
    const bytes = await fs.readFile(result.output);
    const report = JSON.parse(bytes.toString("utf8"));
    if (report.asrTotal !== JOURNEY.length || report.cases.length !== JOURNEY.length) throw new Error(`batch ${index} did not retain all 22 rounds`);
    batchReports.push({ index, exitCode: result.code, reportPath: path.relative(runDirectory, result.output), reportSha256: sha256(bytes), report });
    console.log(JSON.stringify({ batch: index, actualAsr: `${report.asrPassed}/${report.asrTotal}`, report: result.output }));
  }
  const summary = summarize(batchReports);
  const output = { version: "virtual-senior-voice-stability-v1", evidence: "full-batch-vits-sensevoice", startedAt: new Date().toISOString(), batches: batchReports.map(({ report, ...item }) => item), summary, fullVoiceAcceptance: false, status: "blocked", blocker: "GUI_PLAYBACK_NOT_VERIFIED" };
  const out = path.join(runDirectory, "summary.json");
  await fs.writeFile(out, JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ gate: summary.gate, actualCases: `${summary.passedCases}/${summary.totalCases}`, output: out }));
  if (summary.gate === "failed") process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
