"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PERSONAS, SCENARIOS } = require("./virtual-senior-catalog.cjs");
const { analyzeVirtualSeniorReports } = require("./virtual-senior-analysis.cjs");
const { validateStrictSchema } = require("./virtual-senior-variant-artifacts.cjs");

const REAL_ASR_PROVIDER = "sherpa-onnx-sensevoice-local";
const PERSONA_IDS = Object.freeze(PERSONAS.map((item) => item.personaId));
const SCENARIO_IDS = Object.freeze(SCENARIOS.map((item) => item.scenarioId));
const SHA256_PATTERN = "^[a-f0-9]{64}$";
const SENSITIVE_TEXT_PATTERNS = Object.freeze([/\b1[3-9]\d{9}\b/, /\b\d{17}[\dXx]\b/, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, /\bsk-[a-zA-Z0-9_-]{12,}\b/, /\bBearer\s+[a-zA-Z0-9._-]{12,}\b/i]);

const ASR_MANIFEST_SCHEMA = Object.freeze({
  $id: "xiaoan.virtual-senior.fixed-wav-asr-manifest.v1",
  type: "object",
  additionalProperties: false,
  required: ["manifestVersion", "dataClassification", "audioFormat", "cases"],
  properties: {
    manifestVersion: { type: "string", const: "1.0.0" },
    dataClassification: { type: "string", const: "synthetic-test-only" },
    audioFormat: {
      type: "object",
      additionalProperties: false,
      required: ["container", "codec", "channels", "sampleRate"],
      properties: {
        container: { type: "string", const: "wav" },
        codec: { type: "string", const: "pcm_s16le" },
        channels: { type: "integer", const: 1 },
        sampleRate: { type: "integer", const: 16000 },
      },
    },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caseId", "dataClassification", "personaId", "scenarioId", "relativePath", "sha256", "expectedText", "maxCer", "audioCondition", "sourceGenerator"],
        properties: {
          caseId: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Z0-9_-]+$" },
          dataClassification: { type: "string", const: "synthetic-test-only" },
          personaId: { type: "string", enum: PERSONA_IDS },
          scenarioId: { type: "string", enum: SCENARIO_IDS },
          relativePath: { type: "string", minLength: 5, maxLength: 240, pattern: "^[a-zA-Z0-9._/-]+\\.wav$" },
          sha256: { type: "string", pattern: SHA256_PATTERN },
          expectedText: { type: "string", minLength: 1, maxLength: 240 },
          allowedTranscripts: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 240 } },
          maxCer: { type: "number", minimum: 0, maximum: 1 },
          audioCondition: { type: "string", enum: ["synthetic-clean", "synthetic-slow", "synthetic-noisy"] },
          sourceGenerator: {
            type: "object",
            additionalProperties: false,
            required: ["provider", "voiceId", "text", "speed"],
            properties: {
              provider: { type: "string", const: "sherpa-onnx-vits-zh-ll" },
              voiceId: { type: "string", const: "zh-ll-2" },
              text: { type: "string", minLength: 1, maxLength: 240 },
              speed: { type: "number", minimum: 0.5, maximum: 2 },
            },
          },
        },
      },
    },
  },
});

function asrError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function validateManifest(manifest) {
  const errors = validateStrictSchema(manifest, ASR_MANIFEST_SCHEMA);
  const ids = new Set();
  for (const item of manifest?.cases || []) {
    if (ids.has(item.caseId)) errors.push(`$.cases: duplicate caseId ${item.caseId}`);
    ids.add(item.caseId);
    if (item.sourceGenerator?.text !== item.expectedText) errors.push(`$.cases.${item.caseId}: source text must equal expectedText`);
    if (String(item.relativePath || "").split("/").includes("..")) errors.push(`$.cases.${item.caseId}.relativePath: traversal forbidden`);
    const manifestTexts = [item.expectedText, ...(item.allowedTranscripts || []), item.sourceGenerator?.text];
    if (manifestTexts.some((value) => containsSensitiveText(value))) errors.push(`$.cases.${item.caseId}: direct PII or secret-shaped text forbidden`);
  }
  if (errors.length) throw asrError("ASR_MANIFEST_REJECTED", "固定 WAV ASR manifest 无效", errors);
  return manifest;
}

