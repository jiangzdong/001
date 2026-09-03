import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fixtureModule from "../electron/harness/virtual-senior-fixture-mcp.cjs";
import orchestratorModule from "../electron/harness/virtual-senior-orchestrator.cjs";
import analysisModule from "../electron/harness/virtual-senior-analysis.cjs";
import catalogModule from "../electron/harness/virtual-senior-catalog.cjs";
import variantModule from "../electron/harness/virtual-senior-variant-artifacts.cjs";

const { createVirtualSeniorFixtureMcp } = fixtureModule;
const { createVirtualSeniorOrchestrator } = orchestratorModule;
const { analyzeVirtualSeniorReports } = analysisModule;
const { listVirtualSeniorCatalog } = catalogModule;
const { createDeepSeekVariantCandidateGenerator, createVirtualSeniorArtifactStore, createVirtualSeniorVariantGenerator } = variantModule;

function generationRequest(overrides = {}) {
  return {
    dataClassification: "synthetic-test-only",
    personaId: "senior-fixed-001",
    scenarioId: "PUB-ACTIVITY-001",
    prompt: "围绕固定场景生成一句口语化测试表达；只返回 Schema 字段。",
    promptVersion: "variant-v1",
    provider: "test-stub",
    model: "fixture-model-v1",
    seed: 104729,
    temperature: 0.2,
    top_p: 0.8,
    ...overrides,
  };
}

function validCandidate(overrides = {}) {
  return {
    dataClassification: "synthetic-test-only",
    synthetic: true,
    personaId: "senior-fixed-001",
    scenarioId: "PUB-ACTIVITY-001",
    turns: [{ utterance: "今天都有哪些活动呀？" }],
    ...overrides,
  };
}

test("virtual senior catalog exposes synthetic personas without actor credentials", () => {
  const catalog = listVirtualSeniorCatalog();
  assert.equal(catalog.personas.length, 3);
  assert.equal(catalog.scenarios.length, 10);
  assert.ok(catalog.personas.every((persona) => persona.synthetic === true));
  assert.ok(catalog.personas.every((persona) => !("actorFixture" in persona)));
  assert.ok(catalog.scenarios.every((scenario) => !("expected" in scenario)));
});

test("fixture MCP uses real Streamable HTTP and marks synthetic facts", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const config = fixture.serverConfigs().station_content_mcp;
  const initialize = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(initialize.ok, true);
  assert.match(initialize.headers.get("mcp-session-id"), /^fixture-/);
  const call = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_station_activities", arguments: { orgId: 1 } } }),
  });
  const payload = await call.json();
  assert.equal(payload.result.structuredContent.source, "test-fixture");
  assert.ok(payload.result.structuredContent.factIds.length > 0);
});

test("orchestrator runs fixed cases through Harness and emits hard assertions", async (t) => {
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(() => fixture.close());
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18" });
  const activity = await orchestrator.runCase({ scenarioId: "PUB-ACTIVITY-001", runId: "activity" });
  assert.equal(activity.result, "PASS");
  assert.deepEqual(activity.observed.actualTools, ["station_content_mcp.list_station_activities"]);
  assert.equal(activity.environment.source, "test-fixture");
  const crossSubject = await orchestrator.runCase({ scenarioId: "MEMBER-CROSS-001", runId: "cross-subject" });
  assert.equal(crossSubject.result, "PASS");
  assert.equal(crossSubject.observed.status, "denied");
  assert.deepEqual(crossSubject.observed.actualTools, []);
});

test("batch analysis aggregates coverage, failures, latency and optimization advice", () => {
  const reports = [
    { result: "PASS", category: "路由", scenarioId: "A", personaId: "P1", durationMs: 20, assertions: [], observed: {} },
    { result: "FAIL", category: "MCP", scenarioId: "B", personaId: "P2", durationMs: 80, assertions: [{ id: "FACT_IDS_PRESENT", result: "FAIL" }], observed: { errorCode: "MCP_HTTP_ERROR" } },
  ];
  const analysis = analyzeVirtualSeniorReports(reports, { passRate: 80 });
  assert.equal(analysis.total, 2);
  assert.equal(analysis.passRate, 50);
  assert.equal(analysis.coverage.scenarios, 2);
  assert.equal(analysis.duration.p95Ms, 80);
  assert.equal(analysis.failureClusters.MCP, 1);
  assert.equal(analysis.errorCodes.MCP_HTTP_ERROR, 1);
  assert.equal(analysis.failureAssertions.FACT_IDS_PRESENT, 1);
  assert.equal(analysis.trend.deltaPassRate, -30);
  assert.match(analysis.recommendations[0].action, /MCP/);
});

