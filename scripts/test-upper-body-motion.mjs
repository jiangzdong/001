import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9252";
const outputDir = path.resolve(process.env.XIAOAN_QA_DIR || "qa/upper-body-motion-v1.4.10");
await fs.mkdir(outputDir, { recursive: true });

const targets = await fetch(`${cdpUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && /小安数字健康管理师/.test(item.title));
if (!target?.webSocketDebuggerUrl) throw new Error("没有找到小安 Electron 页面");
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
if (!await evaluate(`Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference)`)) throw new Error("必须用 --qa-avatar 启动最终便携包");

async function capture(name) {
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  return outputPath;
}

async function snapshot() {
  return evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    if (!avatar) return null;
    const style = getComputedStyle(avatar);
    const number = (name) => Number.parseFloat(style.getPropertyValue(name)) || 0;
    const activeMouths = [...document.querySelectorAll('.digital-human__mouth-frame')]
      .map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity) }))
      .filter((frame) => frame.opacity > .5);
    return {
      capturedAt: performance.now(),
      state: avatar.dataset.avatarState || '',
      motionPhase: avatar.dataset.motionPhase || '',
      blinkPhase: avatar.dataset.blinkPhase || '',
      viseme: avatar.dataset.viseme || '',
      visemeTarget: avatar.dataset.visemeTarget || '',
      expression: avatar.dataset.semanticExpression || '',
      x: number('--body-x'),
      y: number('--body-y'),
      tilt: number('--body-tilt'),
      scale: number('--body-scale'),
      breath: number('--breath-phase'),
      expressionStrength: number('--expression-strength'),
      mouthOpen: number('--mouth-open'),
      activeMouths,
    };
  })()`);
}

async function sampleFor(durationMs, stopWhenIdle = false) {
  const samples = [];
  const startedAt = performance.now();
  let sawSpeaking = false;
  while (performance.now() - startedAt < durationMs) {
    const value = await snapshot();
    if (value) samples.push(value);
    if (value?.state === "speaking") sawSpeaking = true;
    if (stopWhenIdle && sawSpeaking && value?.state === "idle") break;
    await wait(16);
  }
  return samples;
}

const stats = (samples, key) => {
  const values = samples.map((sample) => Number(sample[key])).filter(Number.isFinite);
  const steps = values.slice(1).map((value, index) => Math.abs(value - values[index])).sort((a, b) => a - b);
  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
    maximumStep: Math.max(0, ...steps),
    p95Step: steps[Math.min(steps.length - 1, Math.floor(steps.length * .95))] || 0,
  };
};
const summarize = (samples) => ({
  sampleCount: samples.length,
  durationMs: samples.length ? samples.at(-1).capturedAt - samples[0].capturedAt : 0,
  x: stats(samples, "x"),
  y: stats(samples, "y"),
  tilt: stats(samples, "tilt"),
  scale: stats(samples, "scale"),
  breath: stats(samples, "breath"),
  expressionStrength: stats(samples, "expressionStrength"),
  observedVisemes: [...new Set(samples.map((sample) => sample.viseme).filter(Boolean))],
  dominantMouthViolations: samples.filter((sample) => sample.activeMouths.length > 1).length,
});

const report = {
  generatedAt: new Date().toISOString(),
  cdpUrl,
  outputDir,
  runtime: await evaluate(`window.kioskBridge?.runtimeStatus?.()`),
  failures: [],
};
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
await wait(800);
report.idleScreenshot = await capture("idle-start.png");
const idleSamples = await sampleFor(9_000);
report.idleEndScreenshot = await capture("idle-end.png");
report.idle = summarize(idleSamples);

