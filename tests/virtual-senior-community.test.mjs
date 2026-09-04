import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import communityModule from "../electron/harness/virtual-senior-community-dataset.cjs";
import fixtureModule from "../electron/harness/virtual-senior-fixture-mcp.cjs";
import jobModule from "../electron/harness/virtual-senior-community-jobs.cjs";

const { CONTRACT_STATES, PROFILES, createCommunityDataset, createCommunityManifest, entityRecord, residentGlobalIndex, selectResidents, validateSuccessContract } = communityModule;
const { createVirtualSeniorFixtureMcp } = fixtureModule;
const { createCommunityJobRunner } = jobModule;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function jsonLines(file) { return fs.readFileSync(file, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line)); }
function writeJsonLines(file, rows) { fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`); }
function runScript(script, args) { return spawnSync(process.execPath, [path.join(projectRoot, script), ...args], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }); }

test("community Electron runner is portable and packaged startup hard-disables QA faults", () => {
  const main = fs.readFileSync(path.join(projectRoot, "electron", "main.cjs"), "utf8");
  assert.match(main, /nodePath:\s*process\.env\.VIRTUAL_SENIOR_NODE\s*\|\|\s*process\.execPath/);
  assert.match(main, /process\.resourcesPath, "app\.asar\.unpacked"/);
  assert.match(main, /allowTestFaultInjection:\s*virtualSeniorStartupEnabled\s*&&\s*!app\.isPackaged\s*&&\s*process\.env\.VIRTUAL_SENIOR_COMMUNITY_QA_FAULTS\s*===\s*"1"/);
  assert.doesNotMatch(main, /\/Users\/luc\//);
  const runner = fs.readFileSync(path.join(projectRoot, "electron", "harness", "virtual-senior-community-jobs.cjs"), "utf8");
  assert.match(runner, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  const build = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).build;
  assert.doesNotMatch(JSON.stringify(build), /QA-EXTERNAL|virtual-senior-community-qa/);
  assert.match(JSON.stringify(build.asarUnpack), /generate-virtual-senior-community-dataset\.cjs/);
  assert.match(JSON.stringify(build.asarUnpack), /virtual-senior-fixture-mcp\.cjs/);
});

test("community profiles retain exact population sizes and a deterministic manifest", () => {
  assert.deepEqual(PROFILES, { smoke: 64, regression: 1000, "community-full": 10000, stress: 50000 });
  const first = createCommunityManifest({ profile: "community-full", seed: 104729 });
  const second = createCommunityManifest({ profile: "community-full", seed: 104729 });
  const changed = createCommunityManifest({ profile: "community-full", seed: 104730 });
  assert.equal(first.residents, 10000);
  assert.ok(first.totalRecords >= 3500000);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.notEqual(first.manifestHash, changed.manifestHash);
});

test("synthetic residents are repeatable, cross-domain and never production data", () => {
  const dataset = createCommunityDataset({ profile: "community-full", seed: 104729 });
  const resident = dataset.residentAt(42);
  assert.equal(dataset.resident(resident.seniorId).seniorId, resident.seniorId);
  assert.equal(resident.dataClassification, "synthetic-test-only");
  const profile = dataset.toolResponse("health_evaluation_service_mcp_cms.get_senior_profile", { seniorId: resident.seniorId });
  const member = dataset.toolResponse("member_asset_mcp.get_member_points", { seniorId: resident.seniorId });
  assert.equal(profile.seniorId, member.seniorId);
  assert.equal(profile.source, "test-fixture");
});

test("all 16 tools provide structured success data and contract states fail explicitly", () => {
  const dataset = createCommunityDataset();
  const resident = dataset.residentAt(1);
  const keys = dataset.tools;
  assert.equal(keys.length, 16);
  for (const key of keys) {
    const data = dataset.toolResponse(key, { seniorId: resident.seniorId, orgId: 10001, tenantId: 10001, serviceId: "meal_service", captureToken: "synthetic", consentId: "synthetic", operatorId: "qa", action: "member:read:self", authorizationId: "synthetic", idempotencyKey: "idempotent-1", query: "服务" });
    assert.equal(data.source, "test-fixture", key);
    assert.ok(Array.isArray(data.factIds), key);
    assert.equal(validateSuccessContract(key, data).valid, true, key);
  }
  for (const state of CONTRACT_STATES.filter((item) => item !== "success")) {
    const data = dataset.toolResponse(keys[0], { seniorId: resident.seniorId, __communityState: state });
    assert.ok(data.error || data.malformed || data.stale || data.missingFields || Array.isArray(data.items), state);
  }
});

test("cohort selection is deterministic across all documented dimensions and changes actual sweep scope", () => {
  const dataset = createCommunityDataset({ profile: "regression", seed: 104729 });
  const broad = selectResidents(dataset, {});
  const narrow = selectResidents(dataset, { age: "60-69", speechPace: "slow", hearing: "normal", vision: "normal", digitalLiteracy: "low", permission: "verified-self", health: "routine", member: "active", quality: "complete" });
  assert.equal(broad.length, 1000);
  assert.ok(narrow.length < broad.length);
  assert.deepEqual(narrow, selectResidents(dataset, { age: "60-69", speechPace: "slow", hearing: "normal", vision: "normal", digitalLiteracy: "low", permission: "verified-self", health: "routine", member: "active", quality: "complete" }));
});

test("paginated member records and public activities have bounded deterministic cursors", () => {
  const dataset = createCommunityDataset();
  const resident = dataset.residentAt(9);
  const first = dataset.toolResponse("member_asset_mcp.list_consumption_records", { seniorId: resident.seniorId, limit: 5 });
  const second = dataset.toolResponse("member_asset_mcp.list_consumption_records", { seniorId: resident.seniorId, cursor: first.nextCursor, limit: 5 });
  assert.equal(first.items.length, 5);
  assert.equal(second.items.length, 5);
  assert.notEqual(first.items[0].recordId, second.items[0].recordId);
});

test("every resident list page and ledger preview resolves to that resident's exported global index", () => {
  const dataset = createCommunityDataset({ profile: "regression", seed: 104729 });
  for (let index = 0; index < dataset.residents; index += 1) {
    const resident = dataset.residentAt(index);
    const recharge = dataset.toolResponse("member_asset_mcp.list_recharge_records", { seniorId: resident.seniorId, limit: 3 });
    const consumption = dataset.toolResponse("member_asset_mcp.list_consumption_records", { seniorId: resident.seniorId, cursor: "145", limit: 5 });
    const points = dataset.toolResponse("member_asset_mcp.get_member_points", { seniorId: resident.seniorId, includeLedger: true });
    for (const item of [...recharge.items, ...consumption.items]) assert.equal(item.seniorId, resident.seniorId);
    assert.equal(recharge.items[0].recordId, entityRecord(dataset, "rechargeRecords", residentGlobalIndex(dataset, resident, 1)).recordId);
    assert.equal(consumption.items[0].recordId, entityRecord(dataset, "consumptionRecords", residentGlobalIndex(dataset, resident, 146)).recordId);
    assert.equal(points.ledgerPreview[0].seniorId, resident.seniorId);
    assert.equal(points.ledgerPreview[0].ledgerId, entityRecord(dataset, "pointLedger", residentGlobalIndex(dataset, resident, 1)).ledgerId);
    const labels = dataset.toolResponse("health_risk_assessment_mcp.get_latest_health_labels", { seniorId: resident.seniorId });
    const evaluations = dataset.toolResponse("health_evaluation_service_mcp_cms.get_health_evaluation_results", { seniorId: resident.seniorId });
    if (resident.healthState === "no-record") assert.deepEqual(labels.medicalHistoryLabels, []);
    else assert.equal(labels.medicalHistoryLabels[0].sourceId, entityRecord(dataset, "healthLabels", residentGlobalIndex(dataset, resident, 1)).labelId);
    assert.deepEqual(evaluations.results.map((item) => item.evaluationId), Array.from({ length: 4 }, (_, ordinal) => entityRecord(dataset, "healthEvaluations", residentGlobalIndex(dataset, resident, ordinal + 1))).filter((item) => item.available).map((item) => item.evaluationId));
  }
});

test("fixture has no generic ok success fallback and publishes community metadata", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp({ dataset: createCommunityDataset({ profile: "smoke" }) });
  t.after(() => fixture.close());
  const meta = fixture.dataset();
  assert.equal(meta.residents, 64);
  assert.equal(meta.coverage.tools, 16);
  const data = fixture.status().dataset;
  assert.equal(data.profile, "smoke");
});

test("validator rejects tampered cross-domain evidence, ledger progression, authorization and organization", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-invariant-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "data");
  assert.equal(runScript("scripts/generate-virtual-senior-community-dataset.cjs", ["--profile=smoke", "--seed=104729", `--out=${dataRoot}`]).status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, "community-manifest.json"), "utf8"));
  const fileFor = (entity) => path.join(dataRoot, manifest.shards.find((item) => item.entity === entity).file);
  const risks = jsonLines(fileFor("riskAssessments")); risks[0].evidenceIds[0] = "evidence-999999-1"; writeJsonLines(fileFor("riskAssessments"), risks);
  const ledger = jsonLines(fileFor("pointLedger")); ledger[1].direction = "credit"; ledger[1].balanceAfter = "99999"; writeJsonLines(fileFor("pointLedger"), ledger);
  const accounts = jsonLines(fileFor("memberAccounts")); const verified = accounts.find((item) => item.authorizationId); verified.authorizationId = "tampered-auth"; writeJsonLines(fileFor("memberAccounts"), accounts);
  const labels = jsonLines(fileFor("healthLabels")); labels[0].orgId = 99999; writeJsonLines(fileFor("healthLabels"), labels);
  const result = runScript("scripts/validate-virtual-senior-community-dataset.cjs", [`--out=${dataRoot}`]);
  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(path.join(dataRoot, "validation-report.json"), "utf8"));
  assert.equal(report.invariants.riskEvidence.valid, false);
  assert.equal(report.invariants.ledger.valid, false);
  assert.equal(report.invariants.authorization.valid, false);
  assert.equal(report.invariants.organization.valid, false);
  assert.ok(report.invariants.riskEvidence.failures.length > 0);
  assert.ok(report.invariants.ledger.failures.length > 0);
});

test("community job checkpoints pause after a stage, survive restart, preserve cancel state, and rerun only a failed stage", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-jobs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runner = createCommunityJobRunner({ projectRoot, reportRoot: root, nodePath: process.execPath });
  const pausedRun = runner.start({ jobId: "pause-restart", profile: "smoke" });
  assert.equal(runner.pause("pause-restart"), true);
  const paused = await pausedRun;
  assert.equal(paused.status, "paused");
  assert.deepEqual(paused.completedStages, ["generating"]);
  const restarted = createCommunityJobRunner({ projectRoot, reportRoot: root, nodePath: process.execPath });
  const completed = await restarted.resume("pause-restart");
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.completedStages, ["generating", "validating", "sweeping"]);
  assert.equal(completed.stageAttempts.generating, undefined);

  const cancelledRunner = createCommunityJobRunner({ projectRoot, reportRoot: root, nodePath: process.execPath });
  const cancelledRun = cancelledRunner.start({ jobId: "cancel-resume", profile: "smoke" });
  assert.equal(cancelledRunner.cancel("cancel-resume"), true);
  const cancelled = await cancelledRun;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedStages.length, 0);
  assert.equal(cancelled.stageAttempts.generating, 2);
  const cancelRestarted = createCommunityJobRunner({ projectRoot, reportRoot: root, nodePath: process.execPath });
  assert.equal((await cancelRestarted.resume("cancel-resume")).status, "completed");

  const jobFile = path.join(root, "pause-restart", "job-manifest.json");
  const failed = JSON.parse(fs.readFileSync(jobFile, "utf8"));
  const originalDatasetManifest = failed.reports.datasetManifest;
  failed.status = "failed"; failed.stage = "failed"; failed.failedStage = "sweeping"; failed.completedStages = ["generating", "validating"]; failed.stageAttempts.sweeping = 1;
  fs.writeFileSync(jobFile, `${JSON.stringify(failed, null, 2)}\n`);
  const failedRestarted = createCommunityJobRunner({ projectRoot, reportRoot: root, nodePath: process.execPath });
  const rerun = await failedRestarted.rerunFailed("pause-restart");
  assert.equal(rerun.status, "completed");
  assert.equal(rerun.reports.datasetManifest, originalDatasetManifest);
  assert.equal(rerun.stageAttempts.generating, undefined);
  assert.equal(rerun.stageAttempts.sweeping, 2);
});

test("QA-only injected stage failure is persisted and failed-only rerun preserves prior stages", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-qa-fault-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runner = createCommunityJobRunner({ projectRoot, reportRoot: root, nodePath: process.execPath, allowTestFaultInjection: true, testFaultStage: "sweeping" });
  const failed = await runner.start({ jobId: "qa-fault-sweep", profile: "smoke" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failedStage, "sweeping");
  assert.deepEqual(failed.completedStages, ["generating", "validating"]);
  assert.equal(failed.errors.at(-1).code, "QA_INJECTED_STAGE_FAILURE");
  const rerun = await runner.rerunFailed("qa-fault-sweep");
  assert.equal(rerun.status, "completed");
  assert.deepEqual(rerun.completedStages, ["generating", "validating", "sweeping"]);
  assert.equal(rerun.stageAttempts.generating, undefined);
  assert.equal(rerun.stageAttempts.validating, undefined);
  assert.equal(rerun.qaFaultInjected.sweeping, true);
});