function containsSensitiveText(value) {
  return SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(String(value || "")));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readPcm16Mono16kWave(filename) {
  const data = fs.readFileSync(filename);
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw asrError("ASR_WAV_FORMAT_REJECTED", "固定音频不是 RIFF/WAVE");
  }
  let offset = 12;
  let format = null;
  let pcm = null;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > data.length) throw asrError("ASR_WAV_FORMAT_REJECTED", "固定音频 chunk 越界");
    if (id === "fmt " && size >= 16) {
      format = { audioFormat: data.readUInt16LE(start), channels: data.readUInt16LE(start + 2), sampleRate: data.readUInt32LE(start + 4), bitsPerSample: data.readUInt16LE(start + 14) };
    }
    if (id === "data") pcm = data.subarray(start, end);
    offset = end + (size % 2);
  }
  if (!format || !pcm || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bitsPerSample !== 16 || pcm.length < 3200 || pcm.length % 2) {
    throw asrError("ASR_WAV_FORMAT_REJECTED", "固定音频必须是 PCM16 mono 16 kHz 且至少 100ms");
  }
  const samples = new Float32Array(pcm.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2) / 32768;
  return { data, samples, sampleRate: 16000, durationMs: Math.round((samples.length / 16000) * 1000) };
}

function normalizeTranscript(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(left, right) {
  const a = [...normalizeTranscript(left)];
  const b = [...normalizeTranscript(right)];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1));
    for (let column = 0; column < current.length; column += 1) previous[column] = current[column];
  }
  return previous[b.length];
}

function characterErrorRate(actual, expected) {
  const denominator = Math.max(1, [...normalizeTranscript(expected)].length);
  return Math.round((editDistance(actual, expected) / denominator) * 10000) / 10000;
}

function loadRecentAsrBatches(reportRoot) {
  if (!reportRoot) return [];
  try {
    return fs.readdirSync(path.join(reportRoot, "batches"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        try { return JSON.parse(fs.readFileSync(path.join(reportRoot, "batches", entry.name), "utf8")); } catch { return null; }
      })
      .filter(Boolean)
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
      .slice(-12);
  } catch {
    return [];
  }
}