await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference("您好，我是小安。您可以慢慢告诉我哪里不舒服，我会认真听，并和您一起把健康情况说明白。"); true`);
const speakingSamples = await sampleFor(45_000, true);
report.speaking = summarize(speakingSamples.filter((sample) => sample.state === "speaking"));
report.speakingScreenshot = await capture("speaking-end.png");

const blinkSamples = [...idleSamples, ...speakingSamples].filter((sample) => sample.blinkPhase);
const blinkGroups = [];
for (const sample of blinkSamples) {
  const group = blinkGroups.at(-1);
  if (!group || sample.capturedAt - group.at(-1).capturedAt > 100) blinkGroups.push([sample]);
  else group.push(sample);
}
const blinkEvents = blinkGroups.filter((group) => group.length >= 2).map((group) => ({
  sampleCount: group.length,
  x: stats(group, "x"),
  y: stats(group, "y"),
  tilt: stats(group, "tilt"),
}));
report.blinkPose = blinkEvents.length ? {
  eventCount: blinkEvents.length,
  maximumXRange: Math.max(...blinkEvents.map((event) => event.x.range)),
  maximumYRange: Math.max(...blinkEvents.map((event) => event.y.range)),
  maximumTiltRange: Math.max(...blinkEvents.map((event) => event.tilt.range)),
  events: blinkEvents,
} : null;

if (!report.runtime?.packaged) report.failures.push("runtime-not-packaged");
if (report.runtime?.version !== "1.4.10") report.failures.push(`wrong-version:${report.runtime?.version || "unknown"}`);
if (report.idle.x.range < .12 || report.idle.x.range > .5) report.failures.push(`idle-x-range:${report.idle.x.range}`);
if (report.idle.tilt.range < .1 || report.idle.tilt.range > .4) report.failures.push(`idle-tilt-range:${report.idle.tilt.range}`);
if (report.idle.y.range < .025 || report.idle.y.range > .14) report.failures.push(`idle-y-range:${report.idle.y.range}`);
if (report.idle.scale.range < .0005 || report.idle.scale.range > .0022) report.failures.push(`idle-scale-range:${report.idle.scale.range}`);
if (report.speaking.sampleCount < 120) report.failures.push(`speaking-samples:${report.speaking.sampleCount}`);
if (report.speaking.x.range < .08 || report.speaking.x.range > .55) report.failures.push(`speaking-x-range:${report.speaking.x.range}`);
if (report.speaking.tilt.range < .08 || report.speaking.tilt.range > .45) report.failures.push(`speaking-tilt-range:${report.speaking.tilt.range}`);
if (report.speaking.x.maximumStep > .018) report.failures.push(`speaking-x-jump:${report.speaking.x.maximumStep}`);
if (report.speaking.y.maximumStep > .018) report.failures.push(`speaking-y-jump:${report.speaking.y.maximumStep}`);
if (report.speaking.tilt.maximumStep > .018) report.failures.push(`speaking-tilt-jump:${report.speaking.tilt.maximumStep}`);
if (report.speaking.scale.maximumStep > .0002) report.failures.push(`speaking-scale-jump:${report.speaking.scale.maximumStep}`);
if (report.speaking.expressionStrength.maximumStep > .018) report.failures.push(`expression-jump:${report.speaking.expressionStrength.maximumStep}`);
if (report.speaking.dominantMouthViolations) report.failures.push(`double-dominant-mouth:${report.speaking.dominantMouthViolations}`);
if (!["CLOSED", "A", "E", "O", "U"].every((shape) => report.speaking.observedVisemes.includes(shape))) report.failures.push("core-viseme-coverage");
if (!report.blinkPose) report.failures.push("natural-blink-not-observed");
else if (report.blinkPose.maximumXRange > .012 || report.blinkPose.maximumYRange > .012 || report.blinkPose.maximumTiltRange > .012) report.failures.push("blink-pose-not-locked");

report.result = report.failures.length ? "FAIL" : "PASS";
const reportPath = path.join(outputDir, "report.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, result: report.result, failures: report.failures, idle: report.idle, speaking: report.speaking, blinkPose: report.blinkPose }, null, 2));
socket.close();
if (report.failures.length) process.exitCode = 1;
