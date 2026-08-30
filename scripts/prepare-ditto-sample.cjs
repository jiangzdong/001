const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "ditto-validation");
const modelsRoot = path.join(root, "models");
const worker = new Worker(path.join(root, "electron", "speech-worker.cjs"), {
  workerData: { modelsRoot },
});

function writePcm16Wav(filePath, samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), 44 + index * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function synthesize(payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TTS timed out")), 60000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.postMessage({ id: 1, type: "synthesize", payload });
  });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(
    path.join(root, "public", "assets", "xiaoa-ditto-master-v1.0.3.png"),
    path.join(outputDir, "xiaoa-source.png"),
  );
  const text = "您好，我是小安，您的数字健康管理师。接下来我会用几个简单的问题，帮助您了解最近的健康状态。";
  const result = await synthesize({ text, speed: 0.96, modelId: "zh-ll", sid: 2 });
  writePcm16Wav(path.join(outputDir, "xiaoa-test-voice.wav"), result.samples, result.sampleRate);
  fs.writeFileSync(path.join(outputDir, "script.txt"), `${text}\n`, "utf8");
  console.log(`Ditto validation assets ready: ${outputDir}`);
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => worker.terminate());
