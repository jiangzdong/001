"use strict";

// QA-only scripted conversation. Not an LLM planner or a production consent flow.
const { MCP_TOOL_CATALOG } = require("./mcp-tools.cjs");
const H = "health_risk_assessment_mcp";
const S = "health_evaluation_service_mcp_cms";
const I = "identity_permission_mcp";
const M = "member_asset_mcp";
const C = "station_content_mcp";
const step = (id, title, question, tool, extra = {}) => ({ id, title, question, tool, intent: `qa.journey.${id}`, ...extra });
const JOURNEY = Object.freeze([
  step("services", "站点服务", "站点现在有哪些服务？", `${S}.list_station_services_brief`),
  step("service-detail", "服务追问", "刚才列出的第一项服务，几点开放？需要预约吗？", `${S}.get_station_service_detail`, { dependsOn: "services" }),
  step("knowledge", "站点知识", "这些服务的使用说明在哪里？", `${C}.search_station_knowledge`),
  step("activities", "站点活动", "再看看站点有哪些活动。", `${C}.list_station_activities`),
  step("activities-next", "活动翻页", "还有吗？继续看下一页活动。", `${C}.list_station_activities`, { dependsOn: "activities" }),
  step("identity", "合成身份核验", "使用我的合成授权凭据核验测试身份，不采集真实人脸。", `${I}.match_face_to_senior`),
  step("permission", "访问授权", "接下来查询我的资料，请校验我的访问权限。", `${I}.check_data_permission`),
  step("profile", "长者档案", "查看我的档案摘要。", `${S}.get_senior_profile`),
  step("points", "会员积分", "我的会员积分还有多少？", `${M}.get_member_points`),
  step("level", "会员等级", "那我的会员等级和权益呢？", `${M}.get_member_level`),
  step("recharge", "充值记录", "查看我的充值记录。", `${M}.list_recharge_records`),
  step("recharge-next", "充值追问", "继续看下一页充值记录。", `${M}.list_recharge_records`, { dependsOn: "recharge" }),
  step("consumption", "消费记录", "再查一下我的消费明细。", `${M}.list_consumption_records`),
  step("consumption-next", "消费追问", "还有哪些消费？接着上一页往后看。", `${M}.list_consumption_records`, { dependsOn: "consumption" }),
  step("context", "健康上下文", "我的健康档案有哪些历史资料？", `${H}.get_risk_assessment_context`),
  step("vitals", "最新体征", "查看我的最新健康体征及记录时间。", `${H}.get_latest_health_labels`),
  step("history", "半年体征", "再看我近半年的体征记录。", `${H}.get_indicator_evidence`),
  step("history-next", "体征追问", "接着刚才的体征记录，继续查看下一页。", `${H}.get_indicator_evidence`, { dependsOn: "history" }),
  step("evaluations", "健康测评", "我的健康测评记录呢？", `${S}.get_health_evaluation_results`),
  step("evaluation-latest", "测评追问", "只看最新一份测评。", `${S}.get_health_evaluation_results`),
  step("save", "合成结果保存", "我确认仅在合成测试区保存基于刚才证据的测试草稿，不作诊断。", `${H}.save_risk_assessment_result`, { dependsOn: "history" }),
  step("save-replay", "重复提交检查", "刚才那份合成草稿再提交一次，检查会不会重复保存。", `${H}.save_risk_assessment_result`, { dependsOn: "save" }),
]);
const FULL_JOURNEY = Object.freeze({ id: "full-journey", title: `完整场景多轮测试（${JOURNEY.length} 轮）`, turnCount: JOURNEY.length, mcpCount: 5, toolCount: 16 });

function argumentsFor(s, resident, completed, runId) {
  const args = { seniorId: resident.seniorId, orgId: resident.orgId };
  const previous = completed.get(s.dependsOn)?.data;
  if (s.dependsOn && !previous) return { skip: "前一轮未取得可用结果，本轮不伪造关联数据。", reason: "DEPENDENCY_UNAVAILABLE" };
  if (s.id.endsWith("-next") && !previous.nextCursor) return { skip: "上一页已是最后一页，没有更多记录。", reason: "NO_MORE_RECORDS" };
  if (s.id.endsWith("-next")) args.cursor = previous.nextCursor;
  if (s.tool.startsWith(C) || s.id === "services" || s.id === "service-detail") delete args.seniorId;
  if (s.id === "services") Object.assign(args, { enabledOnly: true, limit: 3 });
  if (s.id === "service-detail") {
    if (!previous.items?.[0]?.serviceId) return { skip: "没有可追问的服务条目。", reason: "NO_SERVICE" };
    args.serviceId = previous.items[0].serviceId;
  }
  if (s.id === "knowledge") Object.assign(args, { query: "站点服务", limit: 3 });
  if (/activities|recharge|consumption/.test(s.id)) args.limit = 3;
  if (s.id === "identity") Object.assign(args, { captureToken: `synthetic-capture-${runId}`, consentId: `consent-${resident.seniorId}-1` });
  if (s.id === "permission") Object.assign(args, { operatorId: "synthetic-qa", action: "member:read:self" });
  if (s.id === "vitals") Object.assign(args, { seniorId: String(resident.seniorId), orgId: String(resident.orgId), tenantId: String(resident.tenantId), types: "all" });
  if (s.id.startsWith("history")) Object.assign(args, { signsTypeList: [], timeType: 180, limit: 8 });
  if (s.id === "evaluation-latest") args.latestOnly = true;
  if (s.id === "save") {
    if (!previous.evidence?.length) return { skip: "没有可用健康证据，不生成或保存空研判。", reason: "NO_HEALTH_EVIDENCE" };
    Object.assign(args, { seniorId: String(resident.seniorId), orgId: String(resident.orgId), idempotencyKey: `${runId}-risk`, riskAssessmentDraft: { level: resident.healthState.includes("attention") ? "attention" : "routine", evidence: previous.evidence.map((item) => item.evidenceId), synthetic: true, clinicalUse: false, userConfirmed: true } });
  }
  if (s.id === "save-replay") return { args: structuredClone(completed.get("save").arguments) };
  return { args };
}

