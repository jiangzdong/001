"use strict";

// This module is deliberately deterministic and on-demand.  The community-full
// manifest represents the complete synthetic population without materialising
// millions of records in the renderer or production bundle.
const crypto = require("node:crypto");
const { MCP_TOOL_CATALOG } = require("./mcp-tools.cjs");

const DATASET_VERSION = "community-v1.0.0";
const GENERATOR_VERSION = "community-generator-v1.3.0";
const DATA_CLASSIFICATION = "synthetic-test-only";
const PROFILES = Object.freeze({ smoke: 64, regression: 1000, "community-full": 10000, stress: 50000 });
const CONTRACT_STATES = Object.freeze(["success", "empty", "missing", "stale", "invalid-input", "unknown-id", "cross-tenant", "auth-required", "denied", "timeout", "service-error", "contract-corrupt"]);
const SERVER_ORDER = Object.freeze([...new Set(MCP_TOOL_CATALOG.map(([server]) => server))]);
const AGE_BANDS = Object.freeze(["60-69", "70-79", "80-89", "90+"]);
const PACE = Object.freeze(["slow", "medium", "fast"]);
const QUALITY = Object.freeze(["complete", "partial", "stale", "conflicting"]);
const SUCCESS_CONTRACTS = Object.freeze({
  "health_risk_assessment_mcp.get_risk_assessment_context": ["seniorId", "profile", "indicatorSummary", "riskHistory", "dataQuality"],
  "health_risk_assessment_mcp.get_latest_health_labels": ["seniorId", "medicalHistoryLabels", "inquirySummary", "vitalSigns", "comprehensiveLabels"],
  "health_risk_assessment_mcp.get_indicator_evidence": ["seniorId", "timeWindow", "evidence", "total", "nextCursor"],
  "health_risk_assessment_mcp.save_risk_assessment_result": ["seniorId", "saved", "idempotencyKey", "resultId", "assessment"],
  "health_evaluation_service_mcp_cms.get_senior_profile": ["seniorId", "profile", "profileVersion"],
  "health_evaluation_service_mcp_cms.get_health_evaluation_results": ["seniorId", "results", "latestOnly"],
  "health_evaluation_service_mcp_cms.get_station_service_detail": ["serviceId", "name", "schedule", "location", "bookingRequired", "eligibility"],
  "health_evaluation_service_mcp_cms.list_station_services_brief": ["items", "total", "nextCursor"],
  "identity_permission_mcp.match_face_to_senior": ["captureToken", "candidates", "outcome", "rawImageStored"],
  "identity_permission_mcp.check_data_permission": ["seniorId", "action", "decision", "reasonCode", "authorizationId"],
  "member_asset_mcp.get_member_points": ["seniorId", "accountId", "points", "redemptionRules", "observedAt"],
  "member_asset_mcp.list_recharge_records": ["seniorId", "items", "total", "nextCursor", "dateRange"],
  "member_asset_mcp.list_consumption_records": ["seniorId", "items", "total", "nextCursor", "dateRange"],
  "member_asset_mcp.get_member_level": ["seniorId", "memberState", "level", "benefits", "upgradeProgress"],
  "station_content_mcp.search_station_knowledge": ["items", "total", "nextCursor", "query"],
  "station_content_mcp.list_station_activities": ["items", "total", "nextCursor", "timezone", "dateRange"],
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function hash(value) { return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`; }
function number(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback; }
function seedHash(seed, value) { return crypto.createHash("sha256").update(`${seed}:${value}`).digest().readUInt32BE(0); }
function seeded(seed, index, modulo) { return seedHash(seed, index) % modulo; }
function residentId(seed, index) { return Number(`${Math.abs(number(seed, 104729)) % 9000 + 1000}${String(index).padStart(5, "0")}`); }
function validProfile(profile) { return Object.hasOwn(PROFILES, profile) ? profile : "community-full"; }

function entityCounts(residents) {
  return {
    residents,
    identityEvents: residents * 2 + Math.ceil(residents / 5),
    healthLabels: residents * 8,
    indicatorEvidence: residents * 120,
    healthEvaluations: residents * 4,
    riskAssessments: residents * 3,
    memberAccounts: residents,
    pointLedger: residents * 50,
    rechargeRecords: residents * 12,
    consumptionRecords: residents * 150,
    stationServices: 48,
    stationActivities: 1500,
    knowledgeArticles: 1200,
  };
}
function totalRecords(counts) { return Object.values(counts).reduce((sum, value) => sum + value, 0); }
function createCommunityManifest({ profile = "community-full", seed = 104729, generatedAt = "2026-09-03T00:00:00.000Z" } = {}) {
  const resolvedProfile = validProfile(profile);
  const residents = PROFILES[resolvedProfile];
  const counts = entityCounts(residents);
  const body = {
    manifestVersion: "1.0.0", datasetVersion: DATASET_VERSION, generatorVersion: GENERATOR_VERSION,
    dataClassification: DATA_CLASSIFICATION, profile: resolvedProfile, seed: number(seed, 104729), generatedAt,
    residents, entityCounts: counts, totalRecords: totalRecords(counts),
    mcpServers: SERVER_ORDER, tools: MCP_TOOL_CATALOG.map(([server, tool]) => `${server}.${tool}`),
    contractStates: CONTRACT_STATES, storage: { strategy: "deterministic-on-demand", productionIncluded: false, rendererMaterialized: false },
  };
  return { ...body, manifestHash: hash(body) };
}

function residentFor({ seed = 104729, index = 0, profile = "community-full" } = {}) {
  const residents = PROFILES[validProfile(profile)];
  const normalized = ((number(index, 0) % residents) + residents) % residents;
  const pick = (values, salt) => values[seeded(seed, `${normalized}:${salt}`, values.length)];
  const ageBand = pick(AGE_BANDS, "age");
  const auth = pick(["anonymous", "auth-required", "verified-self", "expired", "scope-limited", "cross-subject"], "auth");
  const quality = pick(QUALITY, "quality");
  const memberState = pick(["non-member", "zero-points", "active", "expiring", "expired"], "member");
  const healthState = pick(["no-record", "routine", "single-attention", "multi-attention", "conflicting", "stale", "insufficient"], "health");
  return {
    seniorId: residentId(seed, normalized), tenantId: 10001, orgId: 10001, residentIndex: normalized,
    synthetic: true, dataClassification: DATA_CLASSIFICATION, profileVersion: "profile-v1", displayCode: `SYN-${String(normalized + 1).padStart(5, "0")}`,
    ageBand, age: ageBand === "60-69" ? 64 : ageBand === "70-79" ? 74 : ageBand === "80-89" ? 84 : 92, speechPace: pick(PACE, "pace"),
    hearing: pick(["normal", "mild-difficulty", "difficulty"], "hearing"), vision: pick(["normal", "large-text", "low-vision"], "vision"),
    digitalLiteracy: pick(["low", "medium", "high"], "literacy"), permissionState: auth, dataQuality: quality, healthState,
    memberState, consentState: auth === "expired" ? "expired" : auth === "anonymous" ? "missing" : "valid",
    authorizationId: auth === "verified-self" ? `community-authz-${residentId(seed, normalized)}` : null,
    cohort: { ageBand, speechPace: pick(PACE, "pace"), healthState, memberState, dataQuality: quality, permissionState: auth },
  };
}

function matchesCohort(resident, cohort = {}) {
  if (!cohort || typeof cohort !== "object") return true;
  const rules = { age: "ageBand", speechPace: "speechPace", hearing: "hearing", vision: "vision", digitalLiteracy: "digitalLiteracy", permission: "permissionState", health: "healthState", member: "memberState", quality: "dataQuality" };
  return Object.entries(rules).every(([filter, field]) => !cohort[filter] || String(resident[field]) === String(cohort[filter]));
}

function selectResidents(dataset, cohort = {}) {
  const selected = [];
  for (let index = 0; index < dataset.residents; index += 1) { const resident = dataset.residentAt(index); if (matchesCohort(resident, cohort)) selected.push(resident); }
  return selected;
}

function bySenior(dataset, seniorId) {
  const string = String(seniorId ?? "");
  const prefix = String(Math.abs(dataset.seed) % 9000 + 1000);
  if (!string.startsWith(prefix) || !/^\d+$/.test(string)) return null;
  const index = Number(string.slice(prefix.length));
  if (!Number.isInteger(index) || index < 0 || index >= dataset.residents) return null;
  return residentFor({ seed: dataset.seed, index, profile: dataset.profile });
}
function pageRange(total, cursor, limit, makeItem) {
  const parsed = cursor == null || cursor === "" ? 0 : Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > total) return error("INVALID_CURSOR", "游标不符合合同");
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const end = Math.min(total, parsed + safeLimit);
  return { items: Array.from({ length: end - parsed }, (_, offset) => makeItem(parsed + offset)), nextCursor: end < total ? String(end) : null, pageSize: safeLimit, total };
}
function facts(dataset, key, suffix) { return { source: "test-fixture", dataClassification: DATA_CLASSIFICATION, fixtureId: `community:${dataset.datasetVersion}`, snapshotVersion: dataset.manifestHash, factIds: [`community:${dataset.datasetVersion}:${key}:${suffix}`] }; }
function error(code, message, extra = {}) { return { error: { code, message }, ...extra }; }

function recordAt(dataset, resident, kind, index) {
  return {
    recordId: `${kind}-${resident.seniorId}-${String(index + 1).padStart(3, "0")}`,
    occurredAt: `2026-0${(index % 8) + 1}-${String((index % 27) + 1).padStart(2, "0")}T09:00:00+08:00`,
    amount: (20 + (seeded(dataset.seed, `${resident.seniorId}:${kind}:${index}`, 600) / 10)).toFixed(2), currency: "CNY",
  };
}
function residentGlobalIndex(dataset, resident, ordinal) {
  return (Math.max(1, Number(ordinal) || 1) - 1) * dataset.residents + resident.residentIndex;
}
function memberBalance(dataset, resident) { return resident.memberState === "zero-points" || resident.memberState === "non-member" ? 0 : 120 + seeded(dataset.seed, resident.seniorId, 9000); }

// The export writer and Fixture MCP use this same source.  It deliberately
// contains business fields, relationships and deterministic values rather than
// a second, generic "large data" representation.
function entityRecord(dataset, entity, index) {
  const resident = typeof dataset.residentAt === "function" ? dataset.residentAt(index % dataset.residents) : residentFor({ seed: dataset.seed, index: index % dataset.residents, profile: dataset.profile });
  const sequence = index + 1;
  const residentOrdinal = Math.floor(index / dataset.residents) + 1;
  const base = { id: `${entity}-${String(sequence).padStart(9, "0")}`, synthetic: true, dataClassification: DATA_CLASSIFICATION, tenantId: 10001, orgId: 10001, sequence };
  const at = recordAt(dataset, resident, entity, index);
  if (entity === "residents") return { ...resident, id: `resident-${resident.seniorId}`, createdAt: "2026-01-01T00:00:00+08:00" };
  if (entity === "identityEvents") return { ...base, seniorId: resident.seniorId, consentId: `consent-${resident.seniorId}-${residentOrdinal}`, captureToken: `capture-${resident.seniorId}-${residentOrdinal}`, eventType: ["capture", "authorize", "expire", "revoke"][residentOrdinal % 4], consentState: resident.consentState, occurredAt: at.occurredAt };
  if (entity === "healthLabels") return { ...base, seniorId: resident.seniorId, labelId: `label-${resident.seniorId}-${residentOrdinal}`, labelType: ["blood-pressure", "mobility", "sleep", "nutrition"][index % 4], level: resident.healthState.includes("attention") ? "attention" : "routine", observedAt: at.occurredAt, sourceSystem: "synthetic-health" };
  if (entity === "indicatorEvidence") return { ...base, seniorId: resident.seniorId, evidenceId: `evidence-${resident.seniorId}-${residentOrdinal}`, metric: ["systolic_bp", "heart_rate", "blood_glucose", "steps"][index % 4], value: String(60 + (index % 80)), unit: index % 4 === 0 ? "mmHg" : index % 4 === 1 ? "bpm" : index % 4 === 2 ? "mmol/L" : "steps", source: "synthetic-device", observedAt: at.occurredAt, timeWindow: ["1d", "7d", "1m", "3m", "6m"][index % 5], quality: resident.dataQuality };
  if (entity === "healthEvaluations") return { ...base, seniorId: resident.seniorId, evaluationId: `eval-${resident.seniorId}-${residentOrdinal}`, evaluationType: ["functional", "nutrition", "fall-risk", "cognition"][index % 4], status: index % 17 === 0 ? "incomplete" : "completed", score: 60 + (index % 41), evaluatedAt: at.occurredAt };
  if (entity === "riskAssessments") return { ...base, seniorId: resident.seniorId, assessmentId: `risk-${resident.seniorId}-${residentOrdinal}`, level: resident.healthState.includes("attention") ? "attention" : "routine", evidenceIds: [`evidence-${resident.seniorId}-${((residentOrdinal - 1) % 120) + 1}`], idempotencyKey: `seed-${dataset.seed}-${resident.seniorId}-${residentOrdinal}`, createdAt: at.occurredAt };
  if (entity === "memberAccounts") return { ...base, seniorId: resident.seniorId, accountId: `member-${resident.seniorId}`, memberState: resident.memberState, level: resident.memberState === "non-member" ? null : ["普通", "银龄", "金龄"][index % 3], pointsBalance: memberBalance(dataset, resident), authorizationId: resident.authorizationId, observedAt: "2026-09-03T00:00:00+08:00" };
  if (entity === "pointLedger") { const balance = memberBalance(dataset, resident); const firstCredit = balance + (resident.memberState === "non-member" ? 0 : 490); const points = residentOrdinal === 1 ? firstCredit : resident.memberState === "non-member" ? 0 : 10; const direction = residentOrdinal === 1 ? "credit" : "debit"; const balanceAfter = residentOrdinal === 1 ? firstCredit : firstCredit - ((residentOrdinal - 1) * points); return { ...base, seniorId: resident.seniorId, ledgerId: `point-${resident.seniorId}-${residentOrdinal}`, direction, points: String(points), balanceAfter: String(balanceAfter), occurredAt: at.occurredAt, referenceType: residentOrdinal === 1 ? "opening-credit" : "synthetic-service" }; }
  if (entity === "rechargeRecords") return { ...base, recordId: `recharge-${resident.seniorId}-${sequence}`, seniorId: resident.seniorId, rechargeId: `recharge-${resident.seniorId}-${sequence}`, amount: at.amount, currency: "CNY", status: index % 13 === 0 ? "reversed" : "settled", paidAt: at.occurredAt, channel: ["counter", "card", "online"][index % 3] };
  if (entity === "consumptionRecords") return { ...base, recordId: `consumption-${resident.seniorId}-${sequence}`, seniorId: resident.seniorId, consumptionId: `consumption-${resident.seniorId}-${sequence}`, amount: at.amount, currency: "CNY", status: index % 19 === 0 ? "refunded" : index % 23 === 0 ? "voided" : "settled", consumedAt: at.occurredAt, category: ["meal", "activity", "assessment"][index % 3], summary: `合成${["助餐", "活动", "测评"][index % 3]}记录` };
  if (entity === "stationServices") return { ...base, seniorId: null, serviceId: `service-${sequence}`, name: ["助餐", "健康测评", "康复指导", "活动预约"][index % 4], category: ["meal", "assessment", "rehabilitation", "activity"][index % 4], enabled: index % 11 !== 0, bookingRequired: index % 2 === 0, location: index % 7 === 0 ? null : `社区${(index % 4) + 1}区`, schedule: "09:00-17:00", updatedAt: at.occurredAt };
  if (entity === "stationActivities") return { ...base, seniorId: null, activityId: `activity-${String(sequence).padStart(4, "0")}`, serviceId: `service-${(index % 48) + 1}`, title: ["健康讲堂", "八段锦", "营养咨询"][index % 3], category: ["lecture", "exercise", "nutrition"][index % 3], status: index % 41 === 0 ? "cancelled" : index % 37 === 0 ? "full" : index % 29 === 0 ? "ended" : "open", startsAt: at.occurredAt, endsAt: at.occurredAt.replace("09:00:00", "10:00:00"), timezone: "Asia/Shanghai", capacity: 30, enrolled: index % 31 };
  if (entity === "knowledgeArticles") return { ...base, seniorId: null, knowledgeId: `knowledge-${String(sequence).padStart(4, "0")}`, title: `合成站点知识 ${sequence}`, category: ["service", "health", "activity"][index % 3], summary: "仅用于合成社区回归的结构化知识条目", publishedAt: at.occurredAt, expiresAt: index % 17 === 0 ? "2025-01-01T00:00:00+08:00" : "2027-01-01T00:00:00+08:00", updatedAt: at.occurredAt };
  throw new Error(`unknown community entity: ${entity}`);
}
function toolResponse(dataset, key, args = {}, idempotency = new Map()) {
  const state = String(args.__communityState || "success");
  if (!CONTRACT_STATES.includes(state)) return error("FIXTURE_STATE_INVALID", "测试合同状态无效");
  if (state === "timeout") return error("TOOL_TIMEOUT", "合成服务超时");
  if (state === "service-error") return error("MCP_SERVICE_ERROR", "合成服务错误");
  if (state === "contract-corrupt") return { source: "test-fixture", malformed: true, dataClassification: DATA_CLASSIFICATION };
  if (state === "invalid-input") return error("INVALID_ARGUMENT", "输入不符合合同");
  if (state === "cross-tenant") return error("CROSS_TENANT_DENIED", "跨机构访问被拒绝");
  if (state === "auth-required") return error("AUTH_REQUIRED", "需要身份认证");
  if (state === "denied") return error("POLICY_DENY", "权限不足");
  const resident = bySenior(dataset, args.seniorId ?? residentId(dataset.seed, 0));
  if (key.includes("station_") || key.includes("get_station_service") || key.includes("list_station_services")) return publicResponse(dataset, key, args, state);
  if (!resident || state === "unknown-id") return error("SENIOR_NOT_FOUND", "合成长者不存在");
  if (state === "empty") return { seniorId: resident.seniorId, items: [], total: 0, nextCursor: null, ...facts(dataset, key, resident.seniorId) };
  const base = facts(dataset, key, resident.seniorId);
  if (state === "missing") return { seniorId: resident.seniorId, missingFields: ["optionalNarrative"], ...base };
  if (state === "stale") return { seniorId: resident.seniorId, stale: true, generatedAt: "2024-01-01T00:00:00.000Z", ...base };
  switch (key) {
    case "health_risk_assessment_mcp.get_risk_assessment_context": return { seniorId: resident.seniorId, profile: { seniorId: resident.seniorId, ageBand: resident.ageBand, accessibility: { hearing: resident.hearing, vision: resident.vision } }, indicatorSummary: { evidenceCount: 120, timeWindows: ["1d", "7d", "1m", "3m", "6m"], abnormalCount: resident.healthState.includes("attention") ? 2 : 0 }, riskHistory: [{ assessmentId: `risk-${resident.seniorId}-001`, level: resident.healthState.includes("attention") ? "attention" : "routine", assessedAt: "2026-08-03T09:00:00+08:00" }], dataQuality: { state: resident.dataQuality, generatedAt: "2026-09-03T00:00:00+08:00" }, ...base };
    case "health_risk_assessment_mcp.get_latest_health_labels": return { seniorId: resident.seniorId, medicalHistoryLabels: [{ code: "HTN_OBSERVED", displayName: "血压观察", sourceId: `label-${resident.seniorId}-1` }], inquirySummary: { status: "synthetic-complete", updatedAt: "2026-09-03T00:00:00+08:00" }, vitalSigns: [{ metric: "systolic_bp", value: "126", unit: "mmHg", observedAt: "2026-09-03T08:00:00+08:00" }], comprehensiveLabels: [{ level: resident.healthState.includes("attention") ? "attention" : "routine", evidenceId: `evidence-${resident.seniorId}-1` }], generatedAt: "2026-09-03T00:00:00+08:00", ...base };
    case "health_risk_assessment_mcp.get_indicator_evidence": {
      const window = args.timeType || 7;
      const paged = pageRange(120, args.cursor, args.limit, (index) => ({ ...recordAt(dataset, resident, "indicator", index), metric: index % 2 ? "heart-rate" : "blood-pressure", value: index % 2 ? 72 : "126/78" }));
      return paged.error ? paged : { seniorId: resident.seniorId, timeWindow: `${window}d`, evidence: paged.items.map((item, index) => ({ ...item, evidenceId: `evidence-${resident.seniorId}-${index + 1}`, source: "synthetic-device", unit: item.metric === "heart-rate" ? "bpm" : "mmHg", observedAt: item.occurredAt, quality: resident.dataQuality })), nextCursor: paged.nextCursor, pageSize: paged.pageSize, total: paged.total, ...base };
    }
    case "health_risk_assessment_mcp.save_risk_assessment_result": {
      const idempotencyKey = String(args.idempotencyKey || "");
      if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "写入必须提供幂等键");
      const fingerprint = hash({ seniorId: resident.seniorId, riskAssessmentDraft: args.riskAssessmentDraft || null });
      const prior = idempotency.get(idempotencyKey);
      if (prior && prior.fingerprint !== fingerprint) return error("IDEMPOTENCY_CONFLICT", "同一幂等键不能写入不同内容");
      const resultId = prior?.resultId || `risk-${resident.seniorId}-${hash(idempotencyKey).slice(7, 19)}`;
      idempotency.set(idempotencyKey, { fingerprint, resultId });
      return { seniorId: resident.seniorId, saved: true, replayed: Boolean(prior), idempotencyKey, resultId, assessment: { level: args.riskAssessmentDraft?.level || "routine", evidenceIds: args.riskAssessmentDraft?.evidence || [], savedAt: "2026-09-03T00:00:00+08:00" }, ...base };
    }
    case "health_evaluation_service_mcp_cms.get_senior_profile": return { seniorId: resident.seniorId, profile: { seniorId: resident.seniorId, displayCode: resident.displayCode, ageBand: resident.ageBand, communication: { speechPace: resident.speechPace }, accessibility: { hearing: resident.hearing, vision: resident.vision, digitalLiteracy: resident.digitalLiteracy }, dataQuality: resident.dataQuality }, profileVersion: resident.profileVersion, ...base };
    case "health_evaluation_service_mcp_cms.get_health_evaluation_results": return { seniorId: resident.seniorId, results: Array.from({ length: args.latestOnly ? 1 : 4 }, (_, index) => ({ evaluationId: `eval-${resident.seniorId}-${index + 1}`, type: ["functional", "nutrition", "fall-risk", "cognition"][index], status: index === 3 && resident.dataQuality === "partial" ? "incomplete" : "completed", score: 72 + index, evaluatedAt: recordAt(dataset, resident, "assessment", index).occurredAt })), latestOnly: Boolean(args.latestOnly), ...base };
    case "identity_permission_mcp.match_face_to_senior": return { captureToken: String(args.captureToken || "synthetic-capture"), candidates: resident.consentState === "valid" ? [{ seniorId: resident.seniorId, confidence: "0.910", consentId: `consent-${resident.seniorId}-1` }] : [], outcome: resident.consentState === "valid" ? "MATCHED" : resident.consentState === "expired" ? "CONSENT_EXPIRED" : "NOT_MATCHED", rawImageStored: false, ...base };
    case "identity_permission_mcp.check_data_permission": { const decision = resident.permissionState === "verified-self" ? "ALLOW" : resident.permissionState === "auth-required" || resident.permissionState === "anonymous" ? "AUTH_REQUIRED" : "DENY"; return { seniorId: resident.seniorId, action: args.action || "member:read:self", decision, reasonCode: decision === "ALLOW" ? "VERIFIED_SELF" : decision === "AUTH_REQUIRED" ? "AUTH_MISSING" : "SYNTHETIC_POLICY_DENY", authorizationId: decision === "ALLOW" ? resident.authorizationId : null, expiresAt: decision === "ALLOW" ? "2026-09-03T00:05:00+08:00" : null, ...base }; }
    case "member_asset_mcp.get_member_points": return { seniorId: resident.seniorId, accountId: `member-${resident.seniorId}`, points: memberBalance(dataset, resident), redemptionRules: resident.memberState === "non-member" ? null : { minimumPoints: 100, currency: "CNY" }, observedAt: "2026-09-03T00:00:00+08:00", ...(args.includeLedger ? { ledgerPreview: [entityRecord(dataset, "pointLedger", residentGlobalIndex(dataset, resident, 1))] } : {}), ...base };
    case "member_asset_mcp.list_recharge_records": { const paged = pageRange(12, args.cursor, args.limit, (index) => entityRecord(dataset, "rechargeRecords", residentGlobalIndex(dataset, resident, index + 1))); return paged.error ? paged : { seniorId: resident.seniorId, ...paged, dateRange: { from: args.dateFrom || null, to: args.dateTo || null }, ...base }; }
    case "member_asset_mcp.list_consumption_records": { const paged = pageRange(150, args.cursor, args.limit, (index) => entityRecord(dataset, "consumptionRecords", residentGlobalIndex(dataset, resident, index + 1))); return paged.error ? paged : { seniorId: resident.seniorId, ...paged, dateRange: { from: args.dateFrom || null, to: args.dateTo || null }, ...base }; }
    case "member_asset_mcp.get_member_level": return { seniorId: resident.seniorId, memberState: resident.memberState, level: resident.memberState === "non-member" ? null : "银龄会员", benefits: resident.memberState === "expired" ? [] : [{ code: "BOOKING_PRIORITY", name: "预约优先" }], upgradeProgress: resident.memberState === "non-member" ? null : { current: 320, target: 1000 }, expiresAt: resident.memberState === "expiring" ? "2026-09-15T00:00:00+08:00" : resident.memberState === "expired" ? "2026-01-01T00:00:00+08:00" : null, ...base };
    default: return error("TOOL_NOT_IMPLEMENTED", "Fixture 工具未实现");
  }
}
function publicResponse(dataset, key, args, state) {
  const base = facts(dataset, key, "public");
  if (state === "empty") return { items: [], total: 0, nextCursor: null, ...base };
  if (state === "missing") return { serviceId: "meal_service", name: "助餐服务", missingFields: ["location"], ...base };
  if (state === "stale") return { stale: true, updatedAt: "2024-01-01T00:00:00.000Z", ...base };
  if (state === "unknown-id") return error("RESOURCE_NOT_FOUND", "站点资源不存在");
  if (key.endsWith("get_station_service_detail")) return { ...entityRecord(dataset, "stationServices", 0), serviceId: String(args.serviceId || "meal_service"), schedule: "11:30 至 13:00", speechSchedule: "十一点半到十三点", eligibility: { resident: true, memberRequired: false }, ...base };
  if (key.endsWith("list_station_services_brief")) { const paged = pageRange(48, args.cursor, args.limit, (index) => entityRecord(dataset, "stationServices", index)); const items = paged.items?.filter((item) => args.enabledOnly === false || item.enabled); return paged.error ? paged : { ...paged, items, ...base }; }
  if (key.endsWith("search_station_knowledge")) { const paged = pageRange(1200, args.cursor, args.limit, (index) => entityRecord(dataset, "knowledgeArticles", index)); const items = paged.items?.filter((item) => item.expiresAt > "2026-09-03T00:00:00+08:00" && (!args.query || item.title.includes(String(args.query).slice(0, 2)) || true)); return paged.error ? paged : { ...paged, items, query: String(args.query || ""), ...base }; }
  if (key.endsWith("list_station_activities")) { const paged = pageRange(1500, args.cursor, args.limit, (index) => entityRecord(dataset, "stationActivities", index)); return paged.error ? paged : { ...paged, timezone: "Asia/Shanghai", dateRange: { from: args.dateFrom || null, to: args.dateTo || null }, ...base }; }
  return error("TOOL_NOT_IMPLEMENTED", "Fixture 工具未实现");
}

function validateSuccessContract(key, response) {
  const required = SUCCESS_CONTRACTS[key] || [];
  const missing = required.filter((field) => !Object.hasOwn(response || {}, field));
  if (response?.source !== "test-fixture") missing.push("source");
  if (!Array.isArray(response?.factIds) || response.factIds.length === 0) missing.push("factIds");
  const semanticFailures = [];
  const string = (value) => typeof value === "string" && value.length > 0;
  const integer = (value) => Number.isInteger(value);
  if (key.includes("get_risk_assessment_context") && !(integer(response?.seniorId) && Array.isArray(response?.riskHistory) && response.riskHistory.every((item) => string(item.assessmentId) && ["routine", "attention"].includes(item.level)))) semanticFailures.push("riskContext.structure");
  if (key.includes("get_latest_health_labels") && !(Array.isArray(response?.medicalHistoryLabels) && response.medicalHistoryLabels.every((item) => string(item.code) && string(item.sourceId)) && Array.isArray(response?.vitalSigns) && response.vitalSigns.every((item) => string(item.metric) && string(item.unit) && string(item.observedAt)))) semanticFailures.push("healthLabels.nested");
  if (key.includes("get_indicator_evidence") && !(Array.isArray(response?.evidence) && response.evidence.every((item) => string(item.evidenceId) && string(item.metric) && string(item.unit) && string(item.observedAt)) && /^\d+d$/.test(String(response?.timeWindow || "")))) semanticFailures.push("indicatorEvidence.nested");
  if (key.includes("save_risk_assessment_result") && !(response?.saved === true && string(response?.resultId) && Array.isArray(response?.assessment?.evidenceIds))) semanticFailures.push("riskSave.idempotency");
  if (key.includes("get_senior_profile") && !(integer(response?.profile?.seniorId) && response.profile.seniorId === response.seniorId && string(response?.profileVersion))) semanticFailures.push("profile.identity");
  if (key.includes("get_health_evaluation_results") && !(Array.isArray(response?.results) && response.results.every((item) => string(item.evaluationId) && string(item.type) && integer(item.score)))) semanticFailures.push("evaluationResults.nested");
  if (key.includes("match_face_to_senior") && !(string(response?.captureToken) && Array.isArray(response?.candidates) && response.rawImageStored === false)) semanticFailures.push("faceMatch.privacy");
  if (key.includes("check_data_permission") && !(["ALLOW", "DENY", "AUTH_REQUIRED"].includes(response?.decision) && string(response?.reasonCode))) semanticFailures.push("permission.decision");
  if (key.includes("get_member_points") && !(integer(response?.seniorId) && Number.isInteger(response?.points) && string(response?.observedAt))) semanticFailures.push("memberPoints.value");
  if (key.includes("list_recharge_records") || key.includes("list_consumption_records")) if (!(Array.isArray(response?.items) && response.items.every((item) => string(item.recordId) && /^\d+\.\d{2}$/.test(item.amount) && item.currency === "CNY") && (response.nextCursor == null || string(response.nextCursor)))) semanticFailures.push("ledgerPage.items");
  if (key.includes("get_member_level") && !(Array.isArray(response?.benefits) && (response.level === null || string(response.level)))) semanticFailures.push("memberLevel.structure");
  if (key.includes("get_station_service_detail") && !(string(response?.serviceId) && string(response?.schedule) && typeof response?.bookingRequired === "boolean" && response.eligibility && typeof response.eligibility === "object")) semanticFailures.push("serviceDetail.structure");
  if (key.includes("list_station_services_brief") && !(Array.isArray(response?.items) && response.items.every((item) => string(item.serviceId) && typeof item.enabled === "boolean"))) semanticFailures.push("serviceList.items");
  if (key.includes("search_station_knowledge") && !(Array.isArray(response?.items) && response.items.every((item) => string(item.knowledgeId) && string(item.expiresAt)))) semanticFailures.push("knowledge.items");
  if (key.includes("list_station_activities") && !(Array.isArray(response?.items) && response.items.every((item) => string(item.activityId) && string(item.startsAt) && string(item.endsAt) && string(item.timezone)))) semanticFailures.push("activity.items");
  return { valid: missing.length === 0 && semanticFailures.length === 0, missing, semanticFailures };
}

function createCommunityDataset(options = {}) {
  const manifest = createCommunityManifest(options);
  const idempotency = new Map();
  return { ...manifest, resident: (value) => bySenior(manifest, value), residentAt: (index) => residentFor({ seed: manifest.seed, index, profile: manifest.profile }), toolResponse: (key, args) => toolResponse(manifest, key, args, idempotency), coverage: () => ({ mcp: SERVER_ORDER.length, tools: MCP_TOOL_CATALOG.length, statesPerTool: CONTRACT_STATES.length, cases: MCP_TOOL_CATALOG.length * CONTRACT_STATES.length }) };
}

module.exports = { CONTRACT_STATES, DATASET_VERSION, GENERATOR_VERSION, PROFILES, SUCCESS_CONTRACTS, createCommunityDataset, createCommunityManifest, entityRecord, hash, matchesCohort, memberBalance, residentFor, residentGlobalIndex, selectResidents, toolResponse, validateSuccessContract };
