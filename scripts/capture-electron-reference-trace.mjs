import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9235";
const outputDir = path.resolve(process.env.XIAOAN_QA_DIR || "qa/reference/electron-reference-trace");
const referenceText = process.env.XIAOAN_REFERENCE_TEXT || "的经验推动各领域的合作，为推进上海合作组织合作贡献力。";
const allowUnpackaged = process.env.XIAOAN_ALLOW_UNPACKAGED === "1";
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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const capture = async (name, clip) => {
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
  });
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  return outputPath;
};

await send("Runtime.enable");
await send("Page.enable");
const runtime = await evaluate("window.kioskBridge?.runtimeStatus?.()");
if (!runtime?.packaged && !allowUnpackaged) throw new Error("必须使用打包后的 Electron 运行时");
const hasQaApi = await evaluate("Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference)");
if (!hasQaApi) throw new Error("未使用 --qa-avatar 启动，严格参考播报接口不可用");
await evaluate("window.__XIAOAN_AVATAR_QA__.stopSpeech(); true");
await wait(250);
const regions = await evaluate(`(() => {
  const avatar = document.querySelector('.digital-human');
  const rect = avatar.getBoundingClientRect();
  return {
    full: { x: 0, y: 0, width: innerWidth, height: innerHeight },
    mouth: { x: rect.left + rect.width * .36, y: rect.top + rect.width * .445, width: rect.width * .28, height: rect.width * .13 },
    eyes: { x: rect.left + rect.width * .32, y: rect.top + rect.width * .325, width: rect.width * .36, height: rect.width * .14 },
  };
})()`);
await capture("00-before.png", regions.full);
await capture("00-before-mouth.png", regions.mouth);
await capture("00-before-eyes.png", regions.eyes);

