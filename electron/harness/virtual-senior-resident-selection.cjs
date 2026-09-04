"use strict";

// This is a QA-only read model for choosing one deterministic community
// resident.  It deliberately does not manufacture an actor, credential, or
// health value: all selection and detail data comes from the supplied
// synthetic community dataset.
const { createCommunityDataset, matchesCohort } = require("./virtual-senior-community-dataset.cjs");

const COHORT_FIELDS = Object.freeze(["age", "speechPace", "hearing", "vision", "digitalLiteracy", "permission", "health", "member", "quality"]);
const IDENTITY_OVERRIDE_FIELDS = Object.freeze([
  "actor", "actorFixture", "authorizationId", "subjectToken", "scopes", "authLevel", "role",
  "tenantId", "orgId", "permissionState", "resident", "residentBinding",
]);
const HEALTH_TOOLS = Object.freeze({
  riskContext: "health_risk_assessment_mcp.get_risk_assessment_context",
  labels: "health_risk_assessment_mcp.get_latest_health_labels",
  profile: "health_evaluation_service_mcp_cms.get_senior_profile",
  evaluations: "health_evaluation_service_mcp_cms.get_health_evaluation_results",
});

class ResidentSelectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResidentSelectionError";
    this.code = code;
  }
}

function fail(code, message) { throw new ResidentSelectionError(code, message); }

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function safeString(value, maximum, code, message) {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number") fail(code, message);
  const result = String(value).trim();
  if (result.length > maximum) fail(code, message);
  return result;
}

function normalizeLimit(value) {
  if (value == null || value === "") return 25;
  if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 100) fail("INVALID_LIMIT", "分页大小必须是 1 到 100 的整数");
  return Number(value);
}

function normalizeCursor(value) {
  if (value == null || value === "") return 0;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail("INVALID_CURSOR", "分页游标不符合合同");
  return Number(value);
}

function normalizeCohort(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail("INVALID_COHORT", "测试人群筛选必须是对象");
  for (const key of Object.keys(value)) if (!COHORT_FIELDS.includes(key)) fail("INVALID_COHORT", `未知测试人群条件：${key}`);
  return Object.fromEntries(COHORT_FIELDS.map((key) => [key, safeString(value[key], 64, "INVALID_COHORT", "测试人群条件无效")]).filter(([, item]) => item));
}

function rejectClientIdentityOverrides(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_SELECTION_REQUEST", "居民选择请求必须是对象");
  for (const key of IDENTITY_OVERRIDE_FIELDS) if (Object.hasOwn(input, key)) fail("CLIENT_ACTOR_FORBIDDEN", "客户端不得提供 actor、授权或居民对象");
}

function publicResident(resident) {
  return {
    synthetic: true,
    dataClassification: resident.dataClassification,
    residentId: resident.seniorId,
    seniorId: resident.seniorId,
    residentIndex: resident.residentIndex,
    displayCode: resident.displayCode,
    profileVersion: resident.profileVersion,
    cohort: { ...resident.cohort },
    profile: {
      ageBand: resident.ageBand,
      age: resident.age,
      speechPace: resident.speechPace,
      hearing: resident.hearing,
      vision: resident.vision,
      digitalLiteracy: resident.digitalLiteracy,
      permissionState: resident.permissionState,
      memberState: resident.memberState,
      consentState: resident.consentState,
      dataQuality: resident.dataQuality,
    },
    health: {
      state: resident.healthState,
      dataQuality: resident.dataQuality,
    },
  };
}

function healthDetail(dataset, seniorId) {
  const args = { seniorId };
  const riskContext = dataset.toolResponse(HEALTH_TOOLS.riskContext, args);
  const labels = dataset.toolResponse(HEALTH_TOOLS.labels, args);
  const profile = dataset.toolResponse(HEALTH_TOOLS.profile, args);
  const evaluations = dataset.toolResponse(HEALTH_TOOLS.evaluations, { ...args, latestOnly: false });
  return {
    synthetic: true,
    dataClassification: riskContext.dataClassification,
    source: riskContext.source,
    snapshotVersion: riskContext.snapshotVersion,
    // The selector exposes the existing Fixture view only.  It is intentionally
    // not a claim that an end-to-end health archive, time-window semantics, or
    // production health routing has passed acceptance.
    sourceQuality: {
      status: "limited-fixture-preview",
      acceptedFor: ["synthetic-resident-selection", "qa-live-observer-input"],
      notAcceptedFor: ["complete-health-record", "production-health-consultation", "cross-domain-health-parity"],
    },
    profile,
    riskContext,
    labels,
    evaluations,
  };
}

