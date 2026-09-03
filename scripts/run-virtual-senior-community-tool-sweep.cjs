"use strict";
// Protocol-level contract sweep. This intentionally tests Fixture MCP only;
// it does not represent full Harness, LLM, ASR/TTS, Viseme or media coverage.
const fs = require("node:fs");
const path = require("node:path");
const { MCP_TOOL_CATALOG } = require("../electron/harness/mcp-tools.cjs");
const { CONTRACT_STATES, SUCCESS_CONTRACTS, createCommunityDataset, selectResidents, validateSuccessContract } = require("../electron/harness/virtual-senior-community-dataset.cjs");
const { createVirtualSeniorFixtureMcp } = require("../electron/harness/virtual-senior-fixture-mcp.cjs");
function arg(name, fallback) { const item = process.argv.find((value) => value.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : fallback; }
function cohortArg() { try { return JSON.parse(arg("cohort", "{}")); } catch { throw new Error("invalid --cohort JSON"); } }
function argumentsFor(key, seniorId, state) {
  const common = { seniorId, tenantId: 10001, orgId: 10001, serviceId: "meal_service", captureToken: "synthetic-capture", consentId: "synthetic-consent", operatorId: "qa-operator", action: "health:read:self", authorizationId: `community-authz-${seniorId}`, idempotencyKey: `sweep-${state}`, riskAssessmentDraft: { level: "routine", evidence: ["synthetic"] }, signsTypeList: [1, 2], types: ["vital"], query: "助餐", limit: 20, __communityState: state };
  if (key.endsWith("match_face_to_senior")) delete common.seniorId;
  return common;
}
function percentile(samples, fraction) { if (!samples.length) return 0; const sorted = [...samples].sort((a, b) => a - b); return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))].toFixed(3)); }
function stateContract(key, state, content, rpcError) {
  const publicTool = key.includes("station_") || key.includes("get_station_service") || key.includes("list_station_services");
  const errorCodes = { timeout: "TOOL_TIMEOUT", "service-error": "MCP_SERVICE_ERROR", "invalid-input": "INVALID_ARGUMENT", "cross-tenant": "CROSS_TENANT_DENIED", "auth-required": "AUTH_REQUIRED", denied: "POLICY_DENY" };
  if (state === "unknown-id") return { valid: rpcError === (publicTool ? "RESOURCE_NOT_FOUND" : "SENIOR_NOT_FOUND"), expected: publicTool ? "RESOURCE_NOT_FOUND" : "SENIOR_NOT_FOUND" };
  if (errorCodes[state]) return { valid: rpcError === errorCodes[state], expected: errorCodes[state] };
  if (state === "empty") return { valid: Array.isArray(content?.items) && content.items.length === 0 && content.total === 0 && content.nextCursor === null, expected: "empty-list" };
  if (state === "missing") return { valid: Array.isArray(content?.missingFields) && content.missingFields.length > 0, expected: "missingFields" };
  if (state === "stale") { const timestamp = content?.generatedAt || content?.updatedAt; return { valid: content?.stale === true && typeof timestamp === "string" && Date.parse(timestamp) < Date.parse("2025-01-01T00:00:00.000Z"), expected: "stale-old-timestamp" }; }
  if (state === "contract-corrupt") return { valid: content?.malformed === true, expected: "malformed" };
  const contract = validateSuccessContract(key, content);
  return { valid: contract.valid, expected: "success-contract", missing: contract.missing, semanticFailures: contract.semanticFailures };
}
async function request(url, body, session) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) });
  return { payload: (await response.text()) ? JSON.parse(await (async () => "")()) : null };
}
async function jsonRpc(url, body, session) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) });
  const text = await response.text(); return { status: response.status, session: response.headers.get("mcp-session-id") || session, payload: text ? JSON.parse(text) : null };
}
async function main() {
  const profile = arg("profile", "community-full"); const seed = Number(arg("seed", "104729"));
  const out = path.resolve(arg("out", path.join(process.cwd(), "QA-EXTERNAL", "virtual-senior-community", `tool-sweep-${profile}-${seed}`)));
  if (fs.existsSync(out)) throw new Error(`refuse to overwrite existing output: ${out}`); fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const dataset = createCommunityDataset({ profile, seed }); const cohort = cohortArg(); const fixture = createVirtualSeniorFixtureMcp({ dataset }); const origin = await fixture.start();
  const resident = dataset.residentAt(0); const serverSessions = {}; const protocol = []; const matrix = [];
  try {
    for (const server of [...new Set(MCP_TOOL_CATALOG.map(([name]) => name))]) {
      const url = `${origin}?server=${encodeURIComponent(server)}`;
      const initialized = await jsonRpc(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "community-sweep", version: "1.0.0" } } });
      const session = initialized.session; const notify = await jsonRpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, session); const listed = await jsonRpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list" }, session);
      serverSessions[server] = { url, session }; protocol.push({ server, initialize: initialized.status, initialized: notify.status, toolCount: listed.payload?.result?.tools?.length || 0 });
      if (initialized.status !== 200 || notify.status !== 202 || !Array.isArray(listed.payload?.result?.tools)) throw new Error(`protocol failed for ${server}`);
    }
    let id = 10;
    for (const [server, tool] of MCP_TOOL_CATALOG) for (const state of CONTRACT_STATES) {
      const key = `${server}.${tool}`; const peer = serverSessions[server];
      const response = await jsonRpc(peer.url, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: tool, arguments: argumentsFor(key, resident.seniorId, state) } }, peer.session);
      const content = response.payload?.result?.structuredContent; const rpcError = response.payload?.error?.data?.code || null;
      const semantic = stateContract(key, state, content, rpcError);
      const valid = response.status === 200 && semantic.valid;
      matrix.push({ key, state, status: response.status, rpcError, responseKind: content?.malformed ? "contract-corrupt" : content?.stale ? "stale" : content?.missingFields ? "missing" : Array.isArray(content?.items) ? "list" : "structured", expected: semantic.expected, missing: semantic.missing || [], semanticFailures: semantic.semanticFailures || [], valid });
    }
    const call = async (server, tool, args) => { const peer = serverSessions[server]; return jsonRpc(peer.url, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: tool, arguments: args } }, peer.session); };
    const member = serverSessions.member_asset_mcp;
    const health = serverSessions.health_risk_assessment_mcp; const save = async (draft) => jsonRpc(health.url, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "save_risk_assessment_result", arguments: { ...argumentsFor("health_risk_assessment_mcp.save_risk_assessment_result", resident.seniorId, "success"), idempotencyKey: "protocol-replay", riskAssessmentDraft: draft } } }, health.session);
    const saved = await save({ level: "routine" }); const replayed = await save({ level: "routine" }); const conflict = await save({ level: "attention" });
    const pageCheck = async (server, tool, total, scoped) => { const key = `${server}.${tool}`; const base = argumentsFor(key, resident.seniorId, "success"); const first = await call(server, tool, { ...base, limit: 5 }); const repeat = await call(server, tool, { ...base, cursor: "5", limit: 5 }); const repeated = await call(server, tool, { ...base, cursor: "5", limit: 5 }); const last = await call(server, tool, { ...base, cursor: String(Math.max(0, total - 5)), limit: 5 }); const empty = await call(server, tool, { ...base, cursor: String(total), limit: 5 }); const invalid = await call(server, tool, { ...base, cursor: "bad", limit: 5 }); const data = (response) => response.payload?.result?.structuredContent; const firstData = data(first); const lastData = data(last); const emptyData = data(empty); const repeatedData = data(repeat); const samePage = JSON.stringify(repeatedData?.items) === JSON.stringify(data(repeated)?.items); const scopedItems = !scoped || (firstData?.items || []).every((item) => item.seniorId === resident.seniorId) && (repeatedData?.items || []).every((item) => item.seniorId === resident.seniorId) && (lastData?.items || []).every((item) => item.seniorId === resident.seniorId); const valid = firstData?.items?.length === 5 && firstData?.total === total && lastData?.items?.length === Math.min(5, total) && lastData?.nextCursor === null && emptyData?.items?.length === 0 && emptyData?.nextCursor === null && samePage && invalid.payload?.error?.data?.code === "INVALID_CURSOR" && scopedItems; return { first: firstData?.items?.length || 0, last: lastData?.items?.length || 0, empty: emptyData?.items?.length || 0, repeatedCursorStable: samePage, invalidCursor: invalid.payload?.error?.data?.code || null, scopedItems, valid }; };
    const pagination = { byTool: { "member_asset_mcp.list_recharge_records": await pageCheck("member_asset_mcp", "list_recharge_records", 12, true), "member_asset_mcp.list_consumption_records": await pageCheck("member_asset_mcp", "list_consumption_records", 150, true), "station_content_mcp.list_station_activities": await pageCheck("station_content_mcp", "list_station_activities", 1500, false) } };
    pagination.valid = Object.values(pagination.byTool).every((item) => item.valid);
    const idempotency = { replayed: replayed.payload?.result?.structuredContent?.replayed === true, sameResult: saved.payload?.result?.structuredContent?.resultId === replayed.payload?.result?.structuredContent?.resultId, conflict: conflict.payload?.error?.data?.code, valid: replayed.payload?.result?.structuredContent?.replayed === true && conflict.payload?.error?.data?.code === "IDEMPOTENCY_CONFLICT" };
    // The protocol matrix above proves streamable MCP behaviour. This sweep is
    // intentionally deterministic/on-demand but still calls every Tool for
    // every resident; it is not a sampled coverage claim.
    const selectedResidents = selectResidents(dataset, cohort);
    const sweepStarted = process.hrtime.bigint(); const residentSweep = { profileResidents: dataset.residents, cohort, residents: selectedResidents.length, expected: selectedResidents.length * MCP_TOOL_CATALOG.length, executed: 0, failures: [], byTool: {} };
    for (const senior of selectedResidents) {
      for (const [server, tool] of MCP_TOOL_CATALOG) {
        const key = `${server}.${tool}`;
        const started = process.hrtime.bigint(); const data = dataset.toolResponse(key, { ...argumentsFor(key, senior.seniorId, "success"), idempotencyKey: `resident-sweep-${senior.seniorId}` }); const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        residentSweep.executed += 1;
        residentSweep.byTool[key] ||= { attempted: 0, passed: 0, failed: 0, samples: [] };
        residentSweep.byTool[key].attempted += 1;
        residentSweep.byTool[key].samples.push(elapsedMs);
        const contract = validateSuccessContract(key, data);
        const validSuccess = Boolean(contract.valid && !data?.error && !data?.malformed);
        if (validSuccess) residentSweep.byTool[key].passed += 1;
        else { residentSweep.byTool[key].failed += 1; if (residentSweep.failures.length < 100) residentSweep.failures.push({ seniorId: senior.seniorId, key, error: data?.error?.code || "CONTRACT_INVALID", missing: contract.missing, semanticFailures: contract.semanticFailures }); }
      }
    }
    const elapsedMs = Number(process.hrtime.bigint() - sweepStarted) / 1e6;
    for (const item of Object.values(residentSweep.byTool)) { item.p50Ms = percentile(item.samples, .5); item.p95Ms = percentile(item.samples, .95); item.maxMs = Number(Math.max(...item.samples).toFixed(3)); delete item.samples; }
    residentSweep.elapsedMs = Number(elapsedMs.toFixed(3)); residentSweep.throughputPerSecond = Number((residentSweep.executed / Math.max(elapsedMs / 1000, .001)).toFixed(2));
    residentSweep.valid = residentSweep.executed === residentSweep.expected && residentSweep.failures.length === 0;
    const timeWindows = [1, 7, 30, 90, 180].map((timeType) => { const data = dataset.toolResponse("health_risk_assessment_mcp.get_indicator_evidence", { ...argumentsFor("health_risk_assessment_mcp.get_indicator_evidence", resident.seniorId, "success"), timeType }); return { timeType, timeWindow: data.timeWindow, valid: Array.isArray(data.evidence) && data.evidence.length > 0 }; });
    const dimensions = {
      resident: { profileResidents: dataset.residents, selectedResidents: selectedResidents.length },
      entity: dataset.entityCounts,
      field: Object.fromEntries(Object.entries(SUCCESS_CONTRACTS).map(([key, fields]) => [key, fields.length])),
      mcp: Object.fromEntries([...new Set(MCP_TOOL_CATALOG.map(([server]) => server))].map((server) => [server, MCP_TOOL_CATALOG.filter(([item]) => item === server).length])),
      tool: residentSweep.byTool,
      state: Object.fromEntries(CONTRACT_STATES.map((state) => [state, matrix.filter((item) => item.state === state && item.valid).length])),
      permission: Object.fromEntries(["auth-required", "denied", "cross-tenant"].map((state) => [state, matrix.filter((item) => item.state === state && item.valid).length])),
      pagination,
      timeWindow: timeWindows,
      cohort,
      latency: { protocolCases: matrix.length, residentCalls: residentSweep.executed, elapsedMs: residentSweep.elapsedMs, throughputPerSecond: residentSweep.throughputPerSecond, perTool: Object.fromEntries(Object.entries(residentSweep.byTool).map(([key, item]) => [key, { p50Ms: item.p50Ms, p95Ms: item.p95Ms, maxMs: item.maxMs }])) },
      error: Object.fromEntries(matrix.filter((item) => item.rpcError).map((item) => [item.rpcError, (matrix.filter((peer) => peer.rpcError === item.rpcError).length)])),
      failureCluster: residentSweep.failures,
    };
    const report = { reportVersion: "1.4.0", scope: "fixture-mcp-protocol-and-community-resident-sweep", excludedLayers: ["full-harness-community", "llm", "asr", "tts", "viseme", "media"], profile, seed, cohort, residentId: resident.seniorId, protocol, matrix, pagination, idempotency, residentSweep, dimensions, totals: { expected: MCP_TOOL_CATALOG.length * CONTRACT_STATES.length, executed: matrix.length, valid: matrix.filter((item) => item.valid).length }, valid: matrix.every((item) => item.valid) && pagination.valid && idempotency.valid && residentSweep.valid && timeWindows.every((item) => item.valid) };
    fs.writeFileSync(path.join(out, "tool-sweep-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ out, valid: report.valid, cases: report.totals.executed, expected: report.totals.expected, residentCalls: residentSweep.executed })}\n`); if (!report.valid) process.exitCode = 1;
  } finally { await fixture.close(); }
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
