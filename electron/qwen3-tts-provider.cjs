"use strict";

// macOS-only external-resource bridge.  The resource pack is intentionally
// outside the app bundle: a release must supply its own verified manifest and
// files, never inherit a developer machine path.
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn: nodeSpawn } = require("child_process");
const { splitQuestionAtExistingPunctuation } = require("./harness/qwen3-tts-sensevoice-candidate.cjs");

const RESOURCE_MANIFEST_VERSION = "qwen3-tts-resource-pack-v1";
const ENGINE_ID = "qwen3-tts";
// The native MLX binaries in resourceVersion 1.0.0-macos-arm64 declare
// LC_BUILD_VERSION minos 26.2. Keep VITS available on older systems and fail
// before hashing or spawning the incompatible Qwen runtime.
const QWEN_MINIMUM_MACOS_VERSION = "26.2.0";
const RELEASE_PUBLIC_KEYS = Object.freeze([
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAU6jIn2gypPJCmV6cp6JH86CiX3IW4QHLLNZUvTVztHM=\n-----END PUBLIC KEY-----",
]);

function error(code, message) {
  return Object.assign(new Error(message), { code });
}

function versionParts(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(value.trim())) return null;
  const parts = value.trim().split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function macOSVersionSupported(current, required = QWEN_MINIMUM_MACOS_VERSION) {
  const left = versionParts(current);
  const right = versionParts(required);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function compatibility({ platform, arch, systemVersion }) {
  if (platform !== "darwin" || arch !== "arm64") return { supported: false, code: "QWEN_UNSUPPORTED_PLATFORM", reason: "Qwen3-TTS MLX 仅支持 macOS arm64；当前平台保持 VITS" };
  if (!macOSVersionSupported(systemVersion)) return { supported: false, code: "QWEN_UNSUPPORTED_MACOS_VERSION", reason: `Qwen3-TTS 需要 macOS ${QWEN_MINIMUM_MACOS_VERSION} 或更高；当前为 ${systemVersion || "未知版本"}，已继续使用 VITS` };
  return { supported: true };
}

function inside(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源清单包含无效相对路径");
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源清单路径越出资源包");
  return resolved;
}

function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function fileIdentity(filename) {
  const stat = await fsp.stat(filename);
  return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs };
}

function sameIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function identitiesUnchanged(resource) {
  const entries = Object.entries(resource.fileIdentities || {});
  if (!entries.length) {
    const current = { worker: await fileIdentity(resource.workerPath), runtime: await fileIdentity(resource.pythonPath) };
    return sameIdentity(current.worker, resource.criticalIdentity?.worker) && sameIdentity(current.runtime, resource.criticalIdentity?.runtime);
  }
  // Bound metadata I/O so a large signed model pack does not create an
  // unbounded Promise/stat burst immediately before process launch.
  for (let index = 0; index < entries.length; index += 64) {
    const batch = entries.slice(index, index + 64);
    const matches = await Promise.all(batch.map(async ([relative, expected]) => {
      try { return sameIdentity(await fileIdentity(inside(resource.root, relative)), expected); } catch { return false; }
    }));
    if (matches.includes(false)) return false;
  }
  return true;
}

async function walkFiles(root, directory = root) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源包禁止符号链接");
    if (entry.isDirectory()) output.push(...await walkFiles(root, filename));
    else if (entry.isFile()) output.push(path.relative(root, filename).split(path.sep).join("/"));
  }
  return output;
}