function createResidentBinding(dataset, resident) {
  return deepFreeze({
    bindingVersion: "virtual-senior-resident-binding-v1",
    synthetic: true,
    dataClassification: resident.dataClassification,
    datasetVersion: dataset.datasetVersion,
    generatorVersion: dataset.generatorVersion,
    profile: dataset.profile,
    seed: dataset.seed,
    manifestHash: dataset.manifestHash,
    residentId: resident.seniorId,
    seniorId: resident.seniorId,
    residentIndex: resident.residentIndex,
    displayCode: resident.displayCode,
  });
}

function createVirtualSeniorResidentSelection({ dataset = createCommunityDataset() } = {}) {
  if (!dataset || typeof dataset.resident !== "function" || typeof dataset.residentAt !== "function" || typeof dataset.toolResponse !== "function") {
    throw new TypeError("居民选择服务需要完整社区数据集");
  }

  function resolveResident(input = {}) {
    rejectClientIdentityOverrides(input);
    const seniorId = safeString(input.seniorId ?? input.residentId, 32, "INVALID_RESIDENT_ID", "居民 ID 无效");
    if (!seniorId) fail("RESIDENT_ID_REQUIRED", "请选择一名合成长者");
    const resident = dataset.resident(seniorId);
    if (!resident || !resident.synthetic || resident.dataClassification !== "synthetic-test-only") fail("RESIDENT_NOT_FOUND", "合成长者不存在");
    return resident;
  }

  function search(input = {}) {
    rejectClientIdentityOverrides(input);
    const query = safeString(input.query, 64, "INVALID_SEARCH_QUERY", "搜索条件无效").toLowerCase();
    const cohort = normalizeCohort(input.cohort);
    const cursor = normalizeCursor(input.cursor);
    const limit = normalizeLimit(input.limit);
    const matches = [];
    for (let index = 0; index < dataset.residents; index += 1) {
      const resident = dataset.residentAt(index);
      if (!matchesCohort(resident, cohort)) continue;
      const searchable = `${resident.displayCode} ${resident.seniorId}`.toLowerCase();
      if (query && !searchable.includes(query)) continue;
      matches.push(resident);
    }
    if (cursor > matches.length) fail("INVALID_CURSOR", "分页游标超出搜索结果");
    const page = matches.slice(cursor, cursor + limit).map(publicResident);
    const next = cursor + page.length;
    return deepFreeze({
      synthetic: true,
      dataClassification: "synthetic-test-only",
      dataset: { datasetVersion: dataset.datasetVersion, generatorVersion: dataset.generatorVersion, profile: dataset.profile, seed: dataset.seed, manifestHash: dataset.manifestHash },
      query,
      cohort,
      items: page,
      total: matches.length,
      pageSize: limit,
      nextCursor: next < matches.length ? String(next) : null,
    });
  }

  function detail(input = {}) {
    const resident = resolveResident(input);
    return deepFreeze({
      synthetic: true,
      dataClassification: resident.dataClassification,
      resident: publicResident(resident),
      health: healthDetail(dataset, resident.seniorId),
      binding: createResidentBinding(dataset, resident),
    });
  }

  function bind(input = {}) {
    const resident = resolveResident(input);
    return createResidentBinding(dataset, resident);
  }

  function resolveBinding(input = {}) {
    rejectClientIdentityOverrides(input);
    const submitted = input.binding;
    if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) fail("BINDING_REQUIRED", "需要已选择的居民绑定");
    rejectClientIdentityOverrides(submitted);
    const resident = resolveResident({ seniorId: submitted.residentId ?? submitted.seniorId });
    const canonical = createResidentBinding(dataset, resident);
    for (const key of ["datasetVersion", "generatorVersion", "profile", "seed", "manifestHash", "residentId", "seniorId", "residentIndex", "displayCode", "dataClassification", "synthetic"]) {
      if (submitted[key] !== canonical[key]) fail("BINDING_MISMATCH", "居民绑定与当前合成社区数据不一致");
    }
    return canonical;
  }

  return Object.freeze({ bind, detail, resolveBinding, search });
}

module.exports = { COHORT_FIELDS, ResidentSelectionError, createResidentBinding, createVirtualSeniorResidentSelection };
