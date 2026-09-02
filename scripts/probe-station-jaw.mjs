import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9256);
const outputDir = path.resolve(process.argv[3] || "qa/station-jaw-probe");
await fs.mkdir(outputDir, { recursive: true });
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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const capture = async (name, clip) => {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 2 } });
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
  return outputPath;
};
const captureRigCanvas = async (name) => {
  const dataUrl = await evaluate(`document.querySelector('.station-advisor-digital-human__local-rig')?.toDataURL('image/png') || ''`);
  if (!dataUrl) return "";
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(dataUrl.split(',')[1], "base64"));
  return outputPath;
};
const readState = `(() => {
  const avatar=document.querySelector('.station-advisor-digital-human');
  const rig=document.querySelector('.station-advisor-digital-human__local-rig');
  const rect=avatar?.getBoundingClientRect();
  return {
    ready: avatar?.dataset.rigReady === 'true' && Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference),
    speaking: avatar?.dataset.speaking === 'true',
    viseme: avatar?.dataset.viseme || '',
    jawOpen: Number(avatar?.dataset.jawOpen || 0),
    chinOffsetPx: Number(rig?.dataset.chinOffsetPx || 0),
    rect: rect && {x:rect.x,y:rect.y,width:rect.width,height:rect.height},
  };
})()`;

await Promise.all([send("Runtime.enable"), send("Page.enable")]);
await send("Page.bringToFront");
await send("Page.reload", { ignoreCache: true });
let initial;
for (let index = 0; index < 200; index += 1) {
  initial = await evaluate(readState);
  if (initial?.ready) break;
  await wait(50);
}
if (!initial?.ready) throw new Error("Station jaw probe did not become ready");
const faceClip = {
  x: initial.rect.x + initial.rect.width * 0.28,
  y: initial.rect.y + initial.rect.width * 0.14,
  width: initial.rect.width * 0.44,
  height: initial.rect.width * 0.58,
};
const report = { generatedAt: new Date().toISOString(), runtime: await evaluate("window.kioskBridge?.runtimeStatus?.()"), initial, samples: {}, failures: [] };
report.idle = await capture("idle-face.png", faceClip);
report.idleRig = await captureRigCanvas("idle-rig.png");

for (const sample of [
  // Capture the restrained A peak. The threshold is a sampling trigger only;
  // anatomical acceptance is performed on the resulting MediaPipe landmarks.
  { name: "speech", threshold: 0.18, viseme: "A" },
]) {
  await evaluate(`window.__XIAOAN_AVATAR_QA__?.stopSpeech?.(); true`);
  await wait(180);
  await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference("小安口型验收。啊啊啊，啊啊啊。诶诶诶。哦哦哦。呜呜呜。"); true`);
  let peak = null;
  let bestCapturedJaw = -1;
  let speechSeen = false;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const state = await evaluate(readState);
    if (!peak || state.jawOpen > peak.jawOpen) peak = state;
    speechSeen ||= state.speaking;
    if (state.speaking && state.viseme === sample.viseme && state.jawOpen >= sample.threshold && state.jawOpen > bestCapturedJaw + 0.012) {
      bestCapturedJaw = state.jawOpen;
      report.samples[sample.name] = {
        state,
        rigCanvas: await captureRigCanvas(`${sample.name}-peak-rig.png`),
      };
    }
    // Streaming TTS may briefly return to idle between chunks. Do not end the
    // probe until the requested natural viseme has actually been captured.
    if (report.samples[sample.name] && speechSeen && !state.speaking) break;
    await wait(24);
  }
  if (report.samples[sample.name]) report.samples[sample.name].observedPeakState = peak;
  else report.failures.push(`${sample.name}-peak-missing:${JSON.stringify(peak || {})}`);
  const settleDeadline = Date.now() + 20_000;
  let idleSince = 0;
  while (Date.now() < settleDeadline) {
    const state = await evaluate(readState);
    if (!state.speaking) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= 500) break;
    } else {
      idleSince = 0;
    }
    await wait(40);
  }
}
await evaluate(`window.__XIAOAN_AVATAR_QA__?.stopSpeech?.(); true`);
report.result = report.failures.length ? "FAIL" : "PASS";
const reportPath = path.join(outputDir, "report.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, result: report.result, failures: report.failures, samples: report.samples }, null, 2));
socket.close();
if (report.failures.length) process.exitCode = 1;