async function verifyResourcePack(resourcePackPath, { platform = process.platform, arch = process.arch, systemVersion = typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "", trustedPublicKeys = RELEASE_PUBLIC_KEYS, allowUntrustedDevelopment = false } = {}) {
  const compatible = compatibility({ platform, arch, systemVersion });
  if (!compatible.supported) return { ready: false, ...compatible, currentMacOSVersion: systemVersion || null, requiredMacOSVersion: QWEN_MINIMUM_MACOS_VERSION };
  if (!resourcePackPath) return { ready: false, code: "QWEN_RESOURCE_NOT_CONFIGURED", reason: "未配置 Qwen3-TTS 外置资源包；当前使用 VITS" };
  try {
    const root = path.resolve(resourcePackPath);
    const manifestPath = path.join(root, "qwen3-tts-resource-manifest.json");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (manifest.version !== RESOURCE_MANIFEST_VERSION || typeof manifest.resourceVersion !== "string" || !manifest.resourceVersion) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源包版本或资源版本无效");
    if (manifest.platform !== "darwin" || manifest.arch !== "arm64") throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源包平台声明必须为 darwin/arm64");
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源包缺少完整文件哈希清单");
    const seen = new Set();
    const fileIdentities = {};
    for (const entry of manifest.files) {
      if (!entry || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(entry.sha256)) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源文件哈希无效");
      if (seen.has(entry.path)) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "资源清单包含重复路径");
      seen.add(entry.path);
      const filename = inside(root, entry.path);
      const stat = await fsp.stat(filename);
      if (!stat.isFile()) throw error("QWEN_RESOURCE_MISSING", `资源文件缺失：${entry.path}`);
      if (await sha256File(filename) !== entry.sha256.toLowerCase()) throw error("QWEN_RESOURCE_HASH_MISMATCH", `资源文件哈希不匹配：${entry.path}`);
      fileIdentities[entry.path] = { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs };
    }
    for (const key of ["workerPath", "pythonPath"]) if (!seen.has(manifest[key])) throw error("QWEN_RESOURCE_MANIFEST_INVALID", `${key} 必须列在完整哈希清单中`);
    const modelPath = inside(root, manifest.modelPath);
    const workerPath = inside(root, manifest.workerPath);
    const pythonPath = inside(root, manifest.pythonPath);
    if (!(await fsp.stat(modelPath)).isDirectory()) throw error("QWEN_RESOURCE_MANIFEST_INVALID", "modelPath 必须指向模型目录");
    const declared = new Set([...seen, "qwen3-tts-resource-manifest.json"]);
    const actual = await walkFiles(root);
    const undeclared = actual.filter((name) => !declared.has(name));
    const missingFromDisk = [...declared].filter((name) => !actual.includes(name));
    if (undeclared.length || missingFromDisk.length) throw error("QWEN_RESOURCE_MANIFEST_INCOMPLETE", `资源清单不完整（未声明 ${undeclared.length}，缺失 ${missingFromDisk.length}）`);
    await fsp.access(pythonPath, fs.constants.X_OK);
    const unsigned = { ...manifest }; delete unsigned.signature;
    const signature = typeof manifest.signature === "string" ? Buffer.from(manifest.signature, "base64") : null;
    const trusted = Boolean(signature?.length) && trustedPublicKeys.some((key) => {
      try { return crypto.verify(null, Buffer.from(canonicalJson(unsigned)), key, signature); } catch { return false; }
    });
    if (!trusted && !allowUntrustedDevelopment) throw error("QWEN_RESOURCE_SIGNATURE_INVALID", "资源包没有受信任的发布签名");
    const criticalIdentity = { worker: await fileIdentity(workerPath), runtime: await fileIdentity(pythonPath) };
    return { ready: true, validated: true, trust: trusted ? "release-signed" : "untrustedDevelopment", untrustedDevelopment: !trusted, resourceVersion: manifest.resourceVersion, root, modelPath, workerPath, pythonPath, manifestPath, manifest, criticalIdentity, fileIdentities };
  } catch (cause) {
    return { ready: false, code: cause.code || "QWEN_RESOURCE_INVALID", reason: String(cause.message || cause).slice(0, 240) };
  }
}

function bytesToSamples(bytes) {
  if (!bytes.length || bytes.length % 2) throw error("QWEN_PROTOCOL_INVALID", "Qwen PCM chunk 格式无效");
  const output = new Float32Array(bytes.length / 2);
  for (let index = 0; index < output.length; index += 1) output[index] = bytes.readInt16LE(index * 2) / 32768;
  return output;
}

