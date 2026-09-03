import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asrModule from "../electron/harness/virtual-senior-asr-gate.cjs";
import fixtureModule from "../electron/harness/virtual-senior-fixture-mcp.cjs";
import orchestratorModule from "../electron/harness/virtual-senior-orchestrator.cjs";
import analysisModule from "../electron/harness/virtual-senior-analysis.cjs";

const { REAL_ASR_PROVIDER, characterErrorRate, createVirtualSeniorAsrGate, readPcm16Mono16kWave, validateManifest } = asrModule;
const { createVirtualSeniorFixtureMcp } = fixtureModule;
const { createVirtualSeniorOrchestrator } = orchestratorModule;
const { analyzeVirtualSeniorReports } = analysisModule;
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "virtual-senior-asr");
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "manifest.v1.json"), "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("fixed WAV manifest is strict, synthetic-only and bound to current allowlists", () => {
  assert.equal(validateManifest(manifest), manifest);
  const missingClassification = clone(manifest);
  delete missingClassification.cases[0].dataClassification;
  assert.throws(() => validateManifest(missingClassification), (error) => error.code === "ASR_MANIFEST_REJECTED" && error.details.some((detail) => detail.includes("dataClassification")));
  const forgedProduction = clone(manifest);
  forgedProduction.dataClassification = "production";
  assert.throws(() => validateManifest(forgedProduction), (error) => error.code === "ASR_MANIFEST_REJECTED" && error.details.some((detail) => detail.includes("const mismatch")));
  const unknownScenario = clone(manifest);
  unknownScenario.cases[0].scenarioId = "PRODUCTION-OVERRIDE";
  assert.throws(() => validateManifest(unknownScenario), (error) => error.code === "ASR_MANIFEST_REJECTED" && error.details.some((detail) => detail.includes("allowlist")));
  const unknownField = clone(manifest);
  unknownField.cases[0].actor = { subjectToken: "fixture" };
  assert.throws(() => validateManifest(unknownField), (error) => error.code === "ASR_MANIFEST_REJECTED" && error.details.some((detail) => detail.includes("unknown property")));
  const personalText = clone(manifest);
  personalText.cases[0].expectedText = personalText.cases[0].sourceGenerator.text = "我的手机号是13800138000";
  assert.throws(() => validateManifest(personalText), (error) => error.code === "ASR_MANIFEST_REJECTED" && error.details.some((detail) => detail.includes("PII")));
});

test("checked-in ASR fixture is PCM16 mono 16 kHz and matches its immutable hash", () => {
  const item = manifest.cases[0];
  const wave = readPcm16Mono16kWave(path.join(fixtureRoot, item.relativePath));
  assert.equal(wave.sampleRate, 16000);
  assert.ok(wave.durationMs > 1000);
  assert.equal(crypto.createHash("sha256").update(wave.data).digest("hex"), item.sha256);
});

test("character error rate normalizes punctuation and measures substitutions", () => {
  assert.equal(characterErrorRate("助餐服务几点开始？", "助餐服务几点开始。"), 0);
  assert.ok(characterErrorRate("注餐服务几点开始", "助餐服务几点开始") > 0);
});

test("stub ASR can exercise the pipeline but cannot produce a hard PASS", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18" });
  await assert.rejects(orchestrator.runCase({ testMode: "fixed-wav-asr", scenarioId: "PUB-SERVICE-001", transcript: manifest.cases[0].expectedText, asrEvidence: { verified: true } }), (error) => error.code === "ASR_EVIDENCE_REQUIRED");
  const gate = createVirtualSeniorAsrGate({
    manifest,
    audioRoot: fixtureRoot,
    recognize: async () => ({ ok: true, text: manifest.cases[0].expectedText, provider: "test-stub", trustedFinal: true }),
    orchestrator,
    asrMode: "stub",
  });
  const report = await gate.runCase({ caseId: "ASR-PUB-SERVICE-001", runId: "stub-asr" });
  assert.equal(report.asr.result, "NON_GATING");
  assert.equal(report.asr.errorCode, "ASR_STUB_NON_GATING");
  assert.equal(report.observed.status, "completed");
  assert.deepEqual(report.observed.actualTools, ["health_evaluation_service_mcp_cms.get_station_service_detail"]);
  assert.equal(report.result, "FAIL");
});