function describeJourney(s, data) {
  const items = data.items || [];
  if (s.id === "services") return `合成站点服务：${items.map((item) => item.name).join("、") || "暂无可用条目"}。`;
  if (s.id === "service-detail") return `${data.name}：${data.schedule}；${data.bookingRequired ? "需要预约" : "无需预约"}。地点：${data.location || "尚未提供"}。`;
  if (s.id === "knowledge") return items.map((item) => `${item.title}：${item.summary}`).join("\n") || "没有可用的站点说明。";
  if (s.id.startsWith("activities")) return items.map((item) => `${item.title}，${item.startsAt?.slice(0, 10)}，${({ open: "开放", full: "已满", cancelled: "已取消", ended: "已结束" })[item.status] || "状态待核实"}；地点${item.location || "尚未提供"}`).join("。") || "没有更多活动。";
  if (s.id === "identity") return data.outcome === "MATCHED" ? "合成身份已匹配当前测试居民，未采集或保存真实人脸。" : "合成身份未匹配或授权已失效，不能视为身份核验成功。";
  if (s.id === "permission") return data.decision === "ALLOW" ? "合成数据服务已允许访问本人资料。" : "未取得访问许可，不读取个人业务数据。";
  if (s.id === "profile") return `测试档案 ${data.profile.displayCode}，年龄段 ${data.profile.ageBand}，资料质量${({ complete: "完整", partial: "部分缺失", stale: "过期", conflicting: "存在冲突" })[data.profile.dataQuality] || "待核实"}。`;
  if (s.id === "points") return `该合成长者当前有 ${data.points} 积分。`;
  if (s.id === "level") return data.level ? `会员等级：${data.level}。权益：${data.benefits.map((item) => item.name).join("、") || "暂无有效权益"}。` : "该合成长者目前不是会员。";
  if (/recharge|consumption/.test(s.id)) return `共 ${data.total} 条记录，本页 ${items.length} 条：${items.map((item) => `${item.recordId}，${item.amount} 元`).join("；")}。`;
  if (s.id === "context") return `合成档案有 ${data.indicatorSummary.evidenceCount} 条体征证据、${data.riskHistory.length} 份历史研判记录。仅测试，不作诊断。`;
  if (s.id === "vitals") return data.vitalSigns.length ? data.vitalSigns.map((item) => `${item.displayName || item.metric} ${item.value} ${item.unit}（${item.observedAt.slice(0, 10)}）`).join("；") + "。仅合成记录，不作诊断；过期或冲突数据不可当作当前体征。" : "没有可用体征记录，不用默认值填充。";
  if (s.id.startsWith("history")) return `近半年共 ${data.total} 条体征记录，本页 ${data.evidence.length} 条。${data.evidence.slice(0, 2).map((item) => `${item.displayName || item.metric} ${item.value} ${item.unit}（${item.observedAt.slice(0, 10)}）`).join("；")}`;
  if (s.id.startsWith("evaluation")) return `查到 ${data.results.length} 份合成测评。${data.results.map((item) => `${({ functional: "功能", nutrition: "营养", "fall-risk": "跌倒风险", cognition: "认知" })[item.type] || item.type}：${item.score} 分`).join("；")}。不作临床判断。`;
  if (s.id.startsWith("save")) return `${data.replayed ? "重复请求返回同一记录，没有新建记录" : "合成草稿已保存"}，结果编号 ${data.resultId}，关联 ${data.assessment.evidenceIds.length} 条证据。仅限本次测试区。`;
  throw new Error("Missing journey response formatter");
}

function coverageFor(turns, events, planned) {
  const tools = MCP_TOOL_CATALOG.filter(([server, name]) => planned.some((s) => s.tool === `${server}.${name}`)).map(([server, name, title]) => {
    const tool = `${server}.${name}`;
    const calls = events.filter((e) => e.type === "tool-start" && e.payload.tool === tool).length;
    const successes = events.filter((e) => e.type === "tool-complete" && e.payload.tool === tool && e.payload.businessOutcome === "completed").length;
    const selected = turns.filter((t) => t.tool === tool);
    return { tool, server, title, calls, successes, blocked: selected.filter((t) => ["denied", "auth_required"].includes(t.status)).length, failed: selected.filter((t) => t.status === "failed").length, skipped: selected.filter((t) => t.status === "skipped").length };
  });
  return { plannedTools: tools.length, calledTools: tools.filter((t) => t.calls).length, successfulTools: tools.filter((t) => t.successes).length, plannedMcp: new Set(tools.map((t) => t.server)).size, calledMcp: new Set(tools.filter((t) => t.calls).map((t) => t.server)).size, totalTurns: planned.length, renderedTurns: turns.filter((t) => t.rendered).length, completedTurns: turns.filter((t) => t.rendered && t.status === "completed").length, blockedTurns: turns.filter((t) => ["denied", "auth_required"].includes(t.status)).length, failedTurns: turns.filter((t) => t.status === "failed").length, skippedTurns: turns.filter((t) => t.status === "skipped").length, tools };
}

module.exports = { JOURNEY, FULL_JOURNEY, argumentsFor, describeJourney, coverageFor };
