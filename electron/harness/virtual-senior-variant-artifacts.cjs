"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PERSONAS, SCENARIOS } = require("./virtual-senior-catalog.cjs");

const PERSONA_IDS = Object.freeze(PERSONAS.map((item) => item.personaId));
const SCENARIO_IDS = Object.freeze(SCENARIOS.map((item) => item.scenarioId));
const SHA256_PATTERN = "^sha256:[a-f0-9]{64}$";

const VARIANT_CANDIDATE_SCHEMA = Object.freeze({
  $id: "xiaoan.virtual-senior.variant-candidate.v1",
  type: "object",
  additionalProperties: false,
  required: ["dataClassification", "synthetic", "personaId", "scenarioId", "turns"],
  properties: {
    dataClassification: { type: "string", const: "synthetic-test-only" },
    synthetic: { type: "boolean", const: true },
    personaId: { type: "string", enum: PERSONA_IDS },
    scenarioId: { type: "string", enum: SCENARIO_IDS },
    turns: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["utterance"],
        properties: {
          utterance: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
    },
  },
});

const GENERATION_REQUEST_SCHEMA = Object.freeze({
  $id: "xiaoan.virtual-senior.generation-request.v1",
  type: "object",
  additionalProperties: false,
  required: ["dataClassification", "personaId", "scenarioId", "prompt", "promptVersion", "provider", "model", "seed", "temperature", "top_p"],
  properties: {
    dataClassification: { type: "string", const: "synthetic-test-only" },
    personaId: { type: "string", enum: PERSONA_IDS },
    scenarioId: { type: "string", enum: SCENARIO_IDS },
    prompt: { type: "string", minLength: 1, maxLength: 12000 },
    promptVersion: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9._-]+$" },
    provider: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9._-]+$" },
    model: { type: "string", minLength: 1, maxLength: 160 },
    seed: { type: "integer", minimum: 0, maximum: 2147483647 },
    temperature: { type: "number", minimum: 0, maximum: 0.4 },
    top_p: { type: "number", minimum: 0, maximum: 1 },
  },
});

const ARTIFACT_PAYLOAD_SCHEMA = Object.freeze({
  $id: "xiaoan.virtual-senior.variant-artifact.v1",
  type: "object",
  additionalProperties: false,
  required: ["artifactVersion", "dataClassification", "source", "immutable", "candidate", "candidateHash", "generation", "requestHash"],
  properties: {
    artifactVersion: { type: "string", const: "1.0.0" },
    dataClassification: { type: "string", const: "synthetic-test-only" },
    source: { type: "string", const: "synthetic-generator" },
    immutable: { type: "boolean", const: true },
    candidate: VARIANT_CANDIDATE_SCHEMA,
    candidateHash: { type: "string", pattern: SHA256_PATTERN },
    generation: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "model", "prompt", "promptVersion", "promptHash", "schemaHash", "seed", "temperature", "top_p"],
      properties: {
        provider: GENERATION_REQUEST_SCHEMA.properties.provider,
        model: GENERATION_REQUEST_SCHEMA.properties.model,
        prompt: GENERATION_REQUEST_SCHEMA.properties.prompt,
        promptVersion: GENERATION_REQUEST_SCHEMA.properties.promptVersion,
        promptHash: { type: "string", pattern: SHA256_PATTERN },
        schemaHash: { type: "string", pattern: SHA256_PATTERN },
        seed: GENERATION_REQUEST_SCHEMA.properties.seed,
        temperature: GENERATION_REQUEST_SCHEMA.properties.temperature,
        top_p: GENERATION_REQUEST_SCHEMA.properties.top_p,
      },
    },
    requestHash: { type: "string", pattern: SHA256_PATTERN },
  },
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex")}`;
}

function schemaRejection(details) {
  return Object.assign(new Error("生成结果未通过严格 Schema 校验"), { code: "GENERATION_SCHEMA_REJECTED", details });
}

function valueTypeMatches(value, expected) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}