const requestedAt = performance.now();
await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(referenceText)}); true`);
const samples = [];
const screenshots = { visemes: {}, blinks: {} };
let startedAt = 0;
let completedAt = 0;
let idleSince = 0;
let overlapSamples = 0;
let wrongFrameSamples = 0;
const deadline = performance.now() + 40_000;
while (performance.now() < deadline) {
  const state = await evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    const style = getComputedStyle(avatar);
    const frames = [...document.querySelectorAll('.digital-human__mouth-frame')].map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility }));
    return {
      speaking: avatar?.dataset.avatarState === 'speaking',
      preparing: Boolean(document.querySelector('.digital-human-stage')?.classList.contains('is-preparing')),
      mouthOpen: Number(style.getPropertyValue('--mouth-open')) || 0,
      mouthWidth: Number(style.getPropertyValue('--mouth-width')) || 1,
      viseme: avatar?.dataset.viseme || '',
      visemeCharacter: avatar?.dataset.visemeCharacter || '',
      visemeEvent: avatar?.dataset.visemeEvent || '',
      visemeCharacterIndex: avatar?.dataset.visemeCharacterIndex || '',
      visemeRole: avatar?.dataset.visemeRole || '',
      alignment: avatar?.dataset.visemeAlignment || '',
      expression: avatar?.dataset.expression || '',
      expressionStrength: Number(style.getPropertyValue('--expression-strength')) || 0,
      blinkPhase: avatar?.dataset.blinkPhase || '',
      frames,
    };
  })()`);
  const now = performance.now();
  if (state.speaking && !startedAt) startedAt = now;
  if (startedAt) {
    const activeFrames = state.frames.filter((frame) => frame.opacity > 0.5 && frame.visibility !== "hidden");
    if (state.speaking && activeFrames.length > 1) overlapSamples += 1;
    if (state.speaking && state.viseme === "CLOSED" && activeFrames.length !== 0) wrongFrameSamples += 1;
    if (state.speaking && state.viseme !== "CLOSED" && (activeFrames.length !== 1 || !activeFrames[0]?.className.toLowerCase().includes(`--${state.viseme.toLowerCase()}`))) wrongFrameSamples += 1;
    samples.push({
      timeMs: +(now - startedAt).toFixed(3),
      mouthOpen: state.mouthOpen,
      mouthWidth: state.mouthWidth,
      viseme: state.viseme,
      visemeCharacter: state.visemeCharacter,
      visemeEvent: state.visemeEvent,
      visemeCharacterIndex: state.visemeCharacterIndex,
      visemeRole: state.visemeRole,
      alignment: state.alignment,
      expression: state.expression,
      expressionStrength: state.expressionStrength,
      blinkPhase: state.blinkPhase,
      activeMouthFrames: activeFrames.map((frame) => frame.className),
    });
    // Do not capture screenshots inside the motion loop. Page.captureScreenshot
    // can stall compositor/CDP sampling for hundreds of milliseconds and
    // corrupt the aperture curve. Visual evidence is captured in the separate
    // strict-avatar acceptance pass.
  }
  if (startedAt && !state.speaking && !state.preparing) {
    if (!idleSince) idleSince = now;
    // React state and IPC events can cross on a segment boundary. Require a
    // stable idle window so the measurement cannot mistake a one-frame gap
    // for the end of the utterance and silently discard later PCM chunks.
    if (now - idleSince >= 360) {
      completedAt = idleSince;
      break;
    }
  } else idleSince = 0;
  await wait(12);
}
if (!startedAt || !completedAt) throw new Error("参考播报未在限定时间内完成");
const measuredDurationMs = completedAt - startedAt;
while (samples.length && samples.at(-1).timeMs > measuredDurationMs + 20) samples.pop();
await capture("99-after.png", regions.full);
const observedVisemes = [...new Set(samples.map((sample) => sample.viseme).filter(Boolean))];
const alignmentProviders = [...new Set(samples.map((sample) => sample.alignment).filter(Boolean))];
let visemeTransitions = 0;
let expressionTransitions = 0;
for (let index = 1; index < samples.length; index += 1) {
  if (samples[index].viseme !== samples[index - 1].viseme) visemeTransitions += 1;
  if (samples[index].expression !== samples[index - 1].expression) expressionTransitions += 1;
}
const alignmentGapWindows = [];
let alignmentGapStart = null;
for (let index = 0; index < samples.length; index += 1) {
  const inactive = samples[index].alignment === "none";
  if (inactive && alignmentGapStart == null) alignmentGapStart = samples[index].timeMs;
  const closesWindow = alignmentGapStart != null && (!inactive || index === samples.length - 1);
  if (!closesWindow) continue;
  const endIndex = inactive && index === samples.length - 1 ? index : Math.max(0, index - 1);
  const endMs = samples[endIndex].timeMs;
  alignmentGapWindows.push({
    startMs: +alignmentGapStart.toFixed(1),
    endMs: +endMs.toFixed(1),
    durationMs: +(endMs - alignmentGapStart).toFixed(1),
  });
  alignmentGapStart = null;
}
const interSegmentGapWindows = alignmentGapWindows.filter((window) => window.endMs < measuredDurationMs - 80);
const report = {
  generatedAt: new Date().toISOString(),
  runtime,
  referenceText,
  clickToSpeechMs: +(startedAt - requestedAt).toFixed(1),
  speechDurationMs: +measuredDurationMs.toFixed(1),
  sampleCount: samples.length,
  visemeTransitions,
  visemeTransitionsPerSecond: +(visemeTransitions / Math.max(.001, measuredDurationMs / 1000)).toFixed(3),
  expressionTransitions,
  observedVisemes,
  alignmentProviders,
  alignmentGapWindows,
  interSegmentGapWindows,
  totalInterSegmentGapMs: +interSegmentGapWindows.reduce((sum, window) => sum + window.durationMs, 0).toFixed(1),
  maxInterSegmentGapMs: +Math.max(0, ...interSegmentGapWindows.map((window) => window.durationMs)).toFixed(1),
  overlapSamples,
  wrongFrameSamples,
  screenshots,
  samples,
};
const reportPath = path.join(outputDir, "electron-trace.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, samples: undefined, runtime: { packaged: runtime.packaged, version: runtime.version, speech: runtime.speech, avatar: runtime.avatar }, reportPath }, null, 2));
socket.close();
