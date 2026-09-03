"use strict";

const { createMcpHttpClient } = require("./mcp-client.cjs");

const SERVER_ENV = Object.freeze({
  health_risk_assessment_mcp: "XIAOAN_MCP_HEALTH_RISK_URL",
  health_evaluation_service_mcp_cms: "XIAOAN_MCP_HEALTH_SERVICE_URL",
  identity_permission_mcp: "XIAOAN_MCP_IDENTITY_URL",
  member_asset_mcp: "XIAOAN_MCP_MEMBER_URL",
  station_content_mcp: "XIAOAN_MCP_STATION_CONTENT_URL",
});

function serverConfigFromEnvironment(env = process.env) {
  const commonUrl = String(env.XIAOAN_MCP_URL || "").trim();
  const commonToken = String(env.XIAOAN_MCP_BEARER_TOKEN || "").trim();
  return Object.fromEntries(Object.entries(SERVER_ENV).map(([name, key]) => [name, {
    url: String(env[key] || commonUrl).trim(),
    token: String(env[`${key}_TOKEN`] || commonToken).trim(),
  }]));
}

function createMcpGateway({ servers = serverConfigFromEnvironment(), localExecutors = {}, fetchImpl = globalThis.fetch, timeoutMs = 3000, clientVersion } = {}) {
  const clients = new Map();
  const configuredServers = Object.entries(servers).filter(([, config]) => config?.url);
  for (const [name, config] of configuredServers) {
    clients.set(name, createMcpHttpClient({ ...config, fetchImpl, timeoutMs, clientName: `xiaoan-${name}`, clientVersion }));
  }

  async function invoke(server, tool, args, context = {}) {
    const startedAt = Date.now();
    const client = clients.get(server);
    if (client) {
      const advertised = await client.listTools(context.signal);
      if (!advertised.some((item) => item?.name === tool)) {
        throw Object.assign(new Error(`MCP 服务未发布工具: ${server}/${tool}`), { code: "MCP_TOOL_NOT_FOUND" });
      }
      const data = await client.callTool(tool, args, context.signal);
      return { __mcpResult: true, data, meta: { server, tool, transport: "streamable-http", source: "remote", durationMs: Date.now() - startedAt } };
    }
    const local = localExecutors[`${server}.${tool}`];
    if (!local) throw Object.assign(new Error(`MCP 服务未配置: ${server}`), { code: "MCP_SERVER_NOT_CONFIGURED" });
    const data = await local(args || {}, context);
    return { __mcpResult: true, data, meta: { server, tool, transport: "in-process", source: "local-unconfigured", durationMs: Date.now() - startedAt } };
  }

  function status() {
    return {
      protocolVersion: "2025-06-18",
      mode: clients.size ? (clients.size === Object.keys(SERVER_ENV).length ? "remote" : "hybrid") : "local-unconfigured",
      servers: Object.keys(SERVER_ENV).map((name) => ({ name, configured: clients.has(name), transport: clients.has(name) ? "streamable-http" : "in-process" })),
    };
  }

  return { invoke, status };
}

module.exports = { SERVER_ENV, createMcpGateway, serverConfigFromEnvironment };
