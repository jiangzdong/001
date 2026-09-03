"use strict";

const MCP_TOOL_CATALOG = Object.freeze([
  ["health_risk_assessment_mcp", "get_risk_assessment_context", "获取研判上下文", "personal", "health:read:self", ["seniorId"]],
  ["health_risk_assessment_mcp", "get_latest_health_labels", "获取最新标签与体征评估", "personal", "health:read:self", ["tenantId", "types", "seniorId", "orgId"]],
  ["health_risk_assessment_mcp", "get_indicator_evidence", "获取指标证据", "personal", "health:read:self", ["seniorId", "signsTypeList"]],
  ["health_risk_assessment_mcp", "save_risk_assessment_result", "保存研判结果", "personal", "health:write:self", ["seniorId", "riskAssessmentDraft", "idempotencyKey"]],
  ["health_evaluation_service_mcp_cms", "get_senior_profile", "获取长者档案摘要", "personal", "member:read:self", ["seniorId"]],
  ["health_evaluation_service_mcp_cms", "get_health_evaluation_results", "获取健康测评结果", "personal", "health:read:self", ["seniorId"]],
  ["health_evaluation_service_mcp_cms", "get_station_service_detail", "获取单项站点服务详情，返回该服务的时间、地点和预约信息", "public", null, ["orgId", "serviceId"]],
  ["health_evaluation_service_mcp_cms", "list_station_services_brief", "获取已启用站点服务简表，用于导览，不替代单项服务时间查询", "public", null, ["orgId"]],
  ["identity_permission_mcp", "match_face_to_senior", "人脸匹配长者 ID", "personal", "identity:verify", ["orgId", "captureToken", "consentId"]],
  ["identity_permission_mcp", "check_data_permission", "校验数据访问权限", "personal", "policy:evaluate", ["orgId", "operatorId", "seniorId", "action"]],
  ["member_asset_mcp", "get_member_points", "查询会员积分", "personal", "member:read:self", ["seniorId", "orgId", "authorizationId"]],
  ["member_asset_mcp", "list_recharge_records", "查询充值记录", "personal", "member:read:self", ["seniorId", "orgId", "authorizationId"]],
  ["member_asset_mcp", "list_consumption_records", "查询消费记录", "personal", "member:read:self", ["seniorId", "orgId", "authorizationId"]],
  ["member_asset_mcp", "get_member_level", "查询会员等级", "personal", "member:read:self", ["seniorId", "orgId", "authorizationId"]],
  ["station_content_mcp", "search_station_knowledge", "检索站点公共知识", "public", null, ["orgId", "query"]],
  ["station_content_mcp", "list_station_activities", "查询站点活动", "public", null, ["orgId"]],
]);

const FIXTURES = Object.freeze({
  // Deliberately empty. Production business facts must come from a configured
  // MCP server; local fallback must never impersonate authoritative station data.
  services: [],
  activities: [],
});

const OPTIONAL_FIELDS = Object.freeze({
  get_risk_assessment_context: ["orgId", "businessId"],
  get_indicator_evidence: ["orgId", "timeType"],
  save_risk_assessment_result: ["orgId"],
  get_senior_profile: ["orgId"],
  get_health_evaluation_results: ["orgId", "assessmentType", "latestOnly"],
  list_station_services_brief: ["category", "enabledOnly"],
  check_data_permission: ["authToken"],
  get_member_points: ["includeLedger"],
  list_recharge_records: ["dateFrom", "dateTo", "cursor", "limit"],
  list_consumption_records: ["dateFrom", "dateTo", "cursor", "limit"],
  search_station_knowledge: ["categories", "limit"],
  list_station_activities: ["dateFrom", "dateTo", "category", "cursor", "limit"],
});

function fieldSchema(tool, name) {
  if (["get_latest_health_labels", "save_risk_assessment_result"].includes(tool) && ["orgId", "seniorId"].includes(name)) return { type: "string" };
  if (["orgId", "seniorId"].includes(name)) return { type: "integer" };
  if (name === "businessId") return { type: "number" };
  if (["limit", "timeType"].includes(name)) return { type: "integer" };
  if (["latestOnly", "enabledOnly", "includeLedger", "userConfirmed"].includes(name)) return { type: "boolean" };
  if (["signsTypeList"].includes(name)) return { type: "array", items: { type: "integer" } };
  if (["categories"].includes(name)) return { type: "array", items: { type: "string" } };
  if (["riskAssessmentDraft"].includes(name)) return { type: "object" };
  if (name === "serviceId") return { type: "string", description: "由业务系统定义的服务 ID" };
  return { type: "string" };
}

function localExecutors() {
  const unavailable = (name) => async () => { throw Object.assign(new Error(`${name} 尚未接入业务数据源`), { code: "DATA_NOT_CONFIGURED" }); };
  return {
    "health_evaluation_service_mcp_cms.get_station_service_detail": unavailable("站点服务详情"),
    "health_evaluation_service_mcp_cms.list_station_services_brief": unavailable("站点服务目录"),
    "station_content_mcp.search_station_knowledge": unavailable("站点知识"),
    "station_content_mcp.list_station_activities": unavailable("站点活动"),
    "member_asset_mcp.get_member_points": unavailable("会员积分"),
    "member_asset_mcp.list_recharge_records": unavailable("充值记录"),
    "member_asset_mcp.list_consumption_records": unavailable("消费记录"),
    "member_asset_mcp.get_member_level": unavailable("会员等级"),
    "health_risk_assessment_mcp.get_risk_assessment_context": unavailable("健康研判上下文"),
    "health_risk_assessment_mcp.get_latest_health_labels": unavailable("健康标签"),
    "health_risk_assessment_mcp.get_indicator_evidence": unavailable("指标证据"),
    "health_risk_assessment_mcp.save_risk_assessment_result": unavailable("健康研判保存"),
    "health_evaluation_service_mcp_cms.get_senior_profile": unavailable("长者档案"),
    "health_evaluation_service_mcp_cms.get_health_evaluation_results": unavailable("健康测评结果"),
    "identity_permission_mcp.match_face_to_senior": unavailable("身份识别"),
    "identity_permission_mcp.check_data_permission": async ({ action }, context) => {
      const actor = context.actor || {};
      if (!actor.subjectToken || !["demo_verified", "verified"].includes(actor.authLevel)) return { decision: "AUTH_REQUIRED", reasonCode: "AUTH_MISSING", authorizationId: null };
      if (!(actor.scopes || []).includes(action)) return { decision: "DENY", reasonCode: "SCOPE_DENIED", authorizationId: null };
      return { decision: "ALLOW", reasonCode: "VERIFIED_SELF", authorizationId: `local-authz-${context.turnId || "turn"}`, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    },
  };
}

function registerMcpTools(registry, gateway) {
  for (const [server, tool, description, sensitivity, action, requiredKeys] of MCP_TOOL_CATALOG) {
    registry.register({
      name: `${server}.${tool}`,
      description,
      sensitivity,
      action,
      timeoutMs: tool.startsWith("save_") || tool.startsWith("call_") ? 5000 : 3000,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries([...requiredKeys, ...(OPTIONAL_FIELDS[tool] || [])].map((key) => [key, fieldSchema(tool, key)])),
        required: requiredKeys,
        additionalProperties: true,
      },
      transport: "mcp",
      server,
      tool,
      execute: (input, context) => gateway.invoke(server, tool, input, context),
    });
  }
  return registry;
}

module.exports = { FIXTURES, MCP_TOOL_CATALOG, localExecutors, registerMcpTools };
