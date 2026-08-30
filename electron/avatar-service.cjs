const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readMultipartFrameStream } = require("./frame-stream.cjs");

function encodePcm16Wave(source, sampleRate = 16000) {
  const samples = source instanceof Float32Array ? source : Float32Array.from(source || []);
  const output = Buffer.allocUnsafe(44 + samples.length * 2);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + samples.length * 2, 4);
  output.write("WAVEfmt ", 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    output.writeInt16LE(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), 44 + index * 2);
  }
  return output;
}

function normalizeRenderIdentity({ text, voiceId, speed, avatarId }) {
  const normalizedSpeed = Math.round(Math.max(0.5, Math.min(2, Number(speed) || 1)) * 1000) / 1000;
  return {
    schema: 2,
    avatarId: String(avatarId || "xiaoa-v1"),
    text: String(text || "").trim().replace(/\s+/g, " "),
    voiceId: String(voiceId || "zh-ll-2"),
    speed: normalizedSpeed,
  };
}

function renderKey(options) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeRenderIdentity(options))).digest("hex");
}

function createAvatarService({
  baseUrl = process.env.DITTO_API_URL || "http://127.0.0.1:8788",
  fetchImpl = globalThis.fetch,
  cacheDir,
  avatarId = process.env.DITTO_AVATAR_ID || "xiaoa-v1",
  maxCacheEntries = 96,
} = {}) {
  const endpoint = String(baseUrl).replace(/\/$/, "");
  const inflight = new Map();
  const memoryCache = new Map();
  const activeTurns = new Map();
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  function recordSuccess() {
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  }

  function recordFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= 3) circuitOpenUntil = Date.now() + 30000;
  }

  function cachePath(key) { return cacheDir ? path.join(cacheDir, `${key}.mp4`) : ""; }

  function readCached(key) {
    const memory = memoryCache.get(key);
    if (memory?.length > 1024) return new Uint8Array(memory);
    const filename = cachePath(key);
    if (!filename) return null;
    try {
      const bytes = fs.readFileSync(filename);
      if (bytes.length <= 1024) return null;
      memoryCache.set(key, bytes);
      return new Uint8Array(bytes);
    } catch { return null; }
  }

  function pruneDiskCache() {
    if (!cacheDir || maxCacheEntries < 1) return;
    try {
      const entries = fs.readdirSync(cacheDir)
        .filter((name) => /^[0-9a-f]{64}\.mp4$/.test(name))
        .map((name) => ({ name, mtime: fs.statSync(path.join(cacheDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const entry of entries.slice(maxCacheEntries)) fs.unlinkSync(path.join(cacheDir, entry.name));
    } catch {}
  }

  function writeCached(key, bytes) {
    const stable = Buffer.from(bytes);
    memoryCache.set(key, stable);
    const filename = cachePath(key);
    if (!filename) return;
    fs.mkdirSync(cacheDir, { recursive: true });
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, stable);
    fs.renameSync(temporary, filename);
    pruneDiskCache();
  }

  async function status() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(`${endpoint}/health`, { signal: controller.signal });
      if (!response.ok) return { ready: false, message: `本机 GPU 数字人服务不可用（${response.status}）` };
      const result = await response.json();
      if (result.ok) recordSuccess();
      return { ready: Boolean(result.ok), ...result, localCacheEntries: memoryCache.size, inflightRequests: inflight.size, consecutiveFailures, circuitOpen: Date.now() < circuitOpenUntil, retryAfterMs: Math.max(0, circuitOpenUntil - Date.now()) };
    } catch {
      recordFailure();
      return { ready: false, message: "本机 GPU 数字人服务未连接", consecutiveFailures, circuitOpen: Date.now() < circuitOpenUntil, retryAfterMs: Math.max(0, circuitOpenUntil - Date.now()) };
    } finally { clearTimeout(timer); }
  }

  async function render({ samples, sampleRate, requestKey, signal } = {}) {
    if (Date.now() < circuitOpenUntil) {
      return { ok: false, circuitOpen: true, retryAfterMs: circuitOpenUntil - Date.now(), message: "本机 GPU 数字人正在恢复，已使用音频口型" };
    }
    const wav = encodePcm16Wave(samples, sampleRate);
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), 180000);
    const started = performance.now();
    try {
      const response = await fetchImpl(`${endpoint}/v1/render`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav", ...(requestKey ? { "X-Render-Key": requestKey } : {}) },
        body: wav,
        signal: controller.signal,
      });
      if (!response.ok) {
        let message = `本机 GPU 嘴型生成失败（${response.status}）`;
        try { message = (await response.json())?.detail || message; } catch {}
        recordFailure();
        return { ok: false, message };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const remoteHit = response.headers.get("x-cache-hit") === "1";
      recordSuccess();
      return {
        ok: bytes.length > 1024,
        bytes,
        contentType: response.headers.get("content-type") || "video/mp4",
        cacheHit: remoteHit,
        cacheTier: remoteHit ? "cloud" : "none",
        renderSeconds: Number(response.headers.get("x-render-seconds")) || 0,
        queueSeconds: Number(response.headers.get("x-queue-seconds")) || 0,
        cloudTotalSeconds: Number(response.headers.get("x-total-seconds")) || 0,
        totalSeconds: (performance.now() - started) / 1000,
      };
    } catch (error) {
      if (!signal?.aborted) recordFailure();
      return {
        ok: false,
        cancelled: Boolean(signal?.aborted),
        message: error?.name === "AbortError" ? (signal?.aborted ? "数字人请求已取消" : "本机 GPU 嘴型生成超时") : "本机 GPU 数字人服务未连接",
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async function renderFrames({ samples, sampleRate, requestKey, signal, onFrame } = {}) {
    if (Date.now() < circuitOpenUntil) return { ok: false, circuitOpen: true, retryAfterMs: circuitOpenUntil - Date.now(), message: "本机 GPU 数字人正在恢复，已使用音频口型" };
    const wav = encodePcm16Wave(samples, sampleRate);
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort("timeout"), 600000);
    const started = performance.now();
    let frameCount = 0;
    let firstFrameMs = null;
    let metadata = {};
    try {
      const response = await fetchImpl(`${endpoint}/v1/render/frames`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav", ...(requestKey ? { "X-Render-Key": requestKey } : {}) },
        body: wav,
        signal: controller.signal,
      });
      if (!response.ok) {
        recordFailure();
        return { ok: false, unsupported: response.status === 404 || response.status === 405, message: response.status === 404 ? "本机 GPU 尚未部署帧流接口" : `本机 GPU 帧流生成失败（${response.status}）` };
      }
      await readMultipartFrameStream(response, {
        onFrame(frame) {
          if (firstFrameMs == null) firstFrameMs = performance.now() - started;
          frameCount += 1;
          onFrame?.(frame);
        },
        onMetadata(value) { metadata = { ...metadata, ...value }; },
      });
      if (metadata.error) throw new Error(String(metadata.error));
      if (!frameCount) return { ok: false, message: "本机 GPU 帧流没有返回画面" };
      recordSuccess();
      return { ok: true, frameStreaming: true, transport: "multipart-jpeg", frameCount, firstFrameMs: Math.round(firstFrameMs), totalSeconds: (performance.now() - started) / 1000, ...metadata };
    } catch (error) {
      if (!signal?.aborted) recordFailure();
      return { ok: false, cancelled: Boolean(signal?.aborted), message: signal?.aborted ? "数字人帧流已取消" : error?.message || "本机 GPU 数字人帧流未连接" };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async function renderText({ text, voiceId, speed, synthesize, turnId } = {}) {
    const identity = normalizeRenderIdentity({ text, voiceId, speed, avatarId });
    if (!identity.text) return { ok: false, message: "数字人播报文字不能为空" };
    if (typeof synthesize !== "function") return { ok: false, message: "离线语音合成器不可用" };
    const key = renderKey(identity);
    const cached = readCached(key);
    if (cached) {
      return { ok: true, bytes: cached, contentType: "video/mp4", cacheHit: true, cacheTier: "local", requestKey: key, synthSeconds: 0, renderSeconds: 0, queueSeconds: 0, totalSeconds: 0 };
    }
    if (inflight.has(key)) {
      const shared = await inflight.get(key);
      return { ...shared, bytes: shared.bytes ? new Uint8Array(shared.bytes) : undefined, deduplicated: true };
    }
    const execute = async (signal) => {
      const started = performance.now();
      const synthStarted = performance.now();
      const speech = await synthesize({ text: identity.text, voiceId: identity.voiceId, speed: identity.speed, turnId: normalizedTurnId });
      const synthSeconds = (performance.now() - synthStarted) / 1000;
      if (signal?.aborted) return { ok: false, cancelled: true, message: "数字人请求已取消", requestKey: key, synthSeconds };
      if (!speech?.ok) return { ok: false, message: speech?.message || "离线语音合成失败", requestKey: key, synthSeconds };
      const result = await render({ ...speech, requestKey: key, signal });
      const totalSeconds = (performance.now() - started) / 1000;
      if (!result.ok) return { ...result, requestKey: key, synthSeconds, totalSeconds };
      writeCached(key, result.bytes);
      return { ...result, requestKey: key, synthSeconds, totalSeconds };
    };
    const normalizedTurnId = String(turnId || "").trim().slice(0, 120);
    if (normalizedTurnId) {
      activeTurns.get(normalizedTurnId)?.abort();
      const controller = new AbortController();
      activeTurns.set(normalizedTurnId, controller);
      try { return await execute(controller.signal); }
      finally { if (activeTurns.get(normalizedTurnId) === controller) activeTurns.delete(normalizedTurnId); }
    }
    const task = execute();
    inflight.set(key, task);
    try { return await task; } finally { inflight.delete(key); }
  }

  async function streamText({ text, voiceId, speed, synthesize, turnId, onEvent } = {}) {
    const identity = normalizeRenderIdentity({ text, voiceId, speed, avatarId });
    if (!identity.text) return { ok: false, message: "数字人播报文字不能为空" };
    if (typeof synthesize !== "function") return { ok: false, message: "离线语音合成器不可用" };
    const normalizedTurnId = String(turnId || "").trim().slice(0, 120);
    if (!normalizedTurnId) return { ok: false, message: "数字人帧流缺少 turnId" };
    activeTurns.get(normalizedTurnId)?.abort();
    const controller = new AbortController();
    activeTurns.set(normalizedTurnId, controller);
    const started = performance.now();
    try {
      const speech = await synthesize({ text: identity.text, voiceId: identity.voiceId, speed: identity.speed, turnId: normalizedTurnId });
      if (controller.signal.aborted) return { ok: false, cancelled: true, message: "数字人帧流已取消" };
      if (!speech?.ok) return { ok: false, message: speech?.message || "离线语音合成失败" };
      onEvent?.({ type: "audio", samples: speech.samples, sampleRate: speech.sampleRate, visemes: speech.visemes || [] });
      const result = await renderFrames({
        ...speech,
        requestKey: renderKey(identity),
        signal: controller.signal,
        onFrame: (frame) => onEvent?.({ type: "frame", ...frame }),
      });
      onEvent?.({ type: result.ok ? "complete" : "error", result });
      return { ...result, synthAndStreamSeconds: (performance.now() - started) / 1000 };
    } finally {
      if (activeTurns.get(normalizedTurnId) === controller) activeTurns.delete(normalizedTurnId);
    }
  }

  function cancelTurn(turnId) {
    const key = String(turnId || "").trim();
    const controller = activeTurns.get(key);
    if (!controller) return false;
    controller.abort();
    activeTurns.delete(key);
    return true;
  }

  return { status, render, renderFrames, renderText, streamText, cancelTurn };
}

module.exports = { createAvatarService, encodePcm16Wave, normalizeRenderIdentity, renderKey };
