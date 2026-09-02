import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9269);
const outputPath = path.resolve(process.argv[3] || "qa/station-speech-transport.json");
const phrase = process.argv.slice(4).join(" ") || "您好，我们检查离线语音分块传输是否流畅。";

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && /站点咨询顾问/.test(item.title || ""));
if (!target?.webSocketDebuggerUrl) throw new Error("Station advisor Electron page missing");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(String(data));
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
  else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject, method });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
};

await send("Runtime.enable");
const report = await evaluate(`new Promise(async (resolve) => {
  const turnId = 'transport-' + Date.now();
  const streamId = turnId + '-0';
  const startedAt = performance.now();
  const chunks = [];
  const result = await window.kioskBridge.synthesizeSpeechStream(
    ${JSON.stringify(phrase)},
    { speed: 0.78, voiceId: 'zh-ll-2', turnId, streamId },
    (event) => {
      if (event?.type !== 'chunk') return;
      const samples = event.samples;
      chunks.push({
        receivedAtMs: Number((performance.now() - startedAt).toFixed(2)),
        tag: Object.prototype.toString.call(samples),
        constructor: samples?.constructor?.name || '',
        isFloat32Array: samples instanceof Float32Array,
        isArrayBufferView: ArrayBuffer.isView(samples),
        length: Number(samples?.length) || 0,
        byteLength: Number(samples?.byteLength) || 0,
        bufferTag: Object.prototype.toString.call(samples?.buffer),
      });
    },
  );
  resolve({ phrase: ${JSON.stringify(phrase)}, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), chunks, result });
})`);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify({ outputPath, ...report }, null, 2));

