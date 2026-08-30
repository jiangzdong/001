import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9248";
const outputDir = path.resolve(process.env.XIAOAN_QA_DIR || "qa/natural-expressions-v1.4.13");
const requestedExpression = String(process.env.XIAOAN_EXPRESSION || "").trim();
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
const waitFor = async (probe, timeoutMs, label) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await wait(16);
  }
  throw new Error(`${label}超时`);
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
if (!await evaluate(`Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference)`)) throw new Error("必须用 --qa-avatar 启动最终便携包");
const eyes = await evaluate(`(() => {
  const rect = document.querySelector('.digital-human')?.getBoundingClientRect();
  return rect ? { x: rect.x + rect.width * .34, y: rect.y + rect.width * .34, width: rect.width * .32, height: rect.width * .16 } : null;
})()`);
if (!eyes) throw new Error("没有找到数字人眼部区域");

const report = { generatedAt: new Date().toISOString(), cdpUrl, outputDir, samples: {}, failures: [] };
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
await wait(12_000);

const expressionCases = [
  { expression: "concern", text: "头痛如果突然很严重，请及时就医。" },
  { expression: "encourage", text: "您可以先记录，我们一起慢慢改善。" },
].filter((sample) => !requestedExpression || sample.expression === requestedExpression);
if (!expressionCases.length) throw new Error(`未知表情: ${requestedExpression}`);
for (const sample of expressionCases) {
  const requestedAt = performance.now();
  await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(sample.text)}); true`);
  let state = null;
  let matchedAt = 0;
  const strengths = [];
  const observations = [];
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    const snapshot = await evaluate(`(() => {
      const avatar = document.querySelector('.digital-human');
      const frames = [...document.querySelectorAll('.digital-human__expression-frame')]
        .map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility }))
        .filter((frame) => frame.opacity > .02 || frame.visibility !== 'visible');
      return { expression: avatar?.dataset.expression || '', strength: Number(getComputedStyle(avatar).getPropertyValue('--expression-strength')) || 0, avatarState: avatar?.dataset.avatarState || '', hasReadyVideo: avatar?.classList.contains('has-ready-video') || false, frames };
    })()`);
    if (snapshot.avatarState === 'speaking') strengths.push(snapshot.strength);
    const key = JSON.stringify(snapshot);
    if (observations.at(-1)?.key !== key) observations.push({ atMs: Number((performance.now() - requestedAt).toFixed(1)), key, ...snapshot });
    const activeFrames = snapshot.frames.filter((frame) => frame.opacity > .35 && frame.visibility !== 'hidden');
    if (!state && snapshot.expression === sample.expression && activeFrames.length === 1 && activeFrames[0].className.includes(`--${sample.expression}`)) {
      state = { expression: snapshot.expression, frames: activeFrames, speaking: snapshot.avatarState === 'speaking' };
      matchedAt = performance.now();
    }
    if (state && (performance.now() - matchedAt >= 700 || snapshot.avatarState !== 'speaking')) break;
    await wait(16);
  }
  if (!state) {
    const diagnosticPath = path.join(outputDir, `expression-${sample.expression}-diagnostic.json`);
    await fs.writeFile(diagnosticPath, `${JSON.stringify({ sample, observations }, null, 2)}\n`, "utf8");
    throw new Error(`${sample.expression}自然表情超时，诊断：${diagnosticPath}`);
  }
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...eyes, scale: 2 } });
  const screenshotPath = path.join(outputDir, `expression-${sample.expression}.png`);
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  const minimumStrength = Math.min(...strengths);
  const maximumStrength = Math.max(...strengths);
  report.samples[sample.expression] = { ...state, text: sample.text, observedAfterMs: Number((matchedAt - requestedAt).toFixed(1)), minimumStrength, maximumStrength, strengthRange: maximumStrength - minimumStrength, strengthSampleCount: strengths.length, screenshot: screenshotPath };
  await waitFor(() => evaluate(`document.querySelector('.digital-human')?.dataset.avatarState !== 'speaking'`), 30_000, `${sample.expression}播报结束`);
  await wait(500);
}

for (const expression of expressionCases.map((sample) => sample.expression)) {
  const sample = report.samples[expression];
  if (!sample || sample.frames.length !== 1 || !sample.frames[0].className.includes(`--${expression}`)) report.failures.push(`natural-expression-invalid:${expression}`);
  if (sample && sample.strengthRange < .08) report.failures.push(`expression-too-rigid:${expression}`);
  if (sample && sample.maximumStrength >= .8) report.failures.push(`expression-too-strong:${expression}`);
}
report.result = report.failures.length ? "FAIL" : "PASS";
const reportPath = path.join(outputDir, "report.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, result: report.result, failures: report.failures, samples: report.samples }, null, 2));
socket.close();
if (report.failures.length) process.exitCode = 1;