function seedFor(requestId, segmentIndex) {
  return crypto.createHash("sha256").update(`${requestId}:${segmentIndex}`).digest().readUInt32LE(0);
}

function createQwen3TtsProvider({ resourcePackPath = "", developmentResource = null, platform = process.platform, arch = process.arch, systemVersion = typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "", spawn = nodeSpawn, tmpRoot = os.tmpdir(), timeoutMs = 120000, maxQueue = 8, trustedPublicKeys = RELEASE_PUBLIC_KEYS, allowUntrustedDevelopment = false, circuitCooldownMs = 30000, now = Date.now } = {}) {
  const configured = Boolean(resourcePackPath || developmentResource);
  const compatible = compatibility({ platform, arch, systemVersion });
  let resource = compatible.supported
    ? { ready: false, validated: false, configured, code: configured ? "QWEN_RESOURCE_NOT_VALIDATED" : "QWEN_RESOURCE_NOT_CONFIGURED", reason: configured ? "Qwen3-TTS 资源包尚未校验" : "未配置 Qwen3-TTS 外置资源包；当前使用 VITS" }
    : { ready: false, validated: false, configured, ...compatible };
  let child = null, childReady = null, workerStarted = false, workerGeneration = 0, active = null, closed = false;
  const cancelledTurns = new Set();
  let tail = Promise.resolve(), queueDepth = 0, circuitOpen = false, circuitReason = null, circuitOpenedAt = 0, recoveryProbe = false, validationPromise = null, actualUsed = null;

  function status() {
    return { engine: ENGINE_ID, supported: compatible.supported, currentMacOSVersion: platform === "darwin" ? systemVersion || null : null, requiredMacOSVersion: QWEN_MINIMUM_MACOS_VERSION, configured, validated: Boolean(resource.validated), started: workerStarted, actualUsed, ready: resource.ready && !circuitOpen, trust: resource.trust || null, untrustedDevelopment: Boolean(resource.untrustedDevelopment), resourceVersion: resource.resourceVersion || null, code: circuitOpen ? "QWEN_CIRCUIT_OPEN" : resource.code || null, reason: circuitReason || resource.reason || null, workerGeneration: workerGeneration || null, queueDepth, maxQueue, circuitOpen, circuitRetryAt: circuitOpen ? circuitOpenedAt + circuitCooldownMs : null };
  }

  async function refresh({ resetCircuit = false, forceValidation = false } = {}) {
    if (!compatible.supported) return resource;
    if (resetCircuit || (circuitOpen && now() >= circuitOpenedAt + circuitCooldownMs)) { circuitOpen = false; circuitReason = null; circuitOpenedAt = 0; }
    if (resource.ready && !forceValidation) return resource;
    if (!validationPromise) validationPromise = (async () => {
      if (developmentResource) {
        if (!allowUntrustedDevelopment) return { ready: false, code: "QWEN_DEVELOPMENT_RESOURCE_FORBIDDEN", reason: "生产模式禁止开发资源注入" };
        const [pythonPath, workerPath, modelPath] = [developmentResource.pythonPath, developmentResource.workerPath, developmentResource.modelPath].map((item) => path.resolve(String(item || "")));
        await Promise.all([fsp.access(pythonPath, fs.constants.X_OK), fsp.access(workerPath, fs.constants.R_OK), fsp.access(modelPath, fs.constants.R_OK)]);
        return { ready: true, validated: true, configured: true, trust: "untrustedDevelopment", untrustedDevelopment: true, resourceVersion: String(developmentResource.resourceVersion || "development-untrusted"), root: path.dirname(workerPath), pythonPath, workerPath, modelPath, criticalIdentity: { worker: await fileIdentity(workerPath), runtime: await fileIdentity(pythonPath) } };
      }
      return verifyResourcePack(resourcePackPath, { platform, arch, systemVersion, trustedPublicKeys, allowUntrustedDevelopment });
    })().then((result) => (resource = result)).catch((cause) => (resource = { ready: false, code: cause.code || "QWEN_RESOURCE_INVALID", reason: String(cause.message || cause).slice(0, 240) })).finally(() => { validationPromise = null; });
    return validationPromise;
  }
  function killWorker() {
    const stale = child; child = null; childReady = null; workerStarted = false;
    if (stale && !stale.killed) stale.kill("SIGKILL");
  }
  function protocolFailure(job, code, message) {
    if (active !== job) return;
    active = null; killWorker(); job.reject(error(code, message));
  }
  async function ensureWorker() {
    if (closed) throw error("QWEN_PROVIDER_CLOSED", "Qwen provider 已关闭");
    if (child && childReady) return childReady;
    if (!resource.ready) resource = await refresh();
    if (!resource.ready) throw error(resource.code, resource.reason);
    if (!await identitiesUnchanged(resource)) {
      resource = { ready: false, validated: false, configured: true, code: "QWEN_RESOURCE_CHANGED_AFTER_VALIDATION", reason: "Qwen关键运行文件在校验后发生变化，已拒绝执行" };
      throw error(resource.code, resource.reason);
    }
    const generation = ++workerGeneration;
    const created = spawn(resource.pythonPath, [resource.workerPath, resource.modelPath], {
      cwd: resource.root,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    child = created;
    let buffer = "", diagnostics = "";
    childReady = new Promise((resolve, reject) => {
      const readyTimer = setTimeout(() => reject(error("QWEN_WORKER_START_TIMEOUT", "Qwen worker 启动超时")), timeoutMs);
      const rejectReady = (cause) => { clearTimeout(readyTimer); reject(cause); };
      created.stderr.on("data", (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-2000); });
      created.stdout.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const newline = buffer.indexOf("\n"); if (newline < 0) break;
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (!line) continue;
          let event; try { event = JSON.parse(line); } catch { if (active?.generation === generation) protocolFailure(active, "QWEN_PROTOCOL_INVALID", "Qwen worker 返回非JSON协议消息"); continue; }
          if (event.status === "ready") { clearTimeout(readyTimer); workerStarted = true; resolve(created); continue; }
          const job = active;
          if (!job || job.generation !== generation || created !== child) continue;
          // The legacy MLX worker emits no correlation fields. Serial dispatch
          // plus process-generation identity safely binds those events to the
          // sole active job. New workers may echo both fields and are checked.
          if ((event.request_id != null && event.request_id !== job.requestId) || (event.worker_generation != null && Number(event.worker_generation) !== generation)) {
            protocolFailure(job, "QWEN_PROTOCOL_INVALID", "Qwen worker 请求标识或generation不匹配");
            continue;
          }
          if (event.status === "chunk") {
            try {
              const pcm = Buffer.from(String(event.pcm_s16le_base64 || ""), "base64");
              const samples = bytesToSamples(pcm); const sampleRate = Number(event.sample_rate);
              if (!Number.isInteger(sampleRate) || sampleRate !== 24000) throw error("QWEN_PROTOCOL_INVALID", "Qwen sample rate 必须为24kHz");
              job.chunks.push({ samples, sampleRate, elapsedSeconds: Number(event.elapsed_seconds), segmentIndex: job.segmentIndex });
            } catch (cause) { protocolFailure(job, cause.code || "QWEN_PROTOCOL_INVALID", cause.message); }
            continue;
          }
          if (event.status === "completed") { job.resolveEvent(event); continue; }
          if (event.status === "failed") { protocolFailure(job, "QWEN_GENERATION_FAILED", String(event.error || "Qwen generation failed")); continue; }
          protocolFailure(job, "QWEN_PROTOCOL_INVALID", "Qwen worker 返回未知状态");
        }
      });
      created.once("error", (cause) => { if (created === child) { child = null; childReady = null; workerStarted = false; } rejectReady(error("QWEN_WORKER_CRASHED", String(cause.message || cause))); if (active?.generation === generation) protocolFailure(active, "QWEN_WORKER_CRASHED", "Qwen worker 崩溃"); });
      created.once("exit", (code) => { if (created === child) { child = null; childReady = null; workerStarted = false; } if (active?.generation === generation) protocolFailure(active, "QWEN_WORKER_CRASHED", `Qwen worker 已退出 (${code})`); else if (code !== 0) rejectReady(error("QWEN_WORKER_CRASHED", `Qwen worker 启动失败 (${code}) ${diagnostics}`)); });
    });
    try { return await childReady; } catch (cause) { if (created === child) killWorker(); throw cause; }
  }
  async function runSegment(job, text, segmentIndex) {
    const created = await ensureWorker();
    if (cancelledTurns.has(job.turnId)) throw error("QWEN_CANCELLED", "语音请求已取消");
    const directory = await fsp.mkdtemp(path.join(tmpRoot, "xiaoan-qwen-"));
    job.directory = directory; job.segmentIndex = segmentIndex; job.chunks = [];
    let event;
    try { event = await new Promise((resolve, reject) => {
      const activeJob = { ...job, generation: workerGeneration, resolveEvent: null, reject: null };
      const timer = setTimeout(() => protocolFailure(activeJob, "QWEN_TIMEOUT", "Qwen 语音生成超时"), timeoutMs);
      activeJob.resolveEvent = (result) => { clearTimeout(timer); if (active === activeJob) active = null; resolve(result); };
      activeJob.reject = (cause) => { clearTimeout(timer); reject(cause); };
      active = activeJob;
      const request = { request_id: job.requestId, worker_generation: workerGeneration, text, voice: "Vivian", instruct: "自然、清晰地朗读这句中文回答。", style: "xiaoan-product", seed: seedFor(job.requestId, segmentIndex), stream: true, streaming_interval: 0.32, output: path.join(directory, "audio.wav"), metrics: path.join(directory, "metrics.json"), staging_output: path.join(directory, ".audio.partial.wav"), staging_metrics: path.join(directory, ".metrics.partial.json") };
      try { created.stdin.write(`${JSON.stringify(request)}\n`); } catch (cause) { protocolFailure(active, "QWEN_WORKER_CRASHED", String(cause.message || cause)); }
    }); } catch (cause) {
      await fsp.rm(directory, { recursive: true, force: true }); job.directory = null;
      throw cause;
    }
    try {
      const metrics = event.metrics || {};
      if (metrics.termination_reason !== "eos") throw error("QWEN_EOS_REQUIRED", "Qwen 未以EOS结束，已拒绝发布不完整音频");
      if (!Array.isArray(job.chunks) || !job.chunks.length) throw error("QWEN_PROTOCOL_INVALID", "Qwen 未返回可播放PCM");
      return { chunks: job.chunks, metrics };
    } finally {
      await fsp.rm(directory, { recursive: true, force: true }); job.directory = null;
    }
  }
  function synthesize({ text, turnId = "", requestId = crypto.randomUUID(), onChunk = null } = {}) {
    if (recoveryProbe) return Promise.reject(error("QWEN_CIRCUIT_RECOVERY_IN_PROGRESS", "Qwen 熔断恢复检测进行中"));
    if (queueDepth >= maxQueue) return Promise.reject(error("QWEN_QUEUE_FULL", "Qwen 语音队列已满"));
    const job = { requestId: String(requestId), turnId: String(turnId), reject: null, generation: null, chunks: [], publishedChunks: 0 };
    const execute = async () => {
      const segments = splitQuestionAtExistingPunctuation(String(text || "").trim());
      if (segments.join("") !== String(text || "").trim()) throw error("QWEN_SEGMENTATION_INVALID", "Qwen 分段改变了原始回答文本");
      const streaming = typeof onChunk === "function";
      const combined = [], metrics = [];
      for (let index = 0; index < segments.length; index += 1) {
        if (cancelledTurns.has(job.turnId)) throw error("QWEN_CANCELLED", "语音请求已取消");
        const result = await runSegment(job, segments[index], index);
        if (!streaming) combined.push(...result.chunks);
        metrics.push(result.metrics);
        // Each clause is released only after that clause proves EOS. This keeps
        // first-audio latency bounded without ever publishing a truncated clause.
        for (const chunk of result.chunks) {
          if (onChunk) job.publishedChunks += 1;
          onChunk?.({ ...chunk, requestId: job.requestId, workerGeneration, engineRequested: ENGINE_ID, engineUsed: ENGINE_ID, fallbackReason: null, resourceVersion: resource.resourceVersion });
        }
      }
      const chunkCount = streaming ? job.publishedChunks : combined.length;
      const result = { ok: true, sampleRate: 24000, chunks: chunkCount, chunkCount, metrics, requestId: job.requestId, workerGeneration, engineRequested: ENGINE_ID, engineUsed: ENGINE_ID, fallbackReason: null, resourceVersion: resource.resourceVersion, segmentation: "existing-punctuation-segmentation-v1" };
      if (!streaming) result.samples = Float32Array.from(combined.flatMap((chunk) => [...chunk.samples]));
      return result;
    };
    queueDepth += 1;
    const runWithSingleRestart = async () => {
      let isRecoveryProbe = false;
      if (circuitOpen) {
        if (now() < circuitOpenedAt + circuitCooldownMs || recoveryProbe) throw error("QWEN_CIRCUIT_OPEN", circuitReason || "Qwen worker 已熔断");
        circuitOpen = false; circuitReason = null; circuitOpenedAt = 0; recoveryProbe = true; isRecoveryProbe = true;
      }
      try {
        let firstFailure;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try { const value = await execute(); actualUsed = ENGINE_ID; return value; }
          catch (cause) {
            firstFailure ||= cause;
            killWorker();
            if (job.publishedChunks > 0) throw error("QWEN_PARTIAL_OUTPUT", `Qwen 已播放 ${job.publishedChunks} 个音频块，后续生成失败：${cause?.message || cause}`);
            if (cause?.code === "QWEN_CANCELLED" || cause?.code === "QWEN_EOS_REQUIRED" || cause?.code === "QWEN_SEGMENTATION_INVALID" || cause?.code?.startsWith("QWEN_RESOURCE") || cause?.code?.startsWith("QWEN_UNSUPPORTED")) throw cause;
            if (attempt === 1) {
              circuitOpen = true;
              circuitOpenedAt = now();
              circuitReason = `Qwen worker 连续失败，已熔断：${String(cause?.message || cause)}`.slice(0, 240);
              throw error("QWEN_CIRCUIT_OPEN", circuitReason, { cause: firstFailure });
            }
          }
        }
        throw firstFailure;
      } finally {
        if (isRecoveryProbe) recoveryProbe = false;
      }
    };
    const result = tail.catch(() => {}).then(runWithSingleRestart).finally(() => { queueDepth -= 1; });
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  function cancelTurn(turnId) {
    const key = String(turnId || ""); if (!key) return false; cancelledTurns.add(key);
    if (active?.turnId === key) protocolFailure(active, "QWEN_CANCELLED", "语音请求已取消并重建worker");
    while (cancelledTurns.size > 256) cancelledTurns.delete(cancelledTurns.values().next().value);
    return true;
  }
  function close() { closed = true; killWorker(); }
  return { status, refresh, synthesize, cancelTurn, close, verifyResourcePack: () => verifyResourcePack(resourcePackPath, { platform, arch, systemVersion, trustedPublicKeys, allowUntrustedDevelopment }) };
}

module.exports = { ENGINE_ID, RESOURCE_MANIFEST_VERSION, QWEN_MINIMUM_MACOS_VERSION, RELEASE_PUBLIC_KEYS, canonicalJson, macOSVersionSupported, verifyResourcePack, createQwen3TtsProvider };
