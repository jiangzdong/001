import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createDeepSeekCredentialStore } = require("../electron/deepseek-credential-store.cjs");
const TEST_KEY = "sk-test_key_1234567890";

function temporaryCredential(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoan-deepseek-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "deepseek.credential");
}

test("async safeStorage saves atomically, restores after restart and never writes plaintext", async (t) => {
  const filePath = temporaryCredential(t);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`),
    decryptStringAsync: async (value) => ({ result: Buffer.from(String(value).slice(10), "base64").toString(), shouldReEncrypt: false }),
  };
  const first = createDeepSeekCredentialStore({ filePath, safeStorage, platform: "darwin", environment: {} });
  assert.deepEqual(await first.save(TEST_KEY), { ok: true, configured: true, storage: "safe-storage-async" });
  assert.equal(first.load(), TEST_KEY);
  assert.equal(fs.readFileSync(filePath, "utf8").includes(TEST_KEY), false);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ["deepseek.credential"]);

  const reopened = createDeepSeekCredentialStore({ filePath, safeStorage, platform: "darwin", environment: {} });
  assert.equal(await reopened.initialize(), TEST_KEY);
  assert.equal(reopened.load(), TEST_KEY);
  assert.deepEqual(reopened.clear(), { ok: true, configured: false });
  assert.equal(fs.existsSync(filePath), false);
});

test("async restore rotates an old encrypted value when the platform requests it", async (t) => {
  const filePath = temporaryCredential(t);
  fs.writeFileSync(filePath, "old", { mode: 0o600 });
  let encrypted = 0;
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    decryptStringAsync: async () => ({ result: TEST_KEY, shouldReEncrypt: true }),
    encryptStringAsync: async () => { encrypted += 1; return Buffer.from("rotated"); },
  };
  const store = createDeepSeekCredentialStore({ filePath, safeStorage, platform: "darwin", environment: {} });
  assert.equal(await store.initialize(), TEST_KEY);
  assert.equal(encrypted, 1);
  assert.equal(fs.readFileSync(filePath, "utf8"), "rotated");
});

test("older Electron uses synchronous safeStorage and unavailable Windows storage fails closed", async (t) => {
  const filePath = temporaryCredential(t);
  const synchronous = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`secure:${value}`),
    decryptString: (value) => String(value).slice(7),
  };
  const legacy = createDeepSeekCredentialStore({ filePath, safeStorage: synchronous, platform: "win32", environment: {} });
  await legacy.save(TEST_KEY);
  const reopened = createDeepSeekCredentialStore({ filePath, safeStorage: synchronous, platform: "win32", environment: {} });
  assert.equal(await reopened.initialize(), TEST_KEY);

  const unavailable = createDeepSeekCredentialStore({ filePath: `${filePath}.blocked`, safeStorage: { isAsyncEncryptionAvailable: async () => false }, platform: "win32", environment: {} });
  await assert.rejects(unavailable.save(TEST_KEY), /Windows 加密服务暂不可用/);
  assert.equal(fs.existsSync(`${filePath}.blocked`), false);
});

test("macOS falls back to private AES-GCM files when Keychain rejects an unsigned build", async (t) => {
  const filePath = temporaryCredential(t);
  const unavailable = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => { throw new Error("Keychain rejected this build"); },
    decryptStringAsync: async () => { throw new Error("Keychain rejected this build"); },
    isEncryptionAvailable: () => false,
  };
  const first = createDeepSeekCredentialStore({ filePath, safeStorage: unavailable, platform: "darwin", environment: {} });
  assert.deepEqual(await first.save(TEST_KEY), { ok: true, configured: true, storage: "local-aes-gcm" });
  const stored = fs.readFileSync(filePath, "utf8");
  assert.match(stored, /^XIAOAN-LOCAL-AES-GCM-V1/);
  assert.equal(stored.includes(TEST_KEY), false);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${filePath}.key`).mode & 0o777, 0o600);

  const reopened = createDeepSeekCredentialStore({ filePath, safeStorage: unavailable, platform: "darwin", environment: {} });
  assert.equal(await reopened.initialize(), TEST_KEY);
  assert.equal(reopened.load(), TEST_KEY);
  reopened.clear();
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(`${filePath}.key`), false);
});

test("a failing async provider retries the working synchronous macOS Keychain provider", async (t) => {
  const filePath = temporaryCredential(t);
  const provider = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => { throw new Error("async provider unavailable"); },
    decryptStringAsync: async () => { throw new Error("async provider unavailable"); },
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sync:${value}`),
    decryptString: (value) => String(value).slice(5),
  };
  const first = createDeepSeekCredentialStore({ filePath, safeStorage: provider, platform: "darwin", environment: {} });
  assert.deepEqual(await first.save(TEST_KEY), { ok: true, configured: true, storage: "safe-storage-sync" });
  const reopened = createDeepSeekCredentialStore({ filePath, safeStorage: provider, platform: "darwin", environment: {} });
  assert.equal(await reopened.initialize(), TEST_KEY);
});

test("invalid keys are rejected before the encryption provider is touched", async (t) => {
  let checked = false;
  const store = createDeepSeekCredentialStore({
    filePath: temporaryCredential(t),
    safeStorage: { isAsyncEncryptionAvailable: async () => { checked = true; return true; } },
    environment: {},
  });
  await assert.rejects(store.save("not-a-key"), /密钥格式不正确/);
  assert.equal(checked, false);
});
