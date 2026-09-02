import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9262);
const outputDir = path.resolve(process.argv[3] || "qa/station-compositor-probe");
const unmask = process.argv.includes("--unmask");
const softRigMask = process.argv.includes("--soft-rig-mask");
const alignWrapper = process.argv.includes("--align-wrapper");
const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const targetViseme = String(option("viseme") || "A").toUpperCase();
const phrases = {
  A: "啊啊啊，啊啊啊，啊啊啊，啊啊啊。",
  E: "诶诶诶，诶诶诶，诶诶诶，诶诶诶。",
  O: "哦哦哦，哦哦哦，哦哦哦，哦哦哦。",
  U: "呜呜呜，呜呜呜，呜呜呜，呜呜呜。",
};
const thresholds = { A: 0.24, E: 0.08, O: 0.08, U: 0.045 };
const phrase = option("phrase") || phrases[targetViseme] || phrases.A;
const jawThreshold = Number(option("threshold") || thresholds[targetViseme] || 0.04);
const targetSampleCount = Math.max(1, Number(option("samples") || 6));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
const capture = async (name, clip) => {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { ...clip, scale: captureScaleFor(clip) },
  });
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
  return outputPath;
};
const captureData = async (clip) => {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    optimizeForSpeed: true,
    // Keep idle and dynamic captures at the same pixel grid so nose/skin
    // stability can be measured without resampling noise.
    clip: { ...clip, scale: captureScaleFor(clip) },
  });
  return result.data;
};
const captureRig = async (name) => {
  const dataUrl = await evaluate(`document.querySelector('.station-advisor-digital-human__local-rig')?.toDataURL('image/png') || ''`);
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(dataUrl.split(",")[1], "base64"));
  return outputPath;
};

const readState = `(() => {
  const avatar=document.querySelector('.station-advisor-digital-human');
  const rig=document.querySelector('.station-advisor-digital-human__local-rig');
  const fullBody=document.querySelector('.advisor-full-body-avatar');
  const rect=fullBody?.getBoundingClientRect();
  const rigRect=rig?.getBoundingClientRect();
  const style=rig && getComputedStyle(rig);
  return {
    ready: avatar?.dataset.rigReady === 'true' && Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference),
    speaking: avatar?.dataset.speaking === 'true',
    viseme: avatar?.dataset.viseme || '',
    rigViseme: rig?.dataset.viseme || '',
    textureFrame: rig?.dataset.textureFrame || '',
    texturePolicy: rig?.dataset.texturePolicy || '',
    jawOpen: Number(avatar?.dataset.jawOpen || 0),
    chinOffsetPx: Number(rig?.dataset.chinOffsetPx || 0),
    rig: rig && {
      maskImage: style.maskImage,
      webkitMaskImage: style.webkitMaskImage,
      opacity: style.opacity,
      visibility: style.visibility,
      datasetRig: rig.dataset.rig || '',
    },
    fullBodyRect: rect && {x:rect.x,y:rect.y,width:rect.width,height:rect.height},
    rigRect: rigRect && {x:rigRect.x,y:rigRect.y,width:rigRect.width,height:rigRect.height,canvasWidth:rig.width,canvasHeight:rig.height},
  };
})()`;

// The advisor can reflow between the idle and speaking states. A face clip
// derived only at startup then points at stale, sometimes empty, screen space.
// Derive every final-window crop from the same live full-body rectangle that
// was observed with the matching viseme, so the evidence remains a paired
// compositor capture rather than a raw-canvas substitute.
const faceClipFor = (state) => {
  const rect = state?.fullBodyRect;
  const rig = state?.rigRect;
  if (!rect || !rig || !(rect.width > 0) || !(rect.height > 0) || !(rig.width > 0) || !(rig.height > 0)) return null;
  // The rig element is the only reliable live coordinate system after a
  // responsive Electron reflow. Its rect already contains the V34 face
  // mapping and transform, so derive a nose-to-chin crop from it instead of
  // reimplementing source-image affine math in this QA utility.
  const paddingX = rig.width * 0.24;
  const topPadding = rig.height * 0.8;
  const bottomPadding = rig.height * 0.9;
  const left = Math.max(rect.x, rig.x - paddingX);
  const top = Math.max(rect.y, rig.y - topPadding);
  const right = Math.min(rect.x + rect.width, rig.x + rig.width + paddingX);
  const bottom = Math.min(rect.y + rect.height, rig.y + rig.height + bottomPadding);
  if (right <= left || bottom <= top) return null;
  return { x: Math.max(0, left), y: Math.max(0, top), width: right - left, height: bottom - top };
};

