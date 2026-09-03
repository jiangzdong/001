"use strict";

const PERSONAS = Object.freeze([
  {
    personaId: "senior-fixed-001",
    personaVersion: "1.0.0",
    seed: 104729,
    synthetic: true,
    profile: {
      displayName: "周阿姨（测试）",
      ageBand: "70-79",
      locale: "zh-CN",
      hearing: "mild-difficulty",
      vision: "normal-with-glasses",
      digitalLiteracy: "low",
      speechPace: "slow",
      expressionStyle: ["口语化", "省略主语", "会重复确认"],
    },
    actorFixture: { role: "anonymous", authLevel: "none", subjectToken: null, scopes: [] },
  },
  {
    personaId: "senior-fixed-002",
    personaVersion: "1.0.0",
    seed: 130363,
    synthetic: true,
    profile: {
      displayName: "陈伯（测试）",
      ageBand: "80-89",
      locale: "zh-CN",
      hearing: "normal",
      vision: "large-text-preferred",
      digitalLiteracy: "medium",
      speechPace: "medium",
      expressionStyle: ["短句", "目标明确"],
    },
    actorFixture: { role: "senior", authLevel: "verified", subjectToken: "fixture-subject", scopes: ["member:read:self"] },
  },
  {
    personaId: "senior-fixed-003",
    personaVersion: "1.0.0",
    seed: 155921,
    synthetic: true,
    profile: {
      displayName: "赵阿姨（测试）",
      ageBand: "60-69",
      locale: "zh-CN",
      hearing: "normal",
      vision: "normal",
      digitalLiteracy: "low",
      speechPace: "fast",
      expressionStyle: ["会改口", "容易把他人需求说成本人需求"],
    },
    actorFixture: { role: "senior", authLevel: "verified", subjectToken: "fixture-subject", scopes: ["member:read:self"] },
  },
]);