test("batch history persists across orchestrator restarts for trend comparison", async (t) => {
  const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-history-"));
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(async () => {
    await fixture.close();
    fs.rmSync(reportRoot, { recursive: true, force: true });
  });
  const first = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18", reportRoot });
  const initialBatch = await first.runBatch({ batchId: "batch-history-1", scenarioIds: ["PUB-ACTIVITY-001"] });
  assert.equal(initialBatch.reportDirectory, path.join(reportRoot, "1.5.18", "batch-history-1"));

  const restarted = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18", reportRoot });
  assert.equal(restarted.latest().batchId, "batch-history-1");
  const nextBatch = await restarted.runBatch({ batchId: "batch-history-2", scenarioIds: ["HEALTH-GENERAL-001"] });
  assert.equal(nextBatch.analysis.trend.previousPassRate, initialBatch.analysis.passRate);
  assert.equal(nextBatch.analysis.trend.deltaPassRate, 0);
});

test("batch manifest checkpoints pause, restart-resume, and failed-only rerun", async (t) => {
  const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-checkpoint-"));
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(async () => { await fixture.close(); fs.rmSync(reportRoot, { recursive: true, force: true }); });
  const first = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.19", reportRoot });
  const active = first.runBatch({ batchId: "checkpoint-1", scenarioIds: ["PUB-ACTIVITY-001", "HEALTH-GENERAL-001"] });
  assert.equal(first.pause("checkpoint-1"), true);
  const paused = await active;
  assert.equal(paused.status, "paused");
  assert.ok(fs.existsSync(path.join(reportRoot, "1.5.19", "checkpoint-1", "batch-manifest.json")));
  const restarted = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.19", reportRoot });
  const resumed = await restarted.resume("checkpoint-1");
  assert.equal(resumed.status, "completed");
  const retry = await restarted.rerunFailed("checkpoint-1");
  assert.equal(retry.cohort.type, "rerun-failed");
});

test("variant generation rejects unknown fields and unauthorized enums with a stable error", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createVirtualSeniorArtifactStore({ root });
  const unknownField = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => ({ ...validCandidate(), allowedTools: ["member_asset_mcp.get_member_points"] }) });
  await assert.rejects(unknownField.generate(generationRequest()), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("unknown property")));
  const unauthorizedAuth = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => ({ ...validCandidate(), authLevel: "admin" }) });
  await assert.rejects(unauthorizedAuth.generate(generationRequest({ seed: 104731 })), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("unknown property")));
  const unauthorizedEnum = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate({ scenarioId: "production-admin-override" }) });
  await assert.rejects(unauthorizedEnum.generate(generationRequest({ seed: 104730 })), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("allowlist")));
  await assert.rejects(unknownField.generate(generationRequest({ personaId: "real-person-001", seed: 104732 })), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("allowlist")));
  const missingClassification = generationRequest({ seed: 104733 });
  delete missingClassification.dataClassification;
  await assert.rejects(unknownField.generate(missingClassification), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("dataClassification")));
  await assert.rejects(unknownField.generate(generationRequest({ dataClassification: "production", seed: 104734 })), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("const mismatch")));
  const forgedCandidate = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate({ dataClassification: "production" }) });
  await assert.rejects(forgedCandidate.generate(generationRequest({ seed: 104735 })), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("const mismatch")));
});

