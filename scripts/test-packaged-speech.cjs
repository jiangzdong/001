const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const resources = process.env.XIAOAN_PACKAGED_RESOURCES
  ? path.resolve(process.env.XIAOAN_PACKAGED_RESOURCES)
  : path.join(__dirname, "..", "release", "win-unpacked", "resources");
const appAsar = path.join(resources, "app.asar");
const worker = new Worker(path.join(appAsar, "electron", "speech-worker.cjs"), { workerData: { modelsRoot: path.join(resources, "models") } });
let sequence = 0;

function readPcm16Wave(filename) {
  const data = fs.readFileSync(filename);
  const sampleRate = data.readUInt32LE(24);
  const channels = data.readUInt16LE(22);
  let offset = 12;
  while (offset + 8 <= data.length && data.toString("ascii", offset, offset + 4) !== "data") offset += 8 + data.readUInt32LE(offset + 4);
  if (offset + 8 > data.length || data.readUInt16LE(34) !== 16) throw new Error("Expected PCM16 WAV");
  const frameCount = Math.floor(data.readUInt32LE(offset + 4) / 2 / channels);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) samples[frame] = data.readInt16LE(offset + 8 + frame * channels * 2) / 32768;
  return { samples, sampleRate };
}

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
    worker.once("error", reject);
    worker.postMessage({ id, type, payload }, transfer);
  });
}

(async () => {
  const wav = readPcm16Wave(path.join(resources, "models", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17", "test_wavs", "zh.wav"));
  const samples = Float32Array.from(wav.samples);
  const asr = await request("recognize", { samples, sampleRate: wav.sampleRate }, [samples.buffer]);
  const tts = await request("synthesize", { text: "打包语音自检通过。", speed: 1, sid: 2 });
  const ttsSamples = Float32Array.from(tts.samples || []);
  const rms = Math.sqrt(ttsSamples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, ttsSamples.length));
  const peak = ttsSamples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
  if (rms < 0.001 || peak < 0.01) throw new Error(`TTS audio is effectively silent (rms=${rms}, peak=${peak})`);
  console.log(`PACKAGED ASR OK: ${asr.text}`);
  console.log(`PACKAGED TTS OK: ${(tts.samples.length / tts.sampleRate).toFixed(2)}s, rms=${rms.toFixed(4)}, peak=${peak.toFixed(4)}`);
})().finally(() => worker.terminate()).catch((error) => { console.error(error); process.exitCode = 1; });
