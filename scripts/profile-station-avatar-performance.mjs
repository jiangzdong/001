import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9269);
const outputPath = path.resolve(process.argv[3] || "qa/station-avatar-cpu-profile.json");
const durationMs = Math.max(5000, Number(process.argv[4]) || 10_000);
const phrase = process.argv.slice(5).join(" ") || "您好，我是小安。现在检查离线语音和口型过渡的实际运行流畅度。";

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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await Promise.all([send("Runtime.enable"), send("Profiler.enable")]);
await evaluate("window.__XIAOAN_AVATAR_QA__?.stopSpeech(); true");
await wait(250);
await send("Profiler.setSamplingInterval", { interval: 500 });
await send("Profiler.start");
await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(phrase)}); true`);
await wait(durationMs);
const { profile } = await send("Profiler.stop");
await evaluate("window.__XIAOAN_AVATAR_QA__?.stopSpeech(); true");

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const selfMicros = new Map();
for (let index = 0; index < (profile.samples?.length || 0); index += 1) {
  const id = profile.samples[index];
  selfMicros.set(id, (selfMicros.get(id) || 0) + (profile.timeDeltas?.[index] || 0));
}
const hottest = [...selfMicros.entries()]
  .map(([id, micros]) => {
    const frame = nodes.get(id)?.callFrame || {};
    return {
      functionName: frame.functionName || "(anonymous)",
      url: frame.url || "",
      line: Number(frame.lineNumber) + 1,
      selfMs: Number((micros / 1000).toFixed(2)),
    };
  })
  .sort((left, right) => right.selfMs - left.selfMs)
  .slice(0, 30);
const report = { generatedAt: new Date().toISOString(), durationMs, phrase, hottest, profile };
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify({ outputPath, durationMs, phrase, hottest }, null, 2));

