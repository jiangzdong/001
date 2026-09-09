"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;
const LOCAL_ENVELOPE_PREFIX = "XIAOAN-LOCAL-AES-GCM-V1\n";
const LOCAL_ENVELOPE_AAD = Buffer.from("com.clife.xiaoan.deepseek-credential:v1");

function storageUnavailableMessage(platform) {
  if (platform === "darwin") return "macOS 钥匙串暂不可用，请解锁系统钥匙串后重试";
  if (platform === "win32") return "Windows 加密服务暂不可用，请重新登录系统后重试";
  return "系统安全存储暂不可用，请检查当前桌面密钥服务";
}

function createDeepSeekCredentialStore({ filePath, safeStorage, platform = process.platform, environment = process.env } = {}) {
  if (!filePath || !safeStorage) throw new TypeError("DeepSeek credential store requires filePath and safeStorage");
  let cachedKey = "";
  const localKeyPath = `${filePath}.key`;

  const environmentKey = () => {
    const value = String(environment?.DEEPSEEK_API_KEY || "").trim();
    return KEY_PATTERN.test(value) ? value : "";
  };

  async function isAsyncEncryptionAvailable() {
    try {
      return typeof safeStorage.isAsyncEncryptionAvailable === "function"
        && Boolean(await safeStorage.isAsyncEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function isSyncEncryptionAvailable() {
    try {
      return typeof safeStorage.isEncryptionAvailable === "function"
        && Boolean(safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  async function isEncryptionAvailable() {
    return await isAsyncEncryptionAvailable() || isSyncEncryptionAvailable() || platform === "darwin";
  }

  async function encryptWithSafeStorage(value) {
    let lastError;
    if (typeof safeStorage.encryptStringAsync === "function" && await isAsyncEncryptionAvailable()) {
      try {
        return { value: Buffer.from(await safeStorage.encryptStringAsync(value)), backend: "safe-storage-async" };
      } catch (error) {
        lastError = error;
      }
    }
    if (typeof safeStorage.encryptString === "function" && isSyncEncryptionAvailable()) {
      try {
        return { value: Buffer.from(safeStorage.encryptString(value)), backend: "safe-storage-sync" };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(storageUnavailableMessage(platform));
  }

  async function decryptWithSafeStorage(value) {
    let lastError;
    if (typeof safeStorage.decryptStringAsync === "function" && await isAsyncEncryptionAvailable()) {
      try {
        const decrypted = await safeStorage.decryptStringAsync(value);
        if (typeof decrypted === "string") return { result: decrypted, shouldReEncrypt: false };
        return { result: String(decrypted?.result || ""), shouldReEncrypt: Boolean(decrypted?.shouldReEncrypt) };
      } catch (error) {
        lastError = error;
      }
    }
    if (typeof safeStorage.decryptString === "function" && isSyncEncryptionAvailable()) {
      try {
        return { result: safeStorage.decryptString(value), shouldReEncrypt: false };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(storageUnavailableMessage(platform));
  }

  function writePrivateFile(targetPath, value) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, targetPath);
      fs.chmodSync(targetPath, 0o600);
    } finally {
      try { if (fs.existsSync(temporary)) fs.rmSync(temporary); } catch {}
    }
  }

  function localKey({ create = false } = {}) {
    if (fs.existsSync(localKeyPath)) {
      const value = fs.readFileSync(localKeyPath);
      if (value.length !== 32) throw new Error("本机密钥文件已损坏，请清除配置后重新保存");
      try { fs.chmodSync(localKeyPath, 0o600); } catch {}
      return value;
    }
    if (!create) throw new Error("本机密钥文件不存在，请重新保存 DeepSeek 密钥");
    const value = crypto.randomBytes(32);
    writePrivateFile(localKeyPath, value);
    return value;
  }

  function encryptLocally(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", localKey({ create: true }), iv);
    cipher.setAAD(LOCAL_ENVELOPE_AAD);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.from(`${LOCAL_ENVELOPE_PREFIX}${JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    })}`);
  }

  function decryptLocally(value) {
    const text = Buffer.from(value).toString("utf8");
    if (!text.startsWith(LOCAL_ENVELOPE_PREFIX)) throw new Error("不是本机加密格式");
    const envelope = JSON.parse(text.slice(LOCAL_ENVELOPE_PREFIX.length));
    const decipher = crypto.createDecipheriv("aes-256-gcm", localKey(), Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(LOCAL_ENVELOPE_AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  }

  function isLocalEnvelope(value) {
    return Buffer.from(value).subarray(0, LOCAL_ENVELOPE_PREFIX.length).toString("utf8") === LOCAL_ENVELOPE_PREFIX;
  }

  function removeLocalKey() {
    try { if (fs.existsSync(localKeyPath)) fs.rmSync(localKeyPath); } catch {}
  }

  async function initialize() {
    cachedKey = environmentKey();
    if (cachedKey || !fs.existsSync(filePath)) return cachedKey;
    try {
      const stored = fs.readFileSync(filePath);
      if (isLocalEnvelope(stored)) {
        cachedKey = decryptLocally(stored);
        if (!KEY_PATTERN.test(cachedKey)) return "";
        try {
          const migrated = await encryptWithSafeStorage(cachedKey);
          writePrivateFile(filePath, migrated.value);
          removeLocalKey();
        } catch {}
        return cachedKey;
      }
      const decrypted = await decryptWithSafeStorage(stored);
      if (!KEY_PATTERN.test(decrypted.result)) return "";
      cachedKey = decrypted.result;
      if (decrypted.shouldReEncrypt) writePrivateFile(filePath, (await encryptWithSafeStorage(cachedKey)).value);
    } catch {
      cachedKey = "";
    }
    return cachedKey;
  }

  async function save(key) {
    const clean = String(key || "").trim();
    if (!KEY_PATTERN.test(clean)) throw new Error("密钥格式不正确");
    let stored;
    let backend;
    try {
      const encrypted = await encryptWithSafeStorage(clean);
      stored = encrypted.value;
      backend = encrypted.backend;
    } catch (error) {
      if (platform !== "darwin") throw new Error(storageUnavailableMessage(platform), { cause: error });
      stored = encryptLocally(clean);
      backend = "local-aes-gcm";
    }
    writePrivateFile(filePath, stored);
    if (backend !== "local-aes-gcm") removeLocalKey();
    cachedKey = clean;
    return { ok: true, configured: true, storage: backend };
  }

  function load() {
    return environmentKey() || cachedKey;
  }

  function clear() {
    cachedKey = "";
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    removeLocalKey();
    return { ok: true, configured: false };
  }

  return { initialize, save, load, clear, isEncryptionAvailable };
}

module.exports = { KEY_PATTERN, createDeepSeekCredentialStore, storageUnavailableMessage };