test("unverified real-mode provider fails closed and ASR trends remain visible", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18" });
  const gate = createVirtualSeniorAsrGate({
    manifest,
    audioRoot: fixtureRoot,
    recognize: async () => ({ ok: true, text: manifest.cases[0].expectedText, provider: "remote-or-unknown", trustedFinal: true }),
    orchestrator,
    asrMode: "real-local",
  });
  const report = await gate.runCase({ caseId: "ASR-PUB-SERVICE-001", runId: "unverified-asr" });
  assert.equal(report.asr.providerVerified, false);
  assert.equal(report.asr.errorCode, "ASR_PROVIDER_UNVERIFIED");
  assert.equal(report.result, "FAIL");
  const first = analyzeVirtualSeniorReports([report]);
  const verified = clone(report);
  verified.asr.provider = REAL_ASR_PROVIDER;
  verified.asr.providerVerified = true;
  verified.asr.result = "PASS";
  verified.asr.errorCode = null;
  verified.result = "PASS";
  const second = analyzeVirtualSeniorReports([verified], first);
  assert.equal(first.asr.passRate, 0);
  assert.equal(first.asr.byAudioCondition["synthetic-clean"].total, 1);
  assert.equal(first.asr.byAudioCondition["synthetic-clean"].failed, 1);
  assert.equal(first.asr.errorCodes.ASR_PROVIDER_UNVERIFIED, 1);
  assert.equal(second.asr.passRate, 100);
  assert.equal(second.asr.trend.deltaPassRate, 100);
  assert.ok(second.asr.duration.p95Ms >= 0);
});

test("recognized PII is rejected before entering Harness", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18" });
  const gate = createVirtualSeniorAsrGate({
    manifest,
    audioRoot: fixtureRoot,
    recognize: async () => ({ ok: true, text: "我的手机号是13800138000", provider: REAL_ASR_PROVIDER, trustedFinal: true }),
    orchestrator,
    asrMode: "real-local",
  });
  const report = await gate.runCase({ caseId: "ASR-PUB-SERVICE-001", runId: "sensitive-asr" });
  assert.equal(report.asr.errorCode, "ASR_SENSITIVE_CONTENT_REJECTED");
  assert.equal(report.observed.status, "not-run");
  assert.deepEqual(report.observed.actualTools, []);
  assert.equal(report.result, "FAIL");
});

test("ASR batch trend reloads from persisted reports after gate restart", async (t) => {
  const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-asr-history-"));
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(async () => {
    await fixture.close();
    fs.rmSync(reportRoot, { recursive: true, force: true });
  });
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18" });
  const recognize = async () => ({ ok: true, text: manifest.cases[0].expectedText, provider: REAL_ASR_PROVIDER, trustedFinal: true });
  const firstGate = createVirtualSeniorAsrGate({ manifest, audioRoot: fixtureRoot, recognize, orchestrator, reportRoot, asrMode: "real-local", now: () => 1000 });
  const first = await firstGate.runBatch({ batchId: "asr-history-1" });
  assert.equal(first.result, "PASS");
  const restarted = createVirtualSeniorAsrGate({ manifest, audioRoot: fixtureRoot, recognize, orchestrator, reportRoot, asrMode: "real-local", now: () => 2000 });
  const second = await restarted.runBatch({ batchId: "asr-history-2" });
  assert.equal(second.analysis.asr.trend.previousPassRate, 100);
  assert.equal(second.analysis.asr.trend.deltaPassRate, 0);
});