function validateStrictSchema(value, schema, location = "$") {
  const errors = [];
  if (!valueTypeMatches(value, schema.type)) return [`${location}: expected ${schema.type}`];
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) errors.push(`${location}: const mismatch`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location}: value is not in allowlist`);
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${location}: shorter than minLength`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${location}: longer than maxLength`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${location}: pattern mismatch`);
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${location}: below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${location}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${location}: fewer than minItems`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${location}: more than maxItems`);
    value.forEach((item, index) => errors.push(...validateStrictSchema(item, schema.items, `${location}[${index}]`)));
  }
  if (schema.type === "object" && value && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${location}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (!schema.properties?.[key]) {
        if (schema.additionalProperties === false) errors.push(`${location}.${key}: unknown property`);
      } else {
        errors.push(...validateStrictSchema(value[key], schema.properties[key], `${location}.${key}`));
      }
    }
  }
  return errors;
}

const SENSITIVE_TEXT_PATTERNS = Object.freeze([
  /\b1[3-9]\d{9}\b/,
  /\b\d{17}[\dXx]\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bsk-[a-zA-Z0-9_-]{12,}\b/,
  /\bBearer\s+[a-zA-Z0-9._-]{12,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]);

function findSensitiveText(value, location = "$") {
  if (typeof value === "string" && SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value))) return location;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveText(value[index], `${location}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findSensitiveText(child, `${location}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

function assertSafe(value, schema) {
  const errors = validateStrictSchema(value, schema);
  const sensitiveLocation = findSensitiveText(value);
  if (sensitiveLocation) errors.push(`${sensitiveLocation}: secrets or direct PII are forbidden`);
  if (errors.length) throw schemaRejection(errors);
}

function hashFilename(hash) {
  if (!(new RegExp(SHA256_PATTERN).test(String(hash)))) throw Object.assign(new Error("制品哈希格式无效"), { code: "ARTIFACT_HASH_INVALID" });
  return `${hash.slice("sha256:".length)}.json`;
}

function writeImmutableJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const descriptor = fs.openSync(filePath, "wx", 0o400);
    try {
      fs.writeFileSync(descriptor, serialized, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (fs.readFileSync(filePath, "utf8") !== serialized) throw Object.assign(new Error("不可变制品发生哈希冲突"), { code: "ARTIFACT_IMMUTABILITY_VIOLATION" });
  }
}

function createVirtualSeniorArtifactStore({ root } = {}) {
  if (!root) throw new Error("缺少虚拟长者变体制品目录");
  const artifactRoot = path.join(root, "artifacts");
  const requestRoot = path.join(root, "requests");
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(requestRoot, { recursive: true, mode: 0o700 });

  function get(artifactHash) {
    const artifact = JSON.parse(fs.readFileSync(path.join(artifactRoot, hashFilename(artifactHash)), "utf8"));
    const { artifactHash: storedHash, ...payload } = artifact;
    assertSafe(payload, ARTIFACT_PAYLOAD_SCHEMA);
    if (storedHash !== artifactHash || sha256(payload) !== artifactHash) throw Object.assign(new Error("制品哈希校验失败"), { code: "ARTIFACT_HASH_MISMATCH" });
    if (payload.candidateHash !== sha256(payload.candidate)
      || payload.generation.promptHash !== sha256(payload.generation.prompt)
      || payload.generation.schemaHash !== sha256(VARIANT_CANDIDATE_SCHEMA)
      || payload.requestHash !== sha256({ dataClassification: payload.dataClassification, personaId: payload.candidate.personaId, scenarioId: payload.candidate.scenarioId, generation: payload.generation })) {
      throw Object.assign(new Error("制品内部哈希校验失败"), { code: "ARTIFACT_HASH_MISMATCH" });
    }
    return artifact;
  }

  function put(payload) {
    assertSafe(payload, ARTIFACT_PAYLOAD_SCHEMA);
    const artifactHash = sha256(payload);
    const artifact = { ...payload, artifactHash };
    writeImmutableJson(path.join(artifactRoot, hashFilename(artifactHash)), artifact);
    return get(artifactHash);
  }

  function getForRequest(requestHash) {
    const requestPath = path.join(requestRoot, hashFilename(requestHash));
    if (!fs.existsSync(requestPath)) return null;
    const pointer = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    if (pointer.requestHash !== requestHash) throw Object.assign(new Error("请求索引哈希校验失败"), { code: "ARTIFACT_HASH_MISMATCH" });
    return get(pointer.artifactHash);
  }

  function bindRequest(requestHash, artifactHash) {
    const pointer = { requestHash, artifactHash };
    const requestPath = path.join(requestRoot, hashFilename(requestHash));
    try {
      writeImmutableJson(requestPath, pointer);
    } catch (error) {
      if (error.code !== "ARTIFACT_IMMUTABILITY_VIOLATION") throw error;
    }
    return getForRequest(requestHash);
  }

  return { bindRequest, get, getForRequest, put, root };
}

function createVirtualSeniorVariantGenerator({ artifactStore, generateCandidate } = {}) {
  if (!artifactStore) throw new Error("缺少虚拟长者变体制品存储");
  if (typeof generateCandidate !== "function") throw new Error("缺少 LLM 候选生成器");
  const schemaHash = sha256(VARIANT_CANDIDATE_SCHEMA);

  async function generate(input = {}) {
    assertSafe(input, GENERATION_REQUEST_SCHEMA);
    if (generateCandidate.providerId && input.provider !== generateCandidate.providerId) throw schemaRejection(["$.provider: does not match the configured provider adapter"]);
    const promptHash = sha256(input.prompt);
    const generation = {
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      promptVersion: input.promptVersion,
      promptHash,
      schemaHash,
      seed: input.seed,
      temperature: input.temperature,
      top_p: input.top_p,
    };
    const requestHash = sha256({ dataClassification: input.dataClassification, personaId: input.personaId, scenarioId: input.scenarioId, generation });
    const existing = artifactStore.getForRequest(requestHash);
    if (existing) return existing;

    const candidate = await generateCandidate({
      personaId: input.personaId,
      scenarioId: input.scenarioId,
      prompt: input.prompt,
      schema: VARIANT_CANDIDATE_SCHEMA,
      generation: { ...generation },
    });
    assertSafe(candidate, VARIANT_CANDIDATE_SCHEMA);
    if (candidate.personaId !== input.personaId || candidate.scenarioId !== input.scenarioId) {
      throw schemaRejection(["$.personaId or $.scenarioId does not match the generation request"]);
    }
    const artifact = artifactStore.put({
      artifactVersion: "1.0.0",
      dataClassification: "synthetic-test-only",
      source: "synthetic-generator",
      immutable: true,
      candidate: stableValue(candidate),
      candidateHash: sha256(candidate),
      generation,
      requestHash,
    });
    return artifactStore.bindRequest(requestHash, artifact.artifactHash);
  }

  return { generate, schema: VARIANT_CANDIDATE_SCHEMA, schemaHash };
}

function parseJsonObject(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    throw schemaRejection(["$: model output is not valid JSON"]);
  }
}