test("DeepSeek candidate adapter sends schema-bounded synthetic input without persisting its key", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-provider-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requestBody;
  const secret = "sk-test-secret-1234567890";
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(validCandidate()) } }] }) };
  };
  const store = createVirtualSeniorArtifactStore({ root });
  const generateCandidate = createDeepSeekVariantCandidateGenerator({ getKey: () => secret, fetchImpl });
  const generator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate });
  await assert.rejects(generator.generate(generationRequest({ provider: "openai", model: "deepseek-test" })), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("provider adapter")));
  assert.equal(requestBody, undefined);
  const artifact = await generator.generate(generationRequest({ provider: "deepseek", model: "deepseek-test" }));
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(requestBody.seed, 104729);
  assert.match(requestBody.messages[0].content, /additionalProperties/);
  assert.doesNotMatch(JSON.stringify(artifact), new RegExp(secret));
  assert.doesNotMatch(fs.readFileSync(path.join(root, "artifacts", `${artifact.artifactHash.slice(7)}.json`), "utf8"), new RegExp(secret));
});

test("same generation input reuses one deterministic immutable artifact", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-deterministic-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createVirtualSeniorArtifactStore({ root });
  let calls = 0;
  const generator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => { calls += 1; return validCandidate(); } });
  const first = await generator.generate(generationRequest());
  const second = await generator.generate(generationRequest());
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(first.dataClassification, "synthetic-test-only");
  assert.equal(first.artifactHash, "sha256:ace5d2c3d402f9c2ce5a8dadaf86f91b365918c76475b737be854b1c7044a70f");
  assert.equal(first.candidateHash, "sha256:38f5701cc13442766553b988b36c1f984b4e93336ab35f791a5a50c7b7361a10");
  assert.equal(first.generation.prompt, generationRequest().prompt);
  assert.match(first.generation.promptHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.generation.schemaHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.generation.seed, 104729);
  assert.equal(first.generation.temperature, 0.2);
  assert.equal(first.generation.top_p, 0.8);
  const artifactPath = path.join(root, "artifacts", `${first.artifactHash.slice(7)}.json`);
  assert.equal(fs.statSync(artifactPath).mode & 0o777, 0o400);
  assert.equal(store.get(first.artifactHash).artifactHash, first.artifactHash);
  const { artifactHash: _artifactHash, dataClassification: _classification, ...missingClassificationPayload } = first;
  assert.throws(() => store.put(missingClassificationPayload), (error) => error.code === "GENERATION_SCHEMA_REJECTED");
});

test("orchestrator requires explicit generated-artifact mode before generation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-generate-mode-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createVirtualSeniorArtifactStore({ root });
  const variantGenerator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate() });
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: { status: () => ({ available: true }) }, artifactStore: store, variantGenerator });
  assert.throws(() => orchestrator.generateVariant(generationRequest()), (error) => error.code === "TEST_MODE_REQUIRED");
  const artifact = await orchestrator.generateVariant({ testMode: "generated-artifact", ...generationRequest() });
  assert.equal(artifact.dataClassification, "synthetic-test-only");
  assert.equal(artifact.generation.provider, "test-stub");
});

test("artifact hash verification detects external mutation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createVirtualSeniorArtifactStore({ root });
  const generator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate() });
  const artifact = await generator.generate(generationRequest());
  const artifactPath = path.join(root, "artifacts", `${artifact.artifactHash.slice(7)}.json`);
  fs.chmodSync(artifactPath, 0o600);
  const mutated = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  mutated.candidate.turns[0].utterance = "被外部篡改";
  fs.writeFileSync(artifactPath, JSON.stringify(mutated));
  assert.throws(() => store.get(artifact.artifactHash), (error) => error.code === "ARTIFACT_HASH_MISMATCH");
});

test("variant generation rejects direct PII and secret-shaped content", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-sensitive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createVirtualSeniorArtifactStore({ root });
  const generator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate({ turns: [{ utterance: "请联系我，手机号是13800138000" }] }) });
  await assert.rejects(generator.generate(generationRequest()), (error) => error.code === "GENERATION_SCHEMA_REJECTED" && error.details.some((detail) => detail.includes("PII")));
});

