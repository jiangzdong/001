const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const sherpa = require("sherpa-onnx-node");
const { createAlignedVisemes, createNativeDurationVisemes, createTimedVisemes, splitTtsStreamText } = require("./viseme-timeline.cjs");
const { extractNativeDurationAlignment } = require("./vits-duration-contract.cjs");

const senseVoiceDir = path.join(workerData.modelsRoot, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
const zhLlDir = path.join(workerData.modelsRoot, "sherpa-onnx-vits-zh-ll");

let recognizer;
const ttsPromises = new Map();
const pronunciationMaps = new Map();
const cancelledTurns = new Set();

function getPronunciations(modelId = "zh-ll") {
  if (pronunciationMaps.has(modelId)) return pronunciationMaps.get(modelId);
  const directory = zhLlDir;
  const lexicon = fs.readFileSync(path.join(directory, "lexicon.txt"), "utf8");
  const pronunciations = new Map();
  for (const line of lexicon.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length > 1 && [...parts[0]].length === 1) pronunciations.set(parts[0], parts.slice(1));
  }
  pronunciationMaps.set(modelId, pronunciations);
  return pronunciations;
}

function createVisemeSequence(text, modelId, samples, sampleRate, generated, options) {
  const nativeAlignment = extractNativeDurationAlignment(generated, sampleRate);
  if (nativeAlignment) {
    const visemes = createNativeDurationVisemes(text, getPronunciations(modelId), samples, sampleRate, nativeAlignment);
    if (visemes.length > 1) {
      return {
        visemes,
        alignment: {
          provider: nativeAlignment.provider,
          durationCount: nativeAlignment.durationCount,
          nativeDurationStatus: "available",
        },
      };
    }
  }
  return {
    visemes: createTimedVisemes(text, getPronunciations(modelId), samples, sampleRate, options),
    alignment: {
      provider: "weighted-pcm-fallback",
      tokenCount: 0,
      timestampCount: 0,
      nativeDurationStatus: "upstream-api-unavailable",
    },
  };
}

function getRecognizer() {
  if (!recognizer) {
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: path.join(senseVoiceDir, "model.int8.onnx"),
          useInverseTextNormalization: 1,
        },
        tokens: path.join(senseVoiceDir, "tokens.txt"),
        numThreads: Math.max(1, Math.min(Number(workerData.alignmentThreads) || 2, require("os").cpus().length - 2)),
        provider: "cpu",
        debug: 0,
      },
    });
  }
  return recognizer;
}

function getTts(modelId = "zh-ll") {
  if (!ttsPromises.has(modelId)) {
    const directory = zhLlDir;
    const config = {
      model: {
        vits: {
          model: path.join(directory, "model.onnx"),
          tokens: path.join(directory, "tokens.txt"),
          lexicon: path.join(directory, "lexicon.txt"),
        },
        debug: false,
        numThreads: Math.max(1, Math.min(Number(workerData.ttsThreads) || 2, require("os").cpus().length - 1)),
        provider: "cpu",
      },
      maxNumSentences: 2,
    };
    ttsPromises.set(modelId, sherpa.OfflineTts.createAsync(config));
  }
  return ttsPromises.get(modelId);
}

