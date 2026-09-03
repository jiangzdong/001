"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const CONFIG_VERSION = 1;
const MCP_SERVICES = Object.freeze([
  "health_risk_assessment_mcp",
  "health_evaluation_service_mcp_cms",
  "identity_permission_mcp",
  "member_asset_mcp",
  "station_content_mcp",
]);

const SERVER_ENV = Object.freeze({
  health_risk_assessment_mcp: "XIAOAN_MCP_HEALTH_RISK_URL",
  health_evaluation_service_mcp_cms: "XIAOAN_MCP_HEALTH_SERVICE_URL",
  identity_permission_mcp: "XIAOAN_MCP_IDENTITY_URL",
  member_asset_mcp: "XIAOAN_MCP_MEMBER_URL",
  station_content_mcp: "XIAOAN_MCP_STATION_CONTENT_URL",
});

function configError(message, code = "MCP_CONFIG_INVALID") {
  return Object.assign(new Error(message), { code });
}

function emptyServers() {
  return Object.fromEntries(MCP_SERVICES.map((name) => [name, { url: "", token: "" }]));
}

function isLocalHttpHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function normalizeMcpUrl(value) {
  const trimmed = String(value == null ? "" : value).trim();
  if (!trimmed) return "";
  let parsed;
  try { parsed = new URL(trimmed); } catch { throw configError("MCP URL 格式无效"); }
  if (parsed.username || parsed.password) throw configError("MCP URL 不允许包含账号信息");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalHttpHost(parsed.hostname.toLowerCase()))) {
    throw configError("MCP URL 仅允许 HTTPS；本机地址可使用 HTTP");
  }
  return parsed.href;
}

function normalizeToken(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw configError("MCP Token 必须为字符串");
  return value.trim();
}

function normalizeServers(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw configError("MCP 服务配置必须为对象");
  const unknown = Object.keys(input).filter((name) => !MCP_SERVICES.includes(name));
  if (unknown.length) throw configError(`不支持的 MCP 服务: ${unknown.join(", ")}`);
  const servers = emptyServers();
  for (const name of MCP_SERVICES) {
    const item = input[name] == null ? {} : input[name];
    if (!item || typeof item !== "object" || Array.isArray(item)) throw configError(`${name} 配置必须为对象`);
    servers[name] = { url: normalizeMcpUrl(item.url), token: normalizeToken(item.token) };
  }
  return servers;
}

function environmentServers(env = process.env) {
  const servers = emptyServers();
  const locks = Object.fromEntries(MCP_SERVICES.map((name) => [name, false]));
  const errors = Object.fromEntries(MCP_SERVICES.map((name) => [name, null]));
  for (const name of MCP_SERVICES) {
    const urlKey = SERVER_ENV[name];
    const tokenKey = `${urlKey}_TOKEN`;
    const hasUrl = Object.prototype.hasOwnProperty.call(env, urlKey) || Object.prototype.hasOwnProperty.call(env, "XIAOAN_MCP_URL");
    const hasToken = Object.prototype.hasOwnProperty.call(env, tokenKey) || Object.prototype.hasOwnProperty.call(env, "XIAOAN_MCP_BEARER_TOKEN");
    if (!hasUrl && !hasToken) continue;
    locks[name] = true;
    const rawUrl = Object.prototype.hasOwnProperty.call(env, urlKey) ? env[urlKey] : env.XIAOAN_MCP_URL;
    const rawToken = Object.prototype.hasOwnProperty.call(env, tokenKey) ? env[tokenKey] : env.XIAOAN_MCP_BEARER_TOKEN;
    try { servers[name] = { url: normalizeMcpUrl(rawUrl), token: normalizeToken(rawToken) }; }
    catch (error) { errors[name] = error.code || "MCP_CONFIG_INVALID"; }
  }
  return { servers, locks, errors };
}

function redactedStatus(servers, { locks = {}, errors = {}, source = "file", storage = "ok" } = {}) {
  return {
    storage,
    servers: Object.fromEntries(MCP_SERVICES.map((name) => [name, {
      configured: Boolean(servers[name]?.url),
      url: servers[name]?.url || "",
      locked: Boolean(locks[name]),
      source: locks[name] ? "environment" : source,
      error: errors[name] || null,
    }])),
  };
}

function createMcpConfigStore({
  filePath,
  env = process.env,
  fs = nodeFs,
  path = nodePath,
  encrypt,
  decrypt,
} = {}) {
  if (!filePath) throw configError("缺少 MCP 配置文件路径", "MCP_CONFIG_PATH_REQUIRED");
  if (typeof encrypt !== "function" || typeof decrypt !== "function") {
    throw configError("MCP 配置存储需要 encrypt/decrypt", "MCP_CONFIG_ENCRYPTION_REQUIRED");
  }
  let storageState = "missing";

  function readFileServers() {
    if (!fs.existsSync(filePath)) { storageState = "missing"; return emptyServers(); }
    try {
      const decrypted = decrypt(fs.readFileSync(filePath));
      const payload = JSON.parse(Buffer.isBuffer(decrypted) ? decrypted.toString("utf8") : String(decrypted));
      if (!payload || payload.version !== CONFIG_VERSION || Object.keys(payload).some((key) => key !== "version" && key !== "servers")) {
        throw configError("MCP 配置文件格式无效", "MCP_CONFIG_CORRUPT");
      }
      storageState = "ok";
      return normalizeServers(payload.servers);
    } catch {
      storageState = "corrupt";
      return emptyServers();
    }
  }

  function load() {
    const stored = readFileServers();
    const environment = environmentServers(env);
    const servers = emptyServers();
    for (const name of MCP_SERVICES) servers[name] = environment.locks[name] ? environment.servers[name] : stored[name];
    return servers;
  }

  function status() {
    const servers = load();
    const environment = environmentServers(env);
    return redactedStatus(servers, { locks: environment.locks, errors: environment.errors, storage: storageState });
  }

  function save(servers) {
    const normalized = normalizeServers(servers);
    const encrypted = encrypt(JSON.stringify({ version: CONFIG_VERSION, servers: normalized }));
    if (encrypted == null) throw configError("MCP 配置加密失败", "MCP_CONFIG_ENCRYPT_FAILED");
    const body = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(String(encrypted));
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tempPath, body, { mode: 0o600 });
      fs.chmodSync?.(tempPath, 0o600);
      fs.renameSync(tempPath, filePath);
      fs.chmodSync?.(filePath, 0o600);
      storageState = "ok";
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
    return load();
  }

  function clear() {
    try { fs.unlinkSync(filePath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    storageState = "missing";
    return load();
  }

  return { clear, load, save, status, filePath };
}

module.exports = {
  CONFIG_VERSION,
  MCP_SERVICES,
  SERVER_ENV,
  createMcpConfigStore,
  emptyServers,
  environmentServers,
  normalizeMcpUrl,
  normalizeServers,
  redactedStatus,
};