test("generated artifact mode preserves fixed hard oracle and cannot self-approve", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-hard-oracle-"));
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(async () => {
    await fixture.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = createVirtualSeniorArtifactStore({ root });
  const generator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate({ scenarioId: "HEALTH-GENERAL-001", turns: [{ utterance: "帮我查询会员积分" }] }) });
  const artifact = await generator.generate(generationRequest({ scenarioId: "HEALTH-GENERAL-001" }));
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18", artifactStore: store });
  await assert.rejects(orchestrator.runCase({ scenarioId: "HEALTH-GENERAL-001", artifactHash: artifact.artifactHash }), (error) => error.code === "TEST_MODE_REQUIRED");
  const report = await orchestrator.runCase({ testMode: "generated-artifact", artifactHash: artifact.artifactHash, runId: "hard-oracle" });
  assert.equal(report.result, "FAIL");
  assert.equal(report.testMode, "generated-artifact");
  assert.equal(report.generation.artifactHash, artifact.artifactHash);
  assert.equal(report.assertions.find((item) => item.id === "SCENARIO_MATCH").result, "FAIL");
});

test("generated artifact batch preserves generation metadata and trend dimensions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-senior-generated-batch-"));
  const fixture = createVirtualSeniorFixtureMcp();
  await fixture.start();
  t.after(async () => {
    await fixture.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = createVirtualSeniorArtifactStore({ root: path.join(root, "artifact-store") });
  const generator = createVirtualSeniorVariantGenerator({ artifactStore: store, generateCandidate: async () => validCandidate() });
  const artifact = await generator.generate(generationRequest());
  const orchestrator = createVirtualSeniorOrchestrator({ fixtureMcp: fixture, appVersion: "1.5.18", reportRoot: path.join(root, "reports"), artifactStore: store });
  const first = await orchestrator.runBatch({ batchId: "generated-1", testMode: "generated-artifact", artifactHashes: [artifact.artifactHash] });
  const second = await orchestrator.runBatch({ batchId: "generated-2", testMode: "generated-artifact", artifactHashes: [artifact.artifactHash] });
  assert.equal(first.analysis.generation.artifactCount, 1);
  assert.equal(first.analysis.generation.byModel["test-stub/fixture-model-v1"], 1);
  assert.equal(first.analysis.generation.byPromptHash[artifact.generation.promptHash], 1);
  assert.equal(first.analysis.generation.bySchemaHash[artifact.generation.schemaHash], 1);
  assert.equal(first.analysis.generation.bySeed["104729"], 1);
  assert.deepEqual(first.artifactHashes, [artifact.artifactHash]);
  assert.equal(second.analysis.trend.previousPassRate, first.analysis.passRate);
  assert.equal(second.analysis.generation.trend.previousArtifactCount, 1);
  assert.equal(second.analysis.generation.trend.artifactCountDelta, 0);
});

test("test console is startup-gated and avoids single-side status strokes", async () => {
  const [mainSource, preloadSource, appSource, styles] = await Promise.all([
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../src/StationAdvisorApp.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/station-advisor.css", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /process\.argv\.includes\("--virtual-senior-test"\)/);
  assert.match(mainSource, /virtualSeniorEnabled \? \["--virtual-senior-test"\] : \[\]/);
  assert.match(preloadSource, /virtualSeniorAvailable: process\.argv\.includes\("--virtual-senior-test"\)/);
  assert.match(mainSource, /ipcMain\.handle\("virtual-senior:generate-variant"/);
  assert.match(preloadSource, /generateVirtualSeniorVariant: \(payload\) => ipcRenderer\.invoke\("virtual-senior:generate-variant"/);
  assert.match(appSource, /window\.kioskBridge\?\.virtualSeniorAvailable/);
  const consoleStyles = styles.slice(styles.indexOf("\/\* Virtual-senior QA console"), styles.indexOf(".advisor-header {"));
  assert.doesNotMatch(consoleStyles, /border-(?:left|right)\s*:/);
  assert.match(consoleStyles, /\.virtual-senior-metric[^}]*background:/);
  assert.match(consoleStyles, /\.virtual-senior-footer > button\.is-cancel/);
});