function createDeepSeekVariantCandidateGenerator({ getKey, fetchImpl = globalThis.fetch, endpoint = "https://api.deepseek.com/chat/completions", timeoutMs = 15000 } = {}) {
  const generateCandidate = async function generateCandidate({ personaId, scenarioId, prompt, schema, generation }) {
    const key = String(getKey?.() || "").trim();
    if (!key) throw Object.assign(new Error("请先配置 DeepSeek API 密钥"), { code: "MODEL_NOT_CONFIGURED" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("deadline"), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: generation.model,
          temperature: generation.temperature,
          top_p: generation.top_p,
          seed: generation.seed,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `你只生成小安虚拟长者的合成测试话语。不得输出真人资料、密钥、actor、auth、scope、Tool、oracle、expected 或 PASS 判定。只返回符合以下 JSON Schema 的对象：${stableStringify(schema)}`,
            },
            { role: "user", content: JSON.stringify({ dataClassification: "synthetic-test-only", personaId, scenarioId, synthetic: true, instruction: prompt }) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error(`大模型服务响应异常（${response.status}）`), { code: "MODEL_HTTP_ERROR" });
      const payload = await response.json();
      return parseJsonObject(payload?.choices?.[0]?.message?.content);
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error("大模型响应超时"), { code: "MODEL_TIMEOUT" });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  Object.defineProperty(generateCandidate, "providerId", { value: "deepseek", enumerable: true });
  return generateCandidate;
}

module.exports = {
  ARTIFACT_PAYLOAD_SCHEMA,
  GENERATION_REQUEST_SCHEMA,
  VARIANT_CANDIDATE_SCHEMA,
  createDeepSeekVariantCandidateGenerator,
  createVirtualSeniorArtifactStore,
  createVirtualSeniorVariantGenerator,
  sha256,
  stableStringify,
  validateStrictSchema,
};
