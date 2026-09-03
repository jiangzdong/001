import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import configModule from "../electron/harness/mcp-config.cjs";

const { MCP_SERVICES, createMcpConfigStore, normalizeMcpUrl } = configModule;
const crypto = {
  encrypt: (text) => Buffer.from(Buffer.from(text).toString("base64")),
  decrypt: (data) => Buffer.from(Buffer.from(data).toString("utf8"), "base64").toString("utf8"),
};

function fixture(config = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoan-mcp-config-"));
  const filePath = path.join(directory, "mcp-config.enc");
  return { directory, filePath, store: createMcpConfigStore({ filePath, ...crypto, ...config }) };
}

test("fixed five-service schema trims URLs and permits HTTP only for loopback", () => {
  const { store, directory } = fixture();
  try {
    const saved = store.save({ station_content_mcp: { url: " https://mcp.example.test/rpc ", token: " token " } });
    assert.deepEqual(Object.keys(saved), MCP_SERVICES);
    assert.equal(saved.station_content_mcp.url, "https://mcp.example.test/rpc");
    assert.equal(saved.station_content_mcp.token, "token");
    assert.equal(normalizeMcpUrl("http://localhost:8787/mcp"), "http://localhost:8787/mcp");
    assert.equal(normalizeMcpUrl("http://127.0.0.1:8787/mcp"), "http://127.0.0.1:8787/mcp");
    assert.equal(normalizeMcpUrl("http://[::1]:8787/mcp"), "http://[::1]:8787/mcp");
    assert.throws(() => normalizeMcpUrl("http://mcp.example.test/rpc"), { code: "MCP_CONFIG_INVALID" });
    assert.throws(() => store.save({ unknown_mcp: {} }), { code: "MCP_CONFIG_INVALID" });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("encrypted writes are atomic, owner-only, and status never includes tokens", () => {
  const operations = [];
  const fsSpy = new Proxy(fs, { get(target, property) {
    const value = target[property];
    if (property === "writeFileSync" || property === "renameSync") return (...args) => { operations.push([property, ...args]); return value(...args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const { store, filePath, directory } = fixture({ fs: fsSpy, path });
  try {
    store.save({ identity_permission_mcp: { url: "https://identity.example.test/mcp", token: "never-leak-this-token" } });
    const stat = fs.statSync(filePath);
    assert.equal(stat.mode & 0o777, 0o600);
    const write = operations.find(([name]) => name === "writeFileSync");
    const rename = operations.find(([name]) => name === "renameSync");
    assert.equal(write[3].mode, 0o600);
    assert.match(write[1], /\.mcp-config\.enc\./);
    assert.deepEqual(rename.slice(1), [write[1], filePath]);
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /never-leak-this-token/);
    const status = store.status();
    assert.doesNotMatch(JSON.stringify(status), /never-leak-this-token/);
    assert.equal(status.servers.identity_permission_mcp.configured, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("corrupt encrypted data fails closed and clear removes persisted configuration", () => {
  const { store, filePath, directory } = fixture();
  try {
    fs.writeFileSync(filePath, "not encrypted JSON", { mode: 0o600 });
    assert.deepEqual(store.load(), Object.fromEntries(MCP_SERVICES.map((name) => [name, { url: "", token: "" }])));
    assert.equal(store.status().storage, "corrupt");
    store.clear();
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(store.status().storage, "missing");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("environment configuration has priority, locks the service, and malformed values do not fall back", () => {
  const env = { XIAOAN_MCP_STATION_CONTENT_URL: "http://insecure.example.test/mcp", XIAOAN_MCP_STATION_CONTENT_URL_TOKEN: "environment-secret" };
  const { store, directory } = fixture({ env });
  try {
    store.save({ station_content_mcp: { url: "https://saved.example.test/mcp", token: "saved-secret" } });
    const loaded = store.load();
    assert.deepEqual(loaded.station_content_mcp, { url: "", token: "" });
    const item = store.status().servers.station_content_mcp;
    assert.equal(item.locked, true);
    assert.equal(item.source, "environment");
    assert.equal(item.error, "MCP_CONFIG_INVALID");
    assert.doesNotMatch(JSON.stringify(store.status()), /environment-secret|saved-secret/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
