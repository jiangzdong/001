const fs = require("node:fs");
const path = require("node:path");
const { createSpeechService } = require("../electron/speech-service.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function readPcm16Wave(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("只支持 PCM WAV");
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") format = {
      type: buffer.readUInt16LE(start),
      channels: buffer.readUInt16LE(start + 2),
      sampleRate: buffer.readUInt32LE(start + 4),
      bits: buffer.readUInt16LE(start + 14),
    };
    if (id === "data") data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.type !== 1 || format.bits !== 16 || format.channels !== 1) throw new Error("需要单声道 PCM16 WAV");
  const samples = new Float32Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = data.readInt16LE(index * 2) / 32768;
  return { samples, sampleRate: format.sampleRate };
}

const wavPath = path.resolve(argument("--wav"));
const outputPath = path.resolve(argument("--output"));
const text = argument("--text");
if (!wavPath || !outputPath || !text) throw new Error("用法: --wav <file> --text <同文文本> --output <json>");

const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => process.cwd() } });
(async () => {
  await speech.warmup("zh-ll-2");
  const audio = readPcm16Wave(wavPath);
  const aligned = await speech.align({ text, ...audio, turnId: `real-reference-${Date.now()}` });
  if (!aligned.ok || aligned.alignment?.provider !== "sensevoice-character-timestamps") throw new Error(aligned.message || "真人音频字符时间戳不可用");
  const report = {
    source: wavPath,
    text,
    durationMs: Math.round(audio.samples.length / audio.sampleRate * 1000),
    sampleRate: audio.sampleRate,
    alignment: aligned.alignment,
    visemes: aligned.visemes,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, visemes: undefined, eventCount: report.visemes.length, outputPath }, null, 2));
})().finally(() => speech.close()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
