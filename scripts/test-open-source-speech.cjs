const { Worker } = require("worker_threads");
const path = require("path");
const sherpa = require("sherpa-onnx-node");

const root = path.join(__dirname, "..");
const modelsRoot = path.join(root, "models");
const worker = new Worker(path.join(root, "electron", "speech-worker.cjs"), { workerData: { modelsRoot } });
let sequence = 0;

function request(type, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${type} timed out`)), 60000);
    const onMessage = (message) => {
      if (message.id !== id) return;
      clearTimeout(timer); worker.off("message", onMessage);
      if (message.ok) resolve(message.result); else reject(new Error(message.error));
    };
    worker.on("message", onMessage);
    worker.postMessage({ id, type, payload }, transfer);
  });
}

(async () => {
  const wavPath = path.join(modelsRoot, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17", "test_wavs", "zh.wav");
  const wave = sherpa.readWave(wavPath);
  const inputSamples = Float32Array.from(wave.samples);
  const asr = await request("recognize", { samples: inputSamples, sampleRate: wave.sampleRate }, [inputSamples.buffer]);
  if (!asr.text) throw new Error("ASR returned empty text");
  console.log(`ASR OK: ${asr.text}`);
  const voices = [{ id: "zh-ll-2", modelId: "zh-ll", sid: 2 }];
  for (const voice of voices) {
    const tts = await request("synthesize", { text: "您好，我是小安，离线语音模型已经准备好了。", speed: 1, modelId: voice.modelId, sid: voice.sid });
    if (!tts.samples?.length || !tts.sampleRate) throw new Error(`${voice.id} returned no audio`);
    console.log(`TTS ${voice.id} OK: ${(tts.samples.length / tts.sampleRate).toFixed(2)}s @ ${tts.sampleRate}Hz`);
  }
})().finally(() => worker.terminate()).catch((error) => { console.error(error); process.exitCode = 1; });
