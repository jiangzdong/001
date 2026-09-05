"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { JOURNEY } = require("./virtual-senior-live-journey.cjs");
const { ORACLE_VERSION, validateRoundTranscript } = require("./virtual-senior-voice-oracle.cjs");

const FIXTURE_VERSION = "virtual-senior-voice-regression-v1";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const manifestPayload = (manifest) => ({ ...manifest, integrity: undefined });
const manifestPayloadSha256 = (manifest) => sha256(Buffer.from(canonical(manifestPayload(manifest))));

function validationError(code, message) { return Object.assign(new Error(message), { code }); }

function validateFixtureManifest(manifest, fixtureDirectory, { verifyFiles = true } = {}) {
  if (!manifest || manifest.fixtureVersion !== FIXTURE_VERSION) throw validationError("FIXTURE_VERSION_INVALID", "固定 PCM 夹具版本不匹配");
  if (manifest.oracleVersion !== ORACLE_VERSION) throw validationError("FIXTURE_ORACLE_VERSION_INVALID", "固定 PCM 夹具 oracle 版本不匹配");
  if (!manifest.integrity?.payloadSha256 || manifest.integrity.payloadSha256 !== manifestPayloadSha256(manifest)) throw validationError("FIXTURE_MANIFEST_SHA_MISMATCH", "固定 PCM manifest 完整性校验失败");
  const expected = JOURNEY.map((item) => item.id);
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== expected.length) throw validationError("FIXTURE_ROUND_COUNT_INVALID", "固定 PCM 夹具必须恰有 22 轮");
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!expected.includes(entry.roundId) || seen.has(entry.roundId)) throw validationError("FIXTURE_ROUND_INVALID", "固定 PCM 夹具存在未知或重复轮次");
    seen.add(entry.roundId);
    const expectedQuestion = JOURNEY.find((item) => item.id === entry.roundId).question;
    if (entry.question !== expectedQuestion || entry.oracleVersion !== ORACLE_VERSION) throw validationError("FIXTURE_QUESTION_OR_ORACLE_INVALID", "固定 PCM 夹具问题或 oracle 不匹配当前脚本");
    if (typeof entry.pcmPath !== "string" || path.isAbsolute(entry.pcmPath) || entry.pcmPath.includes("..") || !/^[a-f0-9]{64}$/.test(entry.sha256 || "") || !Number.isInteger(entry.bytes) || entry.bytes <= 0 || entry.sampleRate !== 16000) throw validationError("FIXTURE_ENTRY_INVALID", "固定 PCM 夹具条目无效");
    const semantic = validateRoundTranscript(entry.roundId, entry.expectedTranscript);
    if (!semantic.valid) throw validationError("FIXTURE_ORACLE_TRANSCRIPT_INVALID", "固定 PCM 夹具来源转写未满足严格关键字");
    if (verifyFiles) {
      const bytes = fs.readFileSync(path.join(fixtureDirectory, entry.pcmPath));
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw validationError("FIXTURE_PCM_SHA_MISMATCH", "固定 PCM 文件缺失、长度或 SHA 不匹配");
    }
  }
  if (seen.size !== expected.length) throw validationError("FIXTURE_ROUND_SET_INVALID", "固定 PCM 夹具缺少必需轮次");
  return manifest;
}

module.exports = { FIXTURE_VERSION, sha256, canonical, manifestPayloadSha256, validateFixtureManifest };