async function recognizeDetailed(samples, sampleRate) {
  const engine = getRecognizer();
  const stream = engine.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  engine.decode(stream);
  const result = engine.getResult(stream);
  const text = String(result?.text || "")
    .replace(/<\|[^|>]+\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { ...result, text };
}

async function recognize(samples, sampleRate) {
  return (await recognizeDetailed(samples, sampleRate)).text;
}

async function synthesize(text, speed, modelId, sid) {
  const safeModelId = "zh-ll";
  const engine = await getTts(safeModelId);
  const requestedSid = Number.isInteger(sid) ? sid : 0;
  const safeSid = Math.max(0, Math.min(engine.numSpeakers - 1, requestedSid));
  const generationConfig = new sherpa.GenerationConfig({
    sid: safeSid,
    speed: Number.isFinite(speed) ? speed : 1,
    silenceScale: 0.2,
  });
  const audio = await engine.generateAsync({
    text,
    enableExternalBuffer: false,
    generationConfig,
  });
  const timeline = createVisemeSequence(text, safeModelId, audio.samples, audio.sampleRate, audio);
  return {
    samples: audio.samples,
    sampleRate: audio.sampleRate,
    visemes: timeline.visemes,
    alignment: timeline.alignment,
  };
}

async function synthesizeStream(id, text, speed, modelId, sid, turnId) {
  const safeModelId = "zh-ll";
  const engine = await getTts(safeModelId);
  const requestedSid = Number.isInteger(sid) ? sid : 0;
  const safeSid = Math.max(0, Math.min(engine.numSpeakers - 1, requestedSid));
  const generationConfig = new sherpa.GenerationConfig({
    sid: safeSid,
    speed: Number.isFinite(speed) ? speed : 1,
    silenceScale: 0.2,
  });
  const key = String(turnId || "");
  // Sherpa's callback batching treats a long Mandarin sentence as one unit,
  // even when it contains several commas or enumeration marks. Plan balanced
  // text chunks explicitly so a 7-8 second sentence cannot hold the next audio
  // buffer after the greeting has already finished playing.
  const streamTexts = splitTtsStreamText(text, { minChars: 10, maxChars: 24 });
  let emittedChunkIndex = 0;
  let totalSamples = 0;
  const startedAt = performance.now();
  for (const chunkText of streamTexts) {
    if (key && cancelledTurns.has(key)) break;
    const audio = await engine.generateAsync({
      text: chunkText,
      enableExternalBuffer: false,
      generationConfig,
    });
    if (key && cancelledTurns.has(key)) break;
    const samples = Float32Array.from(audio?.samples || []);
    if (!samples.length) continue;
    totalSamples += samples.length;
    const timeline = createVisemeSequence(
      chunkText,
      safeModelId,
      samples,
      audio.sampleRate || engine.sampleRate,
      audio,
      { includeInitialClosure: emittedChunkIndex === 0 },
    );
    parentPort.postMessage({
      id,
      event: "chunk",
      result: {
        samples,
        sampleRate: audio.sampleRate || engine.sampleRate,
        visemes: timeline.visemes,
        alignment: timeline.alignment,
        chunkIndex: emittedChunkIndex,
        progress: (emittedChunkIndex + 1) / Math.max(1, streamTexts.length),
        generatedAtMs: performance.now() - startedAt,
        text: chunkText,
      },
    }, [samples.buffer]);
    emittedChunkIndex += 1;
  }
  const cancelled = Boolean(key && cancelledTurns.has(key));
  return {
    sampleRate: engine.sampleRate,
    totalSamples,
    streamedSamples: totalSamples,
    chunkCount: emittedChunkIndex,
    cancelled,
  };
}

parentPort.on("message", async ({ id, type, payload }) => {
  try {
    if (type === "cancel-turn") {
      const turnId = String(payload?.turnId || "");
      if (turnId) cancelledTurns.add(turnId);
      parentPort.postMessage({ id, ok: true, result: { cancelled: Boolean(turnId) } });
      return;
    }
    if (type === "warmup") {
      const modelId = "zh-ll";
      const engine = await getTts(modelId);
      parentPort.postMessage({ id, ok: true, result: { modelId, numSpeakers: engine.numSpeakers } });
      return;
    }
    if (type === "warmup-alignment") {
      getRecognizer();
      parentPort.postMessage({ id, ok: true, result: { modelId: "sensevoice", ready: true } });
      return;
    }
    if (type === "recognize") {
      const samples = payload.samples instanceof Float32Array ? payload.samples : new Float32Array(payload.samples);
      const text = await recognize(samples, payload.sampleRate || 16000);
      parentPort.postMessage({ id, ok: true, result: { text } });
      return;
    }
    if (type === "synthesize") {
      const result = await synthesize(payload.text, payload.speed, payload.modelId, payload.sid);
      const samples = Float32Array.from(result.samples);
      parentPort.postMessage({ id, ok: true, result: { samples, sampleRate: result.sampleRate, visemes: result.visemes, alignment: result.alignment } }, [samples.buffer]);
      return;
    }
    if (type === "synthesize-stream") {
      const result = await synthesizeStream(id, payload.text, payload.speed, payload.modelId, payload.sid, payload.turnId);
      parentPort.postMessage({ id, ok: true, result });
      return;
    }
    if (type === "align") {
      const samples = payload.samples instanceof Float32Array ? payload.samples : new Float32Array(payload.samples);
      const alignment = await recognizeDetailed(samples, payload.sampleRate || 16000);
      const visemes = createAlignedVisemes(payload.text, getPronunciations("zh-ll"), samples, payload.sampleRate || 16000, alignment);
      parentPort.postMessage({
        id,
        ok: true,
        result: {
          visemes,
          alignment: {
            provider: alignment?.timestamps?.length ? "sensevoice-character-timestamps" : "weighted-pcm-fallback",
            tokenCount: alignment?.tokens?.length || 0,
            timestampCount: alignment?.timestamps?.length || 0,
          },
        },
      });
      return;
    }
    throw new Error(`Unknown speech task: ${type}`);
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
