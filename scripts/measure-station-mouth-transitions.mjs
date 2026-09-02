import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9269);
const outputPath = path.resolve(process.argv[3] || "qa/station-mouth-transitions.json");
const durationMs = Math.max(6000, Number(process.argv[4]) || 12_000);
const phrase = process.argv.slice(5).join(" ") || "啊，诶，哦，呜。啊，诶，哦，呜。请检查口型过渡是否自然流畅。";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};

await Promise.all([send("Runtime.enable"), send("Page.enable")]);
await send("Page.bringToFront");
for (let index = 0; index < 160; index += 1) {
  if (await evaluate("Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference && document.querySelector('.station-advisor-digital-human')?.dataset.rigReady === 'true')")) break;
  if (index === 159) throw new Error("Station mouth transition probe did not become ready");
  await wait(50);
}
await evaluate("window.__XIAOAN_AVATAR_QA__.stopSpeech(); true");
await wait(180);
const sampling = evaluate(`new Promise((resolve) => {
  const durationMs=${JSON.stringify(durationMs)};
  const avatar=document.querySelector('.station-advisor-digital-human');
  const rig=document.querySelector('.station-advisor-digital-human__local-rig');
  const startedAt=performance.now();
  const samples=[];
  const tick=(timestamp)=>{
    samples.push({
      atMs:Number((timestamp-startedAt).toFixed(2)),
      speaking:avatar?.dataset.speaking==='true',
      viseme:avatar?.dataset.viseme||'',
      target:avatar?.dataset.visemeTarget||'',
      jawOpen:Number(avatar?.dataset.jawOpen||0),
      textureBlend:rig?.dataset.textureBlend||'',
      textureFrame:rig?.dataset.textureFrame||'',
      texturePolicy:rig?.dataset.texturePolicy||'',
      rig:rig?.dataset.rig||'',
    });
    if(timestamp-startedAt>=durationMs){resolve(samples);return;}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`);
await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(phrase)}); true`);
const samples = await sampling;
await evaluate("window.__XIAOAN_AVATAR_QA__.stopSpeech(); true");
socket.close();

const parsed = samples.map((sample) => {
  const match = /^([A-Z]+)>([A-Z]+)@([0-9.]+)$/.exec(sample.textureBlend);
  return { ...sample, from: match?.[1] || "", to: match?.[2] || "", mix: Number(match?.[3] || 0) };
});
const transitions = [];
let active = null;
for (const sample of parsed) {
  const key = sample.from && sample.to && sample.from !== sample.to ? `${sample.from}>${sample.to}` : "";
  if (!key || sample.mix >= 0.999) {
    if (active && key === active.key) {
      active.maxStep = Math.max(active.maxStep, Math.abs(sample.mix - active.lastMix));
      active.lastMix = sample.mix;
      active.endedAtMs = sample.atMs;
      active.frames += 1;
    }
    if (active) transitions.push(active);
    active = null;
    continue;
  }
  if (key !== active?.key || sample.mix + 0.025 < (active?.lastMix ?? 0)) {
    if (active) transitions.push(active);
    active = { key, from: sample.from, to: sample.to, startedAtMs: sample.atMs, endedAtMs: sample.atMs, frames: 1, firstMix: sample.mix, lastMix: sample.mix, maxStep: 0, monotonicViolations: 0 };
    continue;
  }
  const step = sample.mix - active.lastMix;
  if (step < -0.025) active.monotonicViolations += 1;
  active.maxStep = Math.max(active.maxStep, Math.abs(step));
  active.lastMix = sample.mix;
  active.endedAtMs = sample.atMs;
  active.frames += 1;
}
if (active) transitions.push(active);
for (const transition of transitions) {
  transition.durationMs = Number((transition.endedAtMs - transition.startedAtMs).toFixed(2));
  transition.completed = transition.firstMix <= 0.08 && transition.lastMix >= 0.92;
}
const completed = transitions.filter((transition) => transition.completed);
const sortedDurations = completed.map((transition) => transition.durationMs).sort((left, right) => left - right);
const medianDurationMs = sortedDurations.length ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
const failures = [];
if (!parsed.some((sample) => sample.rig === "local-mouth-chin-v34")) failures.push("v34-rig-not-observed");
if (!parsed.some((sample) => sample.texturePolicy === "split-mouth-dominant-sharp-stable-buffer")) failures.push("split-sharp-stable-buffer-policy-not-observed");
if (completed.length < 2) failures.push(`completed-transitions-too-few:${completed.length}`);
if (medianDurationMs < 110) failures.push(`transition-median-too-fast:${medianDurationMs}`);
if (completed.some((transition) => transition.frames < 7)) failures.push("transition-frame-count-too-low");
if (completed.some((transition) => transition.monotonicViolations > 0)) failures.push("transition-progress-not-monotonic");
const report = {
  suite: "station-mouth-transition-v27",
  generatedAt: new Date().toISOString(),
  durationMs,
  phrase,
  samples: parsed,
  transitions,
  summary: { completedTransitions: completed.length, medianDurationMs, minimumFrames: completed.length ? Math.min(...completed.map((item) => item.frames)) : 0 },
  failures,
  result: failures.length ? "FAIL" : "PASS",
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, result: report.result, summary: report.summary, transitions, failures }, null, 2));
if (failures.length) process.exit(1);