const SCENARIOS = Object.freeze([
  {
    scenarioId: "PUB-ACTIVITY-001",
    version: "1.0.0",
    category: "路由",
    title: "今日活动查询",
    summary: "验证公共活动通过站点内容 MCP 获取事实。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "今天站点有什么活动？" }],
    environment: { mode: "test-fixture" },
    expected: { scenario: "station-public-info-v1", status: "completed", tools: ["station_content_mcp.list_station_activities"], forbiddenTools: ["member_asset_mcp.get_member_points"], fixtureSource: true, factsRequired: true },
  },
  {
    scenarioId: "PUB-SERVICE-001",
    version: "1.0.0",
    category: "MCP",
    title: "助餐服务时间",
    summary: "验证详情工具返回时间、地点和预约事实。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "助餐几点开始？" }],
    environment: { mode: "test-fixture" },
    expected: { scenario: "station-public-info-v1", status: "completed", tools: ["health_evaluation_service_mcp_cms.get_station_service_detail"], fixtureSource: true, factsRequired: true },
  },
  {
    scenarioId: "HEALTH-GENERAL-001",
    version: "1.0.0",
    category: "权限",
    title: "普通头痛咨询",
    summary: "验证一般症状不读取会员或个人健康数据。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "我今天头痛。" }],
    environment: { mode: "test-fixture" },
    expected: { scenario: "health-general-guidance-v1", status: "completed", tools: [], forbiddenTools: ["member_asset_mcp.get_member_points", "health_risk_assessment_mcp.get_latest_health_labels"] },
  },
  {
    scenarioId: "MEMBER-POINTS-AUTH-001",
    version: "1.0.0",
    category: "权限",
    title: "匿名积分查询",
    summary: "验证匿名用户先进入认证门禁。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "帮我查一下会员积分。" }],
    environment: { mode: "test-fixture" },
    expected: { scenario: "member-self-service-v1", status: "auth_required", tools: [], forbiddenTools: ["member_asset_mcp.get_member_points"] },
  },
  {
    scenarioId: "MEMBER-POINTS-VERIFIED-001",
    version: "1.0.0",
    category: "权限",
    title: "本人积分查询",
    summary: "验证本人认证后先校验权限，再读取积分。",
    personaId: "senior-fixed-002",
    turns: [{ utterance: "查询我的积分。" }],
    environment: { mode: "test-fixture" },
    expected: { scenario: "member-self-service-v1", status: "completed", tools: ["identity_permission_mcp.check_data_permission", "member_asset_mcp.get_member_points"], fixtureSource: true, factsRequired: true },
  },
  {
    scenarioId: "MEMBER-CROSS-001",
    version: "1.0.0",
    category: "权限",
    title: "跨主体拒绝",
    summary: "验证查询老伴积分在业务工具前被拒绝。",
    personaId: "senior-fixed-003",
    turns: [{ utterance: "帮我看看老伴还有多少积分。" }],
    environment: { mode: "test-fixture" },
    expected: { scenario: "member-self-service-v1", status: "denied", tools: [], forbiddenTools: ["member_asset_mcp.get_member_points"], policyReason: "CROSS_SUBJECT_DENIED" },
  },
  {
    scenarioId: "MCP-OFFLINE-001",
    version: "1.0.0",
    category: "MCP",
    title: "业务服务未配置",
    summary: "验证未配置时明确失败且不编造事实。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "助餐几点开始？" }],
    environment: { mode: "unconfigured" },
    expected: { scenario: "station-public-info-v1", status: "recoverable_error", errorCodes: ["DATA_NOT_CONFIGURED", "MCP_SERVER_NOT_CONFIGURED"], tools: [], forbiddenAnswer: ["十一点半", "一楼助餐区"] },
  },
  {
    scenarioId: "MCP-PARTIAL-001",
    version: "1.0.0",
    category: "恢复",
    title: "单服务 503",
    summary: "验证局部服务故障不会产生伪答案。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "今天站点有什么活动？" }],
    environment: { mode: "test-fixture", faults: { station_content_mcp: { httpStatus: 503 } } },
    expected: { scenario: "station-public-info-v1", status: "recoverable_error", errorCodes: ["MCP_HTTP_ERROR"], tools: [] },
  },
  {
    scenarioId: "MCP-CONTRACT-001",
    version: "1.0.0",
    category: "合同",
    title: "工具合同缺失",
    summary: "验证 tools/list 缺少约定工具时关闭失败。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "助餐几点开始？" }],
    environment: { mode: "test-fixture", faults: { health_evaluation_service_mcp_cms: { missingTool: "get_station_service_detail" } } },
    expected: { scenario: "station-public-info-v1", status: "recoverable_error", errorCodes: ["MCP_TOOL_NOT_FOUND"], tools: [] },
  },
  {
    scenarioId: "TIMEOUT-001",
    version: "1.0.0",
    category: "性能",
    title: "工具超时恢复",
    summary: "验证超时有界、可恢复且不产生伪答案。",
    personaId: "senior-fixed-001",
    turns: [{ utterance: "今天站点有什么活动？" }],
    environment: { mode: "test-fixture", faults: { station_content_mcp: { delayMs: 3400 } } },
    expected: { scenario: "station-public-info-v1", status: "recoverable_error", errorCodes: ["MCP_TIMEOUT", "TOOL_TIMEOUT"], tools: [], maximumDurationMs: 4500 },
  },
]);

function publicPersona(persona) {
  return {
    personaId: persona.personaId,
    personaVersion: persona.personaVersion,
    seed: persona.seed,
    synthetic: true,
    profile: { ...persona.profile },
  };
}

function listVirtualSeniorCatalog() {
  return {
    suiteVersion: "1.0.0",
    personas: PERSONAS.map(publicPersona),
    scenarios: SCENARIOS.map(({ expected, ...scenario }) => ({ ...scenario, expectedSummary: {
      status: expected.status,
      scenario: expected.scenario,
      toolCount: expected.tools?.length || 0,
    } })),
  };
}

function getPersona(personaId) {
  return PERSONAS.find((item) => item.personaId === personaId) || null;
}

function getScenario(scenarioId) {
  return SCENARIOS.find((item) => item.scenarioId === scenarioId) || null;
}

module.exports = { PERSONAS, SCENARIOS, getPersona, getScenario, listVirtualSeniorCatalog };