function createVirtualSeniorAsrGate({ manifest, audioRoot, recognize, orchestrator, reportRoot, asrMode = "real-local", now = () => Date.now() } = {}) {
  validateManifest(manifest);
  if (!audioRoot || typeof recognize !== "function" || !orchestrator?.runAsrCase) throw new Error("固定 WAV ASR 门禁配置不完整");
  if (!["real-local", "stub"].includes(asrMode)) throw new Error("固定 WAV ASR 模式无效");
  const root = path.resolve(audioRoot);
  const batches = loadRecentAsrBatches(reportRoot);

  function resolveAudio(relativePath) {
    const filename = path.resolve(root, relativePath);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) throw asrError("ASR_MANIFEST_REJECTED", "固定音频路径越界");
    return filename;
  }

  async function runCase(input = {}) {
    const item = manifest.cases.find((entry) => entry.caseId === input.caseId);
    if (!item) throw asrError("ASR_CASE_NOT_FOUND", "固定 WAV ASR 用例不存在");
    const filename = resolveAudio(item.relativePath);
    const wave = readPcm16Mono16kWave(filename);
    const actualHash = sha256Buffer(wave.data);
    if (actualHash !== item.sha256) throw asrError("ASR_WAV_HASH_MISMATCH", "固定 WAV 哈希不匹配", { expected: item.sha256, actual: actualHash });
    const startedAt = now();
    const recognized = await recognize({ samples: wave.samples, sampleRate: wave.sampleRate });
    const durationMs = Math.max(0, now() - startedAt);
    const transcript = String(recognized?.text || "").trim();
    const sensitiveTranscript = containsSensitiveText(transcript);
    const references = [item.expectedText, ...(item.allowedTranscripts || [])];
    const cer = transcript ? Math.min(...references.map((reference) => characterErrorRate(transcript, reference))) : 1;
    const providerVerified = asrMode === "real-local" && recognized?.provider === REAL_ASR_PROVIDER && recognized?.trustedFinal === true;
    const recognitionPassed = Boolean(recognized?.ok && transcript && !sensitiveTranscript && cer <= item.maxCer);
    const asrResult = providerVerified && recognitionPassed ? "PASS" : asrMode === "stub" ? "NON_GATING" : "FAIL";
    const asrEvidence = {
      verified: true,
      dataClassification: "synthetic-test-only",
      caseId: item.caseId,
      wavHash: `sha256:${actualHash}`,
      provider: String(recognized?.provider || "unknown"),
      providerVerified,
      evidenceType: asrMode === "real-local" ? "real-local-asr" : "stub",
      audioCondition: item.audioCondition,
      sampleRate: wave.sampleRate,
      channels: 1,
      bitsPerSample: 16,
      audioDurationMs: wave.durationMs,
      recognitionDurationMs: durationMs,
      transcript,
      expectedText: item.expectedText,
      allowedTranscripts: item.allowedTranscripts || [],
      characterErrorRate: cer,
      maximumCharacterErrorRate: item.maxCer,
      result: asrResult,
      errorCode: sensitiveTranscript ? "ASR_SENSITIVE_CONTENT_REJECTED" : providerVerified ? (recognitionPassed ? null : "ASR_TRANSCRIPT_MISMATCH") : asrMode === "stub" ? "ASR_STUB_NON_GATING" : "ASR_PROVIDER_UNVERIFIED",
    };
    const harnessReport = transcript && !sensitiveTranscript ? await orchestrator.runAsrCase({ scenarioId: item.scenarioId, personaId: item.personaId, transcript, asrEvidence, batchId: input.batchId, runId: input.runId || item.caseId }) : null;
    const report = harnessReport || {
      reportVersion: "1.0.0",
      batchId: input.batchId || null,
      runId: input.runId || item.caseId,
      appVersion: input.appVersion || "0.0.0",
      suiteVersion: manifest.manifestVersion,
      testMode: "fixed-wav-asr",
      category: "ASR",
      personaId: item.personaId,
      scenarioId: item.scenarioId,
      assertions: [],
      observed: { status: "not-run", errorCode: "ASR_EMPTY_TRANSCRIPT", actualTools: [], trace: [] },
      durationMs,
    };
    report.asr = asrEvidence;
    report.result = asrResult === "PASS" && harnessReport?.result === "PASS" ? "PASS" : "FAIL";
    if (reportRoot) {
      const directory = path.join(reportRoot, "runs", String(report.runId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100));
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    }
    return report;
  }

  async function runBatch(input = {}) {
    const batchId = String(input.batchId || `asr-${now()}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    const selected = Array.isArray(input.caseIds) && input.caseIds.length ? input.caseIds : manifest.cases.map((item) => item.caseId);
    const reports = [];
    for (const caseId of selected) reports.push(await runCase({ caseId, batchId, runId: `${batchId}-${caseId}` }));
    const previous = batches.at(-1)?.analysis || null;
    const analysis = analyzeVirtualSeniorReports(reports, previous);
    const batch = { reportVersion: "1.0.0", manifestVersion: manifest.manifestVersion, dataClassification: "synthetic-test-only", batchId, testMode: "fixed-wav-asr", createdAt: new Date(now()).toISOString(), caseIds: selected, reports, analysis, result: reports.every((report) => report.result === "PASS") ? "PASS" : "FAIL" };
    batches.push(batch);
    if (batches.length > 12) batches.shift();
    if (reportRoot) {
      fs.mkdirSync(reportRoot, { recursive: true, mode: 0o700 });
      const batchDirectory = path.join(reportRoot, "batches");
      fs.mkdirSync(batchDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(batchDirectory, `${batchId}.json`), `${JSON.stringify(batch, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(path.join(reportRoot, "batch-manifest.json"), `${JSON.stringify(batch, null, 2)}\n`, { mode: 0o600 });
    }
    return batch;
  }

  return { manifest: () => JSON.parse(JSON.stringify(manifest)), runBatch, runCase };
}

module.exports = { ASR_MANIFEST_SCHEMA, REAL_ASR_PROVIDER, characterErrorRate, createVirtualSeniorAsrGate, loadRecentAsrBatches, readPcm16Mono16kWave, validateManifest };
