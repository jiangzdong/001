"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { MCP_PROTOCOL_VERSION } = require("./mcp-client.cjs");
const { MCP_TOOL_CATALOG } = require("./mcp-tools.cjs");
const { createCommunityDataset } = require("./virtual-senior-community-dataset.cjs");

const TOOL_RESULTS = Object.freeze({
  "health_evaluation_service_mcp_cms.get_station_service_detail": {
    serviceId: "meal_service", name: "助餐服务", schedule: "11:30 至 13:00", speechSchedule: "十一点半到十三点", location: "一楼助餐区", bookingRequired: false,
    factIds: ["fixture:service:meal:20260903"], source: "test-fixture",
  },
  "health_evaluation_service_mcp_cms.list_station_services_brief": {
    items: [{ serviceId: "meal_service", name: "助餐服务" }], factIds: ["fixture:service:list:20260903"], source: "test-fixture",
  },
  "station_content_mcp.list_station_activities": {
    items: [
      { activityId: "health_lecture", title: "健康讲堂", summary: "今天下午讲解秋季血压管理。", location: "二楼活动室" },
      { activityId: "baduanjin", title: "八段锦", summary: "今天上午安排基础练习。", location: "一楼多功能区" },
    ],
    factIds: ["fixture:activity:today:20260903"], source: "test-fixture",
  },
  "station_content_mcp.search_station_knowledge": {
    items: [{ title: "站点服务", summary: "测试资料仅用于虚拟长者回归。" }], factIds: ["fixture:knowledge:20260903"], source: "test-fixture",
  },
  "member_asset_mcp.get_member_points": {
    total: 2680, asOf: "2026-09-03T16:20:00+08:00", factIds: ["fixture:member:points:001"], source: "test-fixture",
  },
  "member_asset_mcp.get_member_level": {
    level: "银龄会员", factIds: ["fixture:member:level:001"], source: "test-fixture",
  },
  "member_asset_mcp.list_recharge_records": { items: [], factIds: ["fixture:member:recharge:empty"], source: "test-fixture" },
  "member_asset_mcp.list_consumption_records": { items: [], factIds: ["fixture:member:consumption:empty"], source: "test-fixture" },
  "identity_permission_mcp.check_data_permission": {
    decision: "ALLOW", reasonCode: "VERIFIED_SELF", authorizationId: "fixture-authz-001", expiresAt: "2026-09-03T16:25:00+08:00", source: "test-fixture",
  },
});

function writeJson(response, status, payload, headers = {}) {
  const body = payload == null ? "" : JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers });
  response.end(body);
}

function toolsForServer(serverName, fault = {}) {
  return MCP_TOOL_CATALOG.filter(([server, tool]) => server === serverName && tool !== fault.missingTool).map(([, tool, description, , , required]) => ({
    name: tool,
    description,
    inputSchema: { type: "object", properties: Object.fromEntries(required.map((key) => [key, {}])), required },
  }));
}

function createVirtualSeniorFixtureMcp({ dataset = createCommunityDataset() } = {}) {
  let server;
  let origin = "";
  let faults = {};

  function configure(nextFaults = {}) {
    faults = nextFaults && typeof nextFaults === "object" ? structuredClone(nextFaults) : {};
  }

  async function handle(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const serverName = url.searchParams.get("server") || "";
    const fault = faults[serverName] || {};
    if (fault.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(10000, Number(fault.delayMs) || 0)));
    if (fault.httpStatus) return writeJson(response, Number(fault.httpStatus), { error: "fixture fault" });
    let raw = "";
    for await (const chunk of request) raw += chunk;
    let message;
    try { message = JSON.parse(raw || "{}"); }
    catch { return writeJson(response, 400, { error: "invalid json" }); }
    const headers = { "Mcp-Session-Id": request.headers["mcp-session-id"] || `fixture-${crypto.randomUUID()}` };
    if (message.method === "notifications/initialized") return writeJson(response, 202, null, headers);
    if (message.method === "initialize") return writeJson(response, 200, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: `virtual-senior-${serverName}`, version: "1.0.0" } } }, headers);
    if (message.method === "tools/list") return writeJson(response, 200, { jsonrpc: "2.0", id: message.id, result: { tools: toolsForServer(serverName, fault) } }, headers);
    if (message.method === "tools/call") {
      const toolName = String(message.params?.name || "");
      const key = `${serverName}.${toolName}`;
      if (!toolsForServer(serverName, fault).some((item) => item.name === toolName)) {
        return writeJson(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "fixture tool not found" } }, headers);
      }
      // No generic success fallback is permitted. Every catalogued Tool resolves
      // through the versioned synthetic community data contract.
      const data = dataset.toolResponse(key, message.params?.arguments || {});
      if (data?.error) return writeJson(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: data.error.message, data: { code: data.error.code } } }, headers);
      return writeJson(response, 200, { jsonrpc: "2.0", id: message.id, result: { structuredContent: structuredClone(data), content: [{ type: "text", text: JSON.stringify(data) }] } }, headers);
    }
    return writeJson(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } }, headers);
  }

  async function start() {
    if (server) return origin;
    server = http.createServer((request, response) => { void handle(request, response).catch((error) => writeJson(response, 500, { error: error?.message || "fixture error" })); });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    origin = `http://127.0.0.1:${server.address().port}/mcp`;
    return origin;
  }

  function serverConfigs() {
    if (!origin) throw new Error("虚拟长者 Fixture MCP 尚未启动");
    return Object.fromEntries([...new Set(MCP_TOOL_CATALOG.map(([name]) => name))].map((name) => [name, { url: `${origin}?server=${encodeURIComponent(name)}`, token: "" }]));
  }

  async function close() {
    const current = server;
    server = null;
    origin = "";
    if (current) await new Promise((resolve) => current.close(resolve));
  }

  return { close, configure, dataset: () => ({ datasetVersion: dataset.datasetVersion, generatorVersion: dataset.generatorVersion, profile: dataset.profile, residents: dataset.residents, totalRecords: dataset.totalRecords, manifestHash: dataset.manifestHash, tools: dataset.tools, contractStates: dataset.contractStates, coverage: dataset.coverage(), dataClassification: dataset.dataClassification }), serverConfigs, start, status: () => ({ running: Boolean(server), origin: origin ? new URL(origin).origin : null, source: "test-fixture", dataset: { datasetVersion: dataset.datasetVersion, profile: dataset.profile, residents: dataset.residents, manifestHash: dataset.manifestHash } }) };
}

module.exports = { TOOL_RESULTS, createVirtualSeniorFixtureMcp, toolsForServer };
