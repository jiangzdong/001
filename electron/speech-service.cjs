const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const voices = [{ id: "zh-ll-2", label: "小安默认女声", detail: "普通话女声", modelId: "zh-ll", sid: 2 }];
const defaultVoiceId = "zh-ll-2";
const finalOfflineAsrProvider = "sherpa-onnx-sensevoice-local";

function createSpeechService({ app }) {
  const modelsRoot = app.isPackaged
    ? path.join(process.resourcesPath, "models")
    : path.join(app.getAppPath(), "models");
  const requiredFiles = [
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx",
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/tokens.txt",
    "sherpa-onnx-vits-zh-ll/model.onnx",
    "sherpa-onnx-vits-zh-ll/tokens.txt",
    "sherpa-onnx-vits-zh-ll/lexicon.txt",
  ];
  // One warmed worker serially prefetches upcoming segments while the current
  // PCM buffer is playing. Running two VITS instances at once saturated the
  // 6-core kiosk and caused visible compositor stalls without improving the
  // first audible chunk.
  const ttsWorkerCount = 1;
  const ttsWorkers = Array(ttsWorkerCount).fill(undefined);
  let alignmentWorker;
  let sequence = 0;
  const pending = new Map();
  const cancelledTurns = new Set();
  const synthesisTails = Array.from({ length: ttsWorkerCount }, () => Promise.resolve());
  let synthesisDispatch = 0;
  let previewInFlight = false;
  const warmedModels = new Set();
  const warmupPromises = new Map();
  const alignmentCache = new Map();

  function status() {
    const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(modelsRoot, file)));
    return {
      ready: missing.length === 0,
      provider: "sherpa-onnx",
      asrModel: "SenseVoice Small INT8",
      asrPreview: { mode: "rolling-offline", intervalMs: 900, maxWindowSeconds: 8 },
      lipAlignment: { mode: "vits-lexicon-pcm-live", provider: "VITS lexicon + PCM envelope", offlineAudit: "SenseVoice character timestamps" },
      ttsModel: "VITS zh-ll default female voice",
      ttsStreaming: { enabled: true, mode: "balanced-progressive-pcm-chunks", cancellation: true, parallelPrefetch: ttsWorkerCount, chunkChars: { minimum: 10, maximum: 24 } },
      voices,
      offline: true,
      warmedModels: [...warmedModels],
      missing,
    };
  }

  function handleWorkerFailure(roleKey, created, error) {
    for (const [id, task] of pending.entries()) {
      if (task.roleKey !== roleKey) continue;
      clearTimeout(task.timer);
      task.reject(error);
      pending.delete(id);
    }
    warmupPromises.clear();
    if (roleKey === "alignment") {
      warmedModels.delete("sensevoice-alignment");
      if (alignmentWorker === created) alignmentWorker = undefined;
    } else {
      for (const modelId of [...warmedModels]) if (modelId !== "sensevoice-alignment") warmedModels.delete(modelId);
      const slot = Number(roleKey.split(":")[1]);
      if (ttsWorkers[slot] === created) ttsWorkers[slot] = undefined;
    }
  }

  function ensureWorker(role = "tts", workerSlot = 0) {
    const slot = Math.max(0, Math.min(ttsWorkerCount - 1, Number(workerSlot) || 0));
    const existing = role === "alignment" ? alignmentWorker : ttsWorkers[slot];
    if (existing) return existing;
    const currentStatus = status();
    if (!currentStatus.ready) throw new Error(`缺少离线语音模型：${currentStatus.missing.join(", ")}`);
    const created = new Worker(path.join(__dirname, "speech-worker.cjs"), {
      // Two VITS threads keep the next PCM chunk buffered without a multi-second
      // audio gap. Live playback no longer runs SenseVoice alignment in parallel,
      // leaving enough CPU headroom for the 4K renderer.
      workerData: { modelsRoot, role, ttsThreads: 2, alignmentThreads: 1 },
    });
    const roleKey = role === "alignment" ? "alignment" : `tts:${slot}`;
    if (role === "alignment") alignmentWorker = created; else ttsWorkers[slot] = created;
    created.on("message", ({ id, event, ok, result, error }) => {
      const task = pending.get(id);
      if (!task) return;
      if (event === "chunk") {
        task.onProgress?.(result);
        return;
      }
      clearTimeout(task.timer);
      pending.delete(id);
      if (ok) task.resolve(result); else task.reject(new Error(error || "离线语音处理失败"));
    });
    created.on("error", (error) => handleWorkerFailure(roleKey, created, error));
    created.on("exit", (code) => {
      if ((role === "alignment" ? alignmentWorker : ttsWorkers[slot]) !== created) return;
      handleWorkerFailure(roleKey, created, new Error(`离线语音 ${roleKey} worker 已退出 (${code})`));
    });
    return created;
  }

  function request(type, payload, timeoutMs, transfer = [], onProgress, workerSlot = 0) {
    return new Promise((resolve, reject) => {
      const role = type === "align" || type === "recognize" || type === "warmup-alignment" ? "alignment" : "tts";
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(type === "recognize" ? "语音识别超时" : type === "align" ? "口型对齐超时" : "语音合成超时"));
      }, timeoutMs);
      const roleKey = role === "alignment" ? "alignment" : `tts:${Math.max(0, Math.min(ttsWorkerCount - 1, Number(workerSlot) || 0))}`;
      pending.set(id, { resolve, reject, timer, roleKey, onProgress });
      try { ensureWorker(role, workerSlot).postMessage({ id, type, payload }, transfer); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }

  async function recognize(input) {
    const source = input?.samples;
    const samples = Float32Array.from(source || []);
    if (samples.length < 1600) return { ok: false, message: "没有检测到足够的语音，请再说一次" };
    if (samples.length > 16000 * 45) return { ok: false, message: "单次说话请控制在四十五秒以内" };
    try {
      const result = await request("recognize", { samples, sampleRate: input?.sampleRate || 16000 }, 60000, [samples.buffer]);
      return result.text
        ? { ok: true, text: result.text, provider: finalOfflineAsrProvider, trustedFinal: true }
        : { ok: false, message: "没有听清，请再说一次或点击屏幕" };
    } catch (error) {
      return { ok: false, message: error?.message || "离线语音识别暂时不可用" };
    }
  }

  async function recognizePreview(input) {
    if (previewInFlight) return { ok: false, busy: true };
    const source = input?.samples;
    const samples = Float32Array.from(source || []);
    if (samples.length < 16000 || samples.length > 16000 * 10) return { ok: false, skipped: true };
    previewInFlight = true;
    try {
      const result = await request("recognize", { samples, sampleRate: input?.sampleRate || 16000 }, 15000, [samples.buffer]);
      return result.text ? { ok: true, text: result.text, preview: true } : { ok: false, preview: true };
    } catch {
      return { ok: false, preview: true };
    } finally {
      previewInFlight = false;
    }
  }

  async function runSynthesis(input, turnId, workerSlot) {
    const text = String(input?.text || "").trim().slice(0, 500);
    if (!text) return { ok: false, message: "没有可播报的文字" };
    if (turnId && cancelledTurns.has(turnId)) return { ok: false, cancelled: true, message: "语音请求已取消" };
    try {
      const voice = voices.find((item) => item.id === input?.voiceId) || voices.find((item) => item.id === defaultVoiceId);
      const result = await request("synthesize", { text, speed: input?.speed, modelId: voice.modelId, sid: voice.sid }, 60000, [], undefined, workerSlot);
      warmedModels.add(voice.modelId);
      if (turnId && cancelledTurns.has(turnId)) return { ok: false, cancelled: true, message: "语音请求已取消" };
      return { ok: true, samples: result.samples, sampleRate: result.sampleRate, visemes: result.visemes, alignment: result.alignment };
    } catch (error) {
      return { ok: false, message: error?.message || "离线语音合成暂时不可用" };
    }
  }

  async function runSynthesisStream(input, turnId, onChunk, workerSlot) {
    const text = String(input?.text || "").trim().slice(0, 500);
    if (!text) return { ok: false, message: "没有可播报的文字" };
    if (turnId && cancelledTurns.has(turnId)) return { ok: false, cancelled: true, message: "语音请求已取消" };
    try {
      const voice = voices.find((item) => item.id === input?.voiceId) || voices.find((item) => item.id === defaultVoiceId);
      let firstChunkMs = null;
      const startedAt = performance.now();
      const result = await request(
        "synthesize-stream",
        { text, speed: input?.speed, modelId: voice.modelId, sid: voice.sid, turnId },
        60000,
        [],
        (chunk) => {
          if (turnId && cancelledTurns.has(turnId)) return;
          // The worker already returns a monotonic VITS lexicon + PCM envelope
          // timeline tied to this exact sample buffer. Dispatch it immediately;
          // concurrent SenseVoice inference caused visible 4K compositor stalls.
          if (firstChunkMs == null) firstChunkMs = performance.now() - startedAt;
          onChunk?.(chunk);
        },
        workerSlot,
      );
      warmedModels.add(voice.modelId);
      if (result?.cancelled || (turnId && cancelledTurns.has(turnId))) return { ok: false, cancelled: true, message: "语音请求已取消", firstChunkMs };
      return { ok: true, ...result, firstChunkMs };
    } catch (error) {
      return { ok: false, message: error?.message || "离线流式语音合成暂时不可用" };
    }
  }

  function warmup(voiceId = defaultVoiceId) {
    const voice = voices.find((item) => item.id === voiceId) || voices.find((item) => item.id === defaultVoiceId);
    if (warmedModels.has(voice.modelId)) return Promise.resolve({ ok: true, modelId: voice.modelId, cached: true });
    if (!warmupPromises.has(voice.modelId)) {
      const task = Promise.all([
        ...Array.from({ length: ttsWorkerCount }, (_, slot) => request("warmup", { modelId: voice.modelId }, 60000, [], undefined, slot)),
        request("warmup-alignment", {}, 60000).catch(() => null),
      ])
        .then((results) => {
          const result = results[0];
          const alignment = results.at(-1);
          warmedModels.add(voice.modelId);
          if (alignment?.ready) warmedModels.add("sensevoice-alignment");
          return { ok: true, ...result, alignmentReady: Boolean(alignment?.ready) };
        })
        .finally(() => warmupPromises.delete(voice.modelId));
      warmupPromises.set(voice.modelId, task);
    }
    return warmupPromises.get(voice.modelId);
  }

  function synthesize(input) {
    const turnId = String(input?.turnId || "").trim().slice(0, 120);
    const slot = synthesisDispatch++ % ttsWorkerCount;
    const task = synthesisTails[slot].catch(() => {}).then(() => runSynthesis(input, turnId, slot));
    synthesisTails[slot] = task.then(() => undefined, () => undefined);
    return task;
  }

  function synthesizeStream(input, onChunk) {
    const turnId = String(input?.turnId || "").trim().slice(0, 120);
    const slot = synthesisDispatch++ % ttsWorkerCount;
    const task = synthesisTails[slot].catch(() => {}).then(() => runSynthesisStream(input, turnId, onChunk, slot));
    synthesisTails[slot] = task.then(() => undefined, () => undefined);
    return task;
  }

  async function align(input) {
    const text = String(input?.text || "").trim().slice(0, 500);
    const turnId = String(input?.turnId || "").trim().slice(0, 120);
    const source = input?.samples;
    const samples = Float32Array.from(source || []);
    const sampleRate = Number(input?.sampleRate) || 16000;
    if (!text || samples.length < Math.max(800, sampleRate * 0.08)) return { ok: false, message: "口型对齐输入不足" };
    if (turnId && cancelledTurns.has(turnId)) return { ok: false, cancelled: true };
    const cacheKey = `${sampleRate}:${samples.length}:${text}`;
    if (alignmentCache.has(cacheKey)) return { ok: true, cached: true, ...alignmentCache.get(cacheKey) };
    try {
      const result = await request("align", { text, samples, sampleRate }, 30000, [samples.buffer]);
      if (turnId && cancelledTurns.has(turnId)) return { ok: false, cancelled: true };
      alignmentCache.set(cacheKey, result);
      while (alignmentCache.size > 64) alignmentCache.delete(alignmentCache.keys().next().value);
      return { ok: true, cached: false, ...result };
    } catch (error) {
      return { ok: false, message: error?.message || "逐字口型对齐暂时不可用" };
    }
  }

  function cancelTurn(turnId) {
    const key = String(turnId || "").trim().slice(0, 120);
    if (!key) return false;
    cancelledTurns.add(key);
    for (const worker of ttsWorkers) worker?.postMessage({ id: ++sequence, type: "cancel-turn", payload: { turnId: key } });
    while (cancelledTurns.size > 256) cancelledTurns.delete(cancelledTurns.values().next().value);
    return true;
  }

  function close() {
    for (const worker of ttsWorkers) worker?.terminate();
    if (alignmentWorker) alignmentWorker.terminate();
    warmedModels.clear();
    warmupPromises.clear();
    alignmentCache.clear();
    ttsWorkers.fill(undefined);
    alignmentWorker = undefined;
  }

  return { status, warmup, recognize, recognizePreview, synthesize, synthesizeStream, align, cancelTurn, close };
}

module.exports = { createSpeechService };
