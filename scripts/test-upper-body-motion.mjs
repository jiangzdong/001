import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9252";
const outputDir = path.resolve(process.env.XIAOAN_QA_DIR || "qa/upper-body-motion-v1.4.13");
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
    const localRig = document.querySelector('.digital-human__local-rig');
    const localRigStyle = localRig ? getComputedStyle(localRig) : null;
    const mouthWeights = [...document.querySelectorAll('.digital-human__mouth-frame')]
      .map((frame) => {
        const frameStyle = getComputedStyle(frame);
        return {
          className: frame.className,
          opacity: Number(frameStyle.opacity),
          visible: frameStyle.visibility !== 'hidden' && Number(frameStyle.opacity) > .5,
        };
      });
    const activeMouths = mouthWeights
      .filter((frame) => frame.visible);
    return {
      capturedAt: performance.now(),
      state: avatar.dataset.avatarState || '',
      avatarTransform: getComputedStyle(avatar).transform,
      motionPhase: avatar.dataset.motionPhase || '',
      blinkPhase: avatar.dataset.blinkPhase || '',
      viseme: avatar.dataset.viseme || '',
      visemeTarget: avatar.dataset.visemeTarget || '',
      visemeCurrent: avatar.dataset.visemeCurrent || '',
      visemeNext: avatar.dataset.visemeNext || '',
      expression: avatar.dataset.semanticExpression || '',
      x: number('--body-x'),
      y: number('--body-y'),
      tilt: number('--body-tilt'),
      scale: number('--body-scale'),
      breath: number('--breath-phase'),
      chestRise: number('--chest-rise'),
      chestScaleX: number('--chest-scale-x'),
      chestScaleY: number('--chest-scale-y'),
      expressionStrength: number('--expression-strength'),
      mouthOpen: number('--mouth-open'),
      jawOpen: number('--jaw-open'),
      jawDrop: number('--jaw-drop'),
      jawScaleY: number('--jaw-scale-y'),
      avatarMode: avatar.dataset.avatarMode || '',
      localRigPresent: Boolean(localRig),
      localRigVisible: Boolean(localRigStyle && localRigStyle.visibility !== 'hidden' && Number(localRigStyle.opacity) > .5),
      localRigName: localRig?.dataset.rig || '',
      localRigViseme: localRig?.dataset.viseme || '',
      localRigJawOpen: Number(localRig?.dataset.jawOpen || 0),
      localRigLowerLeft: Number(localRig?.dataset.lowerLeft || 0),
      localRigLowerRight: Number(localRig?.dataset.lowerRight || 0),
      localRigNoseTranslation: Number(localRig?.dataset.noseTranslation || 0),
      localRigNeckLeft: Number(localRig?.dataset.neckLeft || 0),
      localRigNeckRight: Number(localRig?.dataset.neckRight || 0),
      localRigCheekLeft: Number(localRig?.dataset.cheekLeft || 0),
      localRigCheekRight: Number(localRig?.dataset.cheekRight || 0),
      localRigLowerLipOffsetPx: Number(localRig?.dataset.lowerLipOffsetPx || 0),
      localRigChinOffsetPx: Number(localRig?.dataset.chinOffsetPx || 0),
      localRigMouthChinDistanceDeltaPx: Number(localRig?.dataset.mouthChinDistanceDeltaPx || 0),
      visibleMouthFrameCount: activeMouths.length,
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
  chestRise: stats(samples, "chestRise"),
  chestScaleX: stats(samples, "chestScaleX"),
  chestScaleY: stats(samples, "chestScaleY"),
  expressionStrength: stats(samples, "expressionStrength"),
  mouthOpen: stats(samples, "mouthOpen"),
  jawOpen: stats(samples, "jawOpen"),
  jawDrop: stats(samples, "jawDrop"),
  jawScaleY: stats(samples, "jawScaleY"),
  localRigJawOpen: stats(samples, "localRigJawOpen"),
  localRigLowerLeft: stats(samples, "localRigLowerLeft"),
  localRigLowerRight: stats(samples, "localRigLowerRight"),
  maximumLowerAsymmetry: Math.max(0, ...samples.map((sample) => Math.abs(sample.localRigLowerLeft - sample.localRigLowerRight))),
  localRigVisibleSamples: samples.filter((sample) => sample.localRigVisible).length,
  localRigNames: [...new Set(samples.map((sample) => sample.localRigName).filter(Boolean))],
  avatarModes: [...new Set(samples.map((sample) => sample.avatarMode).filter(Boolean))],
  maximumNoseTranslation: Math.max(0, ...samples.map((sample) => Math.abs(sample.localRigNoseTranslation))),
  maximumNeckTranslation: Math.max(0, ...samples.map((sample) => Math.max(Math.abs(sample.localRigNeckLeft), Math.abs(sample.localRigNeckRight)))),
  maximumCheekTranslation: Math.max(0, ...samples.map((sample) => Math.max(Math.abs(sample.localRigCheekLeft), Math.abs(sample.localRigCheekRight)))),
  localRigChinOffsetPx: stats(samples, "localRigChinOffsetPx"),
  maximumMouthChinDistanceDeltaPx: Math.max(0, ...samples.map((sample) => Math.abs(sample.localRigMouthChinDistanceDeltaPx))),
  rootTransformSamples: samples.filter((sample) => sample.avatarTransform !== "none").length,
  observedVisemes: [...new Set(samples.map((sample) => sample.viseme).filter(Boolean))],
  dominantMouthViolations: samples.filter((sample) => sample.activeMouths.length > 1).length,
  visibleLegacyMouthSamples: samples.filter((sample) => sample.visibleMouthFrameCount > 0).length,
});