const captureScaleFor = (clip) => Math.max(2, Math.min(12, 420 / Math.max(1, clip?.width || 1)));

await Promise.all([send("Runtime.enable"), send("Page.enable")]);
await send("Page.bringToFront");
if (unmask) {
  await evaluate(`(() => {
    document.getElementById('xiaoan-compositor-probe-unmask')?.remove();
    const style=document.createElement('style');
    style.id='xiaoan-compositor-probe-unmask';
    style.textContent='.advisor-avatar-stage.is-home .station-advisor-digital-human__local-rig{mask-image:none!important;-webkit-mask-image:none!important;}';
    document.head.append(style);
    return true;
  })()`);
}
if (softRigMask) {
  await evaluate(`(() => {
    document.getElementById('xiaoan-compositor-probe-soft-mask')?.remove();
    const style=document.createElement('style');
    style.id='xiaoan-compositor-probe-soft-mask';
    style.textContent='.advisor-avatar-stage.is-home .station-advisor-digital-human__local-rig{mask-image:radial-gradient(ellipse 43% 36% at 50% 60%,#000 0 48%,rgba(0,0,0,.85) 78%,transparent 100%)!important;-webkit-mask-image:radial-gradient(ellipse 43% 36% at 50% 60%,#000 0 48%,rgba(0,0,0,.85) 78%,transparent 100%)!important;}';
    document.head.append(style);
    return true;
  })()`);
}
if (alignWrapper) {
  await evaluate(`(() => {
    document.getElementById('xiaoan-compositor-probe-align-wrapper')?.remove();
    const style=document.createElement('style');
    style.id='xiaoan-compositor-probe-align-wrapper';
    style.textContent='.advisor-avatar-stage.is-home>.station-advisor-digital-human{transform:translate3d(4.766cqw,-.45cqw,0) scale(.64744)!important;}';
    document.head.append(style);
    return true;
  })()`);
}

