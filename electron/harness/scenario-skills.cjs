"use strict";

const fs = require("fs");
const path = require("path");

const T = Object.freeze({
  serviceDetail: "health_evaluation_service_mcp_cms.get_station_service_detail",
  serviceList: "health_evaluation_service_mcp_cms.list_station_services_brief",
  activities: "station_content_mcp.list_station_activities",
  knowledge: "station_content_mcp.search_station_knowledge",
  points: "member_asset_mcp.get_member_points",
  recharges: "member_asset_mcp.list_recharge_records",
  consumption: "member_asset_mcp.list_consumption_records",
  level: "member_asset_mcp.get_member_level",
  face: "identity_permission_mcp.match_face_to_senior",
  permission: "identity_permission_mcp.check_data_permission",
});

const SCENARIOS = Object.freeze({
  "station-public-info-v1": [T.serviceDetail, T.serviceList, T.activities, T.knowledge],
  "member-self-service-v1": [T.points, T.recharges, T.consumption, T.level],
  "identity-and-permission-v1": [T.face, T.permission],
  "health-general-guidance-v1": [],
});

function selectScenario(text = "") {
  const value = String(text);
  if (/(头痛|头晕|失眠|睡不着|胸痛|呼吸困难|血糖|康复|按摩|用药|运动|锻炼|健康问题|不舒服|健康档案|健康测评|健康报告|健康风险)/.test(value)) return "health-general-guidance-v1";
  if (/(积分|充值|消费记录|会员等级|会员权益|余额)/.test(value)) return "member-self-service-v1";
  if (/(人脸|刷脸|身份认证|身份确认|数据权限|授权)/.test(value)) return "identity-and-permission-v1";
  return "station-public-info-v1";
}

function createScenarioSkillResolver({ root } = {}) {
  function resolve(text) {
    const id = selectScenario(text);
    const allowedTools = SCENARIOS[id] || [];
    const skillPath = root ? path.join(root, id, "SKILL.md") : null;
    const content = skillPath && fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : "";
    return { id, allowedTools, content };
  }
  return { resolve, describe: () => Object.entries(SCENARIOS).map(([id, allowedTools]) => ({ id, allowedTools })) };
}

module.exports = { SCENARIOS, selectScenario, createScenarioSkillResolver };