const correlation = (samples, leftKey, rightKey) => {
  const pairs = samples.map((sample) => [Number(sample[leftKey]), Number(sample[rightKey])]).filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right));
  if (pairs.length < 3) return 0;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + (pair[0] - leftMean) * (pair[1] - rightMean), 0);
  const denominator = Math.sqrt(
    pairs.reduce((sum, pair) => sum + (pair[0] - leftMean) ** 2, 0)
    * pairs.reduce((sum, pair) => sum + (pair[1] - rightMean) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
};

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
report.speaking.jawMouthCorrelation = correlation(speakingSamples.filter((sample) => sample.state === "speaking"), "mouthOpen", "jawOpen");
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
if (report.runtime?.version !== "1.4.13") report.failures.push(`wrong-version:${report.runtime?.version || "unknown"}`);
if (report.idle.x.range > .005) report.failures.push(`idle-x-range:${report.idle.x.range}`);
if (report.idle.tilt.range > .005) report.failures.push(`idle-tilt-range:${report.idle.tilt.range}`);
if (report.idle.y.range > .005) report.failures.push(`idle-neck-y-range:${report.idle.y.range}`);
if (report.idle.scale.range > .00005) report.failures.push(`idle-global-scale-range:${report.idle.scale.range}`);
if (report.idle.chestRise.range < .08 || report.idle.chestScaleX.range < .004 || report.idle.chestScaleY.range < .0024) report.failures.push("idle-breath-not-visible");
if (report.speaking.sampleCount < 120) report.failures.push(`speaking-samples:${report.speaking.sampleCount}`);
if (report.speaking.x.range > .005) report.failures.push(`speaking-x-range:${report.speaking.x.range}`);
if (report.speaking.tilt.range > .005) report.failures.push(`speaking-tilt-range:${report.speaking.tilt.range}`);
if (report.speaking.x.maximumStep > .018) report.failures.push(`speaking-x-jump:${report.speaking.x.maximumStep}`);
if (report.speaking.y.maximumStep > .018) report.failures.push(`speaking-y-jump:${report.speaking.y.maximumStep}`);
if (report.speaking.tilt.maximumStep > .018) report.failures.push(`speaking-tilt-jump:${report.speaking.tilt.maximumStep}`);
if (report.speaking.scale.maximumStep > .0002) report.failures.push(`speaking-scale-jump:${report.speaking.scale.maximumStep}`);
if (report.speaking.expressionStrength.maximumStep > .018) report.failures.push(`expression-jump:${report.speaking.expressionStrength.maximumStep}`);
if (report.speaking.jawOpen.range < .35 || report.speaking.jawOpen.maximum > 1) report.failures.push(`jaw-range:${report.speaking.jawOpen.range}`);
if (!report.speaking.avatarModes.includes("local") || !report.speaking.localRigNames.includes("local-mouth-chin-v2")) report.failures.push("local-mouth-chin-rig-not-active");
if (report.speaking.localRigVisibleSamples < Math.floor(report.speaking.sampleCount * .95)) report.failures.push(`local-rig-visibility:${report.speaking.localRigVisibleSamples}/${report.speaking.sampleCount}`);
if (report.speaking.visibleLegacyMouthSamples) report.failures.push(`legacy-mouth-visible:${report.speaking.visibleLegacyMouthSamples}`);
if (report.speaking.localRigJawOpen.range < .25 || report.speaking.localRigJawOpen.maximum > .73) report.failures.push(`local-jaw-range:${report.speaking.localRigJawOpen.range}`);
if (report.speaking.maximumLowerAsymmetry > .002) report.failures.push(`lower-face-asymmetry:${report.speaking.maximumLowerAsymmetry}`);
if (report.speaking.maximumNoseTranslation > .0001) report.failures.push(`nose-translation:${report.speaking.maximumNoseTranslation}`);
if (report.speaking.maximumNeckTranslation > .0001) report.failures.push(`neck-translation:${report.speaking.maximumNeckTranslation}`);
if (report.speaking.maximumCheekTranslation > .0001) report.failures.push(`cheek-translation:${report.speaking.maximumCheekTranslation}`);
if (report.speaking.localRigChinOffsetPx.maximum < 2.5) report.failures.push(`chin-motion-missing:${report.speaking.localRigChinOffsetPx.maximum}`);
if (report.speaking.maximumMouthChinDistanceDeltaPx > .45) report.failures.push(`mouth-chin-distance-drift:${report.speaking.maximumMouthChinDistanceDeltaPx}`);
if (report.speaking.rootTransformSamples) report.failures.push(`root-face-transform:${report.speaking.rootTransformSamples}`);
if (report.speaking.chestRise.range < .08 || report.speaking.chestScaleX.range < .004 || report.speaking.chestScaleY.range < .0024) report.failures.push("speaking-breath-not-visible");
if (report.speaking.jawOpen.maximumStep > .14 || report.speaking.jawOpen.p95Step > .08) report.failures.push(`jaw-jump:${report.speaking.jawOpen.maximumStep}`);
if (report.speaking.jawMouthCorrelation < .82) report.failures.push(`jaw-mouth-correlation:${report.speaking.jawMouthCorrelation}`);
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