let initial;
for (let index = 0; index < 160; index += 1) {
  initial = await evaluate(readState);
  if (initial?.ready) break;
  await wait(50);
}
if (!initial?.ready) throw new Error(`Station compositor probe did not become ready: ${JSON.stringify(initial)}`);
const idleFaceClip = faceClipFor(initial);
if (!idleFaceClip) throw new Error(`Station compositor full-body rectangle missing: ${JSON.stringify(initial)}`);
const report = {
  generatedAt: new Date().toISOString(),
  mode: unmask ? "diagnostic-unmask" : "runtime-css",
  targetViseme,
  jawThreshold,
  targetSampleCount,
  runtime: await evaluate("window.kioskBridge?.runtimeStatus?.()"),
  initial,
  idleFaceClip,
  samples: [],
  attempts: [],
};
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
await wait(220);
report.idle = await capture("idle-composite.png", idleFaceClip);
await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(phrase)}); true`);
const deadline = Date.now() + 20_000;
let bestJaw = -1;
while (Date.now() < deadline && report.samples.length < targetSampleCount) {
  const state = await evaluate(readState);
  if (state.speaking && state.viseme === targetViseme && state.textureFrame === targetViseme && state.jawOpen >= jawThreshold && report.attempts.length < 10) {
    // A DOM label can change one compositor frame before Chromium presents the
    // updated canvas. Require the target pose to survive several display ticks
    // before capturing the final window; raw-canvas-only evidence is invalid.
    await wait(52);
    const held = await evaluate(readState);
    if (!(held.speaking && held.viseme === targetViseme && held.textureFrame === targetViseme && held.jawOpen >= jawThreshold)) continue;
    // Read the raw canvas synchronously while the matching runtime state is
    // still active. A 4K Page.captureScreenshot can finish after a short vowel
    // has already closed, so retaining this paired raw frame is essential for
    // distinguishing renderer output from final-window compositor latency.
    const rigDataUrl = await evaluate(`document.querySelector('.station-advisor-digital-human__local-rig')?.toDataURL('image/png') || ''`);
    const layerDataUrls = await evaluate(`(() => {
      const rig=document.querySelector('.station-advisor-digital-human__local-rig');
      return {
        jaw: rig?.__localFaceRigBuffer?.toDataURL?.('image/png') || '',
        mouth: rig?.__localFaceRigMouthBuffer?.toDataURL?.('image/png') || '',
      };
    })()`);
    const rigBeforePath = path.join(outputDir, `${targetViseme.toLowerCase()}-attempt-${String(report.attempts.length + 1).padStart(2, "0")}-${state.jawOpen.toFixed(3)}-rig-before.png`);
    if (rigDataUrl) await fs.writeFile(rigBeforePath, Buffer.from(rigDataUrl.split(",")[1], "base64"));
    const jawLayerPath = path.join(outputDir, `${targetViseme.toLowerCase()}-attempt-${String(report.attempts.length + 1).padStart(2, "0")}-${state.jawOpen.toFixed(3)}-jaw-layer.png`);
    const mouthLayerPath = path.join(outputDir, `${targetViseme.toLowerCase()}-attempt-${String(report.attempts.length + 1).padStart(2, "0")}-${state.jawOpen.toFixed(3)}-mouth-layer.png`);
    if (layerDataUrls?.jaw) await fs.writeFile(jawLayerPath, Buffer.from(layerDataUrls.jaw.split(",")[1], "base64"));
    if (layerDataUrls?.mouth) await fs.writeFile(mouthLayerPath, Buffer.from(layerDataUrls.mouth.split(",")[1], "base64"));
    const faceClip = faceClipFor(held);
    if (!faceClip) continue;
    const compositeData = await captureData(faceClip);
    const after = await evaluate(readState);
    const stable = after.speaking && after.viseme === targetViseme && after.textureFrame === targetViseme && after.jawOpen >= jawThreshold;
    const attemptName = `${targetViseme.toLowerCase()}-attempt-${String(report.attempts.length + 1).padStart(2, "0")}-${held.jawOpen.toFixed(3)}-${after.viseme || "idle"}-${after.jawOpen.toFixed(3)}.png`;
    const attemptPath = path.join(outputDir, attemptName);
    await fs.writeFile(attemptPath, Buffer.from(compositeData, "base64"));
    report.attempts.push({ detected: state, before: held, after, faceClip, captureScale: captureScaleFor(faceClip), composite: attemptPath, rigCanvas: rigDataUrl ? rigBeforePath : null, jawLayer: layerDataUrls?.jaw ? jawLayerPath : null, mouthLayer: layerDataUrls?.mouth ? mouthLayerPath : null, stable });
    if (stable) {
      const acceptedJaw = Math.min(held.jawOpen, after.jawOpen);
      if (acceptedJaw > bestJaw + 0.018) {
        bestJaw = acceptedJaw;
        const suffix = `${report.samples.length + 1}-${acceptedJaw.toFixed(3)}`;
        const rigCanvas = path.join(outputDir, `${targetViseme.toLowerCase()}-${suffix}-rig.png`);
        await fs.writeFile(rigCanvas, Buffer.from(rigDataUrl.split(",")[1], "base64"));
        report.samples.push({ before: held, after, faceClip, captureScale: captureScaleFor(faceClip), composite: attemptPath, rigCanvas, captureMode: "natural-local-tts-held-52ms-and-stable-before-and-after-capture" });
      }
    }
    await wait(12);
  }
  if (report.samples.length && !state.speaking) break;
  await wait(12);
}
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); document.getElementById('xiaoan-compositor-probe-unmask')?.remove(); true`);
report.final = await evaluate(readState);
report.result = report.samples.length ? "STABLE_CAPTURED" : report.attempts.length ? "CANDIDATES_ONLY" : `NO_${targetViseme}_FRAME`;
const reportPath = path.join(outputDir, "report.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify({ reportPath, result: report.result, mode: report.mode, initialMask: report.initial.rig, samples: report.samples, attempts: report.attempts }, null, 2));
if (!report.attempts.length) process.exitCode = 1;
