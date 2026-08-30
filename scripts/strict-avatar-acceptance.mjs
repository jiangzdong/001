import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9229";
const outputDir = path.resolve(process.env.XIAOAN_QA_DIR || "qa/strict-avatar-v1.4.13-source");
const referenceText = "阿姨微笑着说，啊，诶，哦，乌，我会服务好每一位用户。";
await fs.mkdir(outputDir, { recursive: true });

const targets = await fetch(`${cdpUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("Electron page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const screencastFrames = [];
let sequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Page.screencastFrame") {
    screencastFrames.push({
      data: message.params.data,
      metadata: message.params.metadata,
      capturedAtEpochMs: Number(message.params.metadata?.timestamp) * 1000,
      receivedAt: performance.now(),
    });
    if (screencastFrames.length > 420) screencastFrames.shift();
    void send("Page.screencastFrameAck", { sessionId: message.params.sessionId });
    return;
  }
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
const waitForPaints = () => evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await wait(250);
await send("Page.reload", { ignoreCache: true });
await wait(1200);

async function capture(name, clip, scale = 2) {
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale } } : {}),
  });
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  return outputPath;
}

async function cropScreencastFrame(name, frameData, clip, scale = 2) {
  const cropped = await evaluate(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify("data:image/jpeg;base64,")} + ${JSON.stringify(frameData)};
    await image.decode();
    const ratioX = image.naturalWidth / innerWidth;
    const ratioY = image.naturalHeight / innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(${clip.width} * ${scale}));
    canvas.height = Math.max(1, Math.round(${clip.height} * ${scale}));
    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(
      image,
      ${clip.x} * ratioX,
      ${clip.y} * ratioY,
      ${clip.width} * ratioX,
      ${clip.height} * ratioY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL('image/png').split(',')[1];
  })()`);
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(cropped, "base64"));
  return outputPath;
}

async function readScreencastMarker(frameData) {
  return evaluate(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify("data:image/jpeg;base64,")} + ${JSON.stringify(frameData)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 6 * image.naturalWidth / innerWidth, 6 * image.naturalHeight / innerHeight, 1, 1, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  })()`);
}

async function measureMouthGridEdges(referenceFrameData, targetFrameData, clip, scale = 2) {
  return evaluate(`(async () => {
    const load = async (data) => {
      const image = new Image();
      image.src = ${JSON.stringify("data:image/jpeg;base64,")} + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(${clip.width} * ${scale}));
      canvas.height = Math.max(1, Math.round(${clip.height} * ${scale}));
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      const ratioX = image.naturalWidth / innerWidth;
      const ratioY = image.naturalHeight / innerHeight;
      context.drawImage(image, ${clip.x} * ratioX, ${clip.y} * ratioY, ${clip.width} * ratioX, ${clip.height} * ratioY, 0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const reference = await load(${JSON.stringify(referenceFrameData)});
    const target = await load(${JSON.stringify(targetFrameData)});
    const leftX = Math.round(reference.width * ((.392 - .37) / .26));
    const rightX = Math.round(reference.width * ((.608 - .37) / .26));
    const topY = Math.round(reference.height * ((.492 - .43) / .2));
    const bottomY = Math.min(reference.height, Math.round(reference.height * ((.618 - .43) / .2)));
    const meanDelta = (centerX) => {
      let sum = 0;
      let count = 0;
      for (let y = topY; y < bottomY; y += 1) {
        for (let x = Math.max(0, centerX - 2); x <= Math.min(reference.width - 1, centerX + 2); x += 1) {
          const offset = (y * reference.width + x) * 4;
          sum += (Math.abs(target.pixels[offset] - reference.pixels[offset])
            + Math.abs(target.pixels[offset + 1] - reference.pixels[offset + 1])
            + Math.abs(target.pixels[offset + 2] - reference.pixels[offset + 2])) / 3;
          count += 1;
        }
      }
      return count ? sum / count : 0;
    };
    return { left: meanDelta(leftX), right: meanDelta(rightX) };
  })()`);
}

function blinkPhaseFromMarker([red = 0, green = 0, blue = 0] = []) {
  if (red > 130 && red > green * 1.5 && red > blue * 1.5) return "entry";
  if (green > 130 && green > red * 1.5 && green > blue * 1.5) return "closed";
  if (blue > 130 && blue > red * 1.5 && blue > green * 1.5) return "exit";
  return "";
}

function visemeFromMarker([red = 0, green = 0, blue = 0] = []) {
  if (red > 130 && blue > 130 && green < 120) return "CLOSED";
  if (green > 130 && blue > 130 && red < 120) return "U";
  if (red > 130 && red > green * 1.5 && red > blue * 1.5) return "A";
  if (green > 130 && green > red * 1.5 && green > blue * 1.5) return "E";
  if (blue > 130 && blue > red * 1.5 && blue > green * 1.5) return "O";
  return "";
}

function longestNaturalWindow(sampleTimes) {
  const windows = [];
  for (const time of sampleTimes) {
    const current = windows.at(-1);
    if (!current || time - current.at(-1) > 90) windows.push([time]);
    else current.push(time);
  }
  return windows.sort((left, right) => right.length - left.length)[0] || [];
}

async function clickSelector(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Control not found: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}

const report = {
  generatedAt: new Date().toISOString(),
  cdpUrl,
  outputDir,
  failures: [],
  observedVisemes: [],
  visemeSamples: {},
  expressionSamples: {},
  blinkSamples: {},
};

report.initial = await evaluate(`(async () => {
  const shell = document.querySelector('.kiosk-shell');
  const avatar = document.querySelector('.digital-human');
  const expressionFrames = [...document.querySelectorAll('.digital-human__expression-frame')];
  const shellRect = shell?.getBoundingClientRect();
  return {
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    shellRect: shellRect ? shellRect.toJSON() : null,
    screen: shell?.className || '',
    avatarExpression: avatar?.dataset.expression || '',
    expressionFrameCount: expressionFrames.length,
    expressionSources: expressionFrames.map((frame) => frame.getAttribute('src')),
    runtime: await window.kioskBridge?.runtimeStatus?.(),
  };
})()`);
await capture("00-initial-window.png");

await clickSelector('[aria-controls="avatar-settings-dialog"]');
await wait(180);
report.settings = await evaluate(`(() => {
  const dialog = document.querySelector('#avatar-settings-dialog');
  const options = [...document.querySelectorAll('.avatar-mode-option')];
  return {
    visible: Boolean(dialog),
    localSelected: options.some((option) => option.textContent.includes('本地') && option.getAttribute('aria-checked') === 'true'),
    cloudReserved: options.some((option) => option.textContent.includes('云GPU') && option.disabled && option.textContent.includes('后续接入')),
    labels: options.map((option) => option.textContent.replace(/\s+/g, ' ').trim()),
  };
})()`);
report.settings.screenshot = await capture("01-avatar-settings.png");
if (!report.settings.visible || !report.settings.localSelected || !report.settings.cloudReserved) report.failures.push("avatar-settings-contract");
await clickSelector("#avatar-settings-dialog .secondary-action");
await wait(180);

const shell = report.initial.shellRect;
const viewport = report.initial.viewport;
if (!shell || shell.x < -0.5 || shell.y < -0.5 || shell.x + shell.width > viewport.width + 0.5 || shell.y + shell.height > viewport.height + 0.5) report.failures.push("shell-clipped");
if (report.initial.expressionFrameCount !== 4) report.failures.push("expression-library-not-mounted");

const regions = await evaluate(`(() => {
  const rect = document.querySelector('.digital-human')?.getBoundingClientRect();
  if (!rect) return null;
  return {
    mouth: { x: rect.x + rect.width * .37, y: rect.y + rect.width * .43, width: rect.width * .26, height: rect.width * .2 },
    eyes: { x: rect.x + rect.width * .34, y: rect.y + rect.width * .34, width: rect.width * .32, height: rect.width * .16 },
    head: { x: rect.x + rect.width * .26, y: rect.y + rect.width * .18, width: rect.width * .48, height: rect.width * .52 },
  };
})()`);
if (!regions) throw new Error("Digital human region not found");

const hasWelcomeVoice = await evaluate(`Boolean(document.querySelector('.welcome-voice'))`);
if (!hasWelcomeVoice) {
  const hasHomeControl = await evaluate(`Boolean(document.querySelector('.topbar-home'))`);
  const hasBackControl = await evaluate(`Boolean(document.querySelector('.progress-head button, .conversation-head button'))`);
  if (!hasHomeControl && !hasBackControl) throw new Error("No route back to the welcome screen was found");
  await clickSelector(hasHomeControl ? ".topbar-home" : ".progress-head button, .conversation-head button");
  await wait(500);
}
const welcomeExpression = await evaluate(`(() => {
  const frames = [...document.querySelectorAll('.digital-human__expression-frame')].filter((frame) => Number(getComputedStyle(frame).opacity) > .3 && getComputedStyle(frame).visibility !== 'hidden');
  return { expression: document.querySelector('.digital-human')?.dataset.expression || '', activeFrames: frames.map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility })) };
})()`);
if (welcomeExpression.expression === "smile") {
  report.expressionSamples.smile = { screenshot: await capture("expression-smile.png", regions.eyes), activeFrames: welcomeExpression.activeFrames };
  if (welcomeExpression.activeFrames.length !== 1 || !welcomeExpression.activeFrames[0].className.includes("--smile")) report.failures.push("expression-not-exclusive:smile");
}
await clickSelector(".welcome-voice");
await wait(350);

async function triggerNaturalVoicePreview() {
  await send("Page.bringToFront");
  const hasQaReference = await evaluate("Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference)");
  if (hasQaReference) {
    await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(referenceText)}); true`);
    return;
  }
  for (let index = 0; index < 5; index += 1) {
    await clickSelector(".forehead-admin-trigger");
    await wait(220);
  }
  await wait(520);
}

async function closeVoicePreviewDialog() {
  return undefined;
}

await evaluate(`(() => {
  window.__XIAOAN_VISEME_MARKER_CLEANUP__?.();
  const avatar = document.querySelector('.digital-human');
  const marker = document.createElement('span');
  marker.id = 'xiaoan-natural-viseme-marker';
  Object.assign(marker.style, { position: 'fixed', left: '0', top: '0', width: '12px', height: '12px', zIndex: '2147483647', pointerEvents: 'none', background: '#000' });
  document.body.append(marker);
  const update = () => {
    const speaking = avatar?.dataset.avatarState === 'speaking' && !avatar?.classList.contains('has-ready-video');
    const viseme = speaking ? avatar?.dataset.viseme || '' : '';
    marker.style.background = viseme === 'CLOSED' ? '#ff00ff' : viseme === 'A' ? '#ff0000' : viseme === 'E' ? '#00ff00' : viseme === 'O' ? '#0000ff' : viseme === 'U' ? '#00ffff' : '#000000';
  };
  const observer = new MutationObserver(update);
  observer.observe(avatar, { attributes: true, attributeFilter: ['data-avatar-state', 'data-viseme', 'class'] });
  update();
  window.__XIAOAN_VISEME_MARKER_CLEANUP__ = () => { observer.disconnect(); marker.remove(); delete window.__XIAOAN_VISEME_MARKER_CLEANUP__; };
  return true;
})()`);
await triggerNaturalVoicePreview();
await closeVoicePreviewDialog();
await send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
const mouthDeadline = performance.now() + 18_000;
const observed = new Set();
const naturalVisemeTimes = { CLOSED: [], A: [], E: [], O: [], U: [] };
let sawSpeaking = false;
let sawTalkScreen = false;
let overlapSamples = 0;
let wrongFrameSamples = 0;
let softFrameSamples = 0;
let legacyMouthNodeSamples = 0;
let rootTransformSamples = 0;
let maximumChinOffsetPx = 0;
let maximumMouthChinDistanceDeltaPx = 0;
let maximumCheekTranslation = 0;
let lastState = null;

while (performance.now() < mouthDeadline) {
  const state = await evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    const localRig = document.querySelector('.digital-human__local-rig');
    const localRigStyle = localRig ? getComputedStyle(localRig) : null;
    const frames = [...document.querySelectorAll('.digital-human__mouth-frame')];
    const expressionFrames = [...document.querySelectorAll('.digital-human__expression-frame')];
    const activeExpressionFrames = expressionFrames.filter((frame) => Number(getComputedStyle(frame).opacity) > .3 && getComputedStyle(frame).visibility !== 'hidden');
    return {
      screen: document.querySelector('.kiosk-shell')?.className || '',
      speaking: avatar?.dataset.avatarState === 'speaking',
      viseme: avatar?.dataset.viseme || '',
      expression: avatar?.dataset.expression || '',
      capturedAtEpochMs: Date.now(),
      hasReadyVideo: avatar?.classList.contains('has-ready-video') || false,
      avatarTransform: avatar ? getComputedStyle(avatar).transform : '',
      avatarMode: avatar?.dataset.avatarMode || '',
      localRig: localRig ? {
        visible: localRigStyle.visibility !== 'hidden' && Number(localRigStyle.opacity) > .5,
        rig: localRig.dataset.rig || '',
        viseme: localRig.dataset.viseme || '',
        jawOpen: Number(localRig.dataset.jawOpen || 0),
        lowerLeft: Number(localRig.dataset.lowerLeft || 0),
        lowerRight: Number(localRig.dataset.lowerRight || 0),
        noseTranslation: Number(localRig.dataset.noseTranslation || 0),
        neckLeft: Number(localRig.dataset.neckLeft || 0),
        neckRight: Number(localRig.dataset.neckRight || 0),
        cheekLeft: Number(localRig.dataset.cheekLeft || 0),
        cheekRight: Number(localRig.dataset.cheekRight || 0),
        lowerLipOffsetPx: Number(localRig.dataset.lowerLipOffsetPx || 0),
        chinOffsetPx: Number(localRig.dataset.chinOffsetPx || 0),
        mouthChinDistanceDeltaPx: Number(localRig.dataset.mouthChinDistanceDeltaPx || 0),
      } : null,
      expressionFrames: activeExpressionFrames.map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility })),
      frames: frames.map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility })),
    };
  })()`);
  lastState = state;
  sawTalkScreen ||= state.screen.includes("screen-talk");
  if (state.expression && state.expression !== "neutral" && state.expression !== "blink") {
    const matchingExpression = state.expressionFrames.length === 1
      && state.expressionFrames[0].className.includes(`--${state.expression}`)
      && state.expressionFrames[0].opacity > 0.35;
    if (state.expressionFrames.length > 1 || (state.expressionFrames.length === 1 && !state.expressionFrames[0].className.includes(`--${state.expression}`))) {
      const failure = `expression-not-exclusive:${state.expression}`;
      if (!report.failures.includes(failure)) report.failures.push(failure);
    }
    if (matchingExpression && !report.expressionSamples[state.expression]) report.expressionSamples[state.expression] = { screenshot: null, activeFrames: state.expressionFrames };
  }
  if (state.speaking && !state.hasReadyVideo) {
    sawSpeaking = true;
    if (state.frames.length) legacyMouthNodeSamples += 1;
    if (state.avatarTransform !== "none") rootTransformSamples += 1;
    maximumChinOffsetPx = Math.max(maximumChinOffsetPx, Math.abs(state.localRig?.chinOffsetPx || 0));
    maximumMouthChinDistanceDeltaPx = Math.max(maximumMouthChinDistanceDeltaPx, Math.abs(state.localRig?.mouthChinDistanceDeltaPx || 0));
    maximumCheekTranslation = Math.max(maximumCheekTranslation, Math.abs(state.localRig?.cheekLeft || 0), Math.abs(state.localRig?.cheekRight || 0));
    const activeFrames = state.frames.filter((frame) => frame.opacity > 0.5 && frame.visibility !== "hidden");
    const softFrames = state.frames.filter((frame) => frame.opacity > 0.02 && frame.opacity < 0.98 && frame.visibility !== "hidden");
    if (activeFrames.length > 1) overlapSamples += 1;
    if (softFrames.length) softFrameSamples += 1;
    const localRigMatches = state.avatarMode === "local"
      && state.localRig?.visible
      && state.localRig.rig === "local-mouth-chin-v2"
      && state.localRig.viseme === state.viseme
      && Math.abs(state.localRig.lowerLeft - state.localRig.lowerRight) <= .002
      && Math.abs(state.localRig.noseTranslation) <= .0001
      && Math.max(Math.abs(state.localRig.neckLeft), Math.abs(state.localRig.neckRight)) <= .0001;
    if (activeFrames.length !== 0 || !localRigMatches) wrongFrameSamples += 1;
    if (state.viseme) observed.add(state.viseme);
    if (naturalVisemeTimes[state.viseme]) naturalVisemeTimes[state.viseme].push(state.capturedAtEpochMs);
  }
  if (sawSpeaking && !state.speaking && observed.size >= 4) break;
  await wait(8);
}
await send("Page.stopScreencast");
await wait(80);

report.observedVisemes = [...observed];
report.mouth = { sawTalkScreen, sawSpeaking, overlapSamples, wrongFrameSamples, softFrameSamples, legacyMouthNodeSamples, rootTransformSamples, maximumChinOffsetPx, maximumMouthChinDistanceDeltaPx, maximumCheekTranslation, finalState: lastState };
if (!sawTalkScreen) report.failures.push("talk-navigation-failed");
if (!sawSpeaking) report.failures.push("natural-local-tts-not-observed");
if (overlapSamples) report.failures.push(`mouth-overlap:${overlapSamples}`);
if (wrongFrameSamples) report.failures.push(`mouth-frame-mismatch:${wrongFrameSamples}`);
if (softFrameSamples) report.failures.push(`mouth-soft-alpha-blend:${softFrameSamples}`);
if (legacyMouthNodeSamples) report.failures.push(`legacy-mouth-nodes:${legacyMouthNodeSamples}`);
if (rootTransformSamples) report.failures.push(`root-face-transform:${rootTransformSamples}`);
if (maximumChinOffsetPx < 2.5) report.failures.push(`chin-motion-missing:${maximumChinOffsetPx.toFixed(3)}`);
if (maximumMouthChinDistanceDeltaPx > .45) report.failures.push(`mouth-chin-distance-drift:${maximumMouthChinDistanceDeltaPx.toFixed(3)}`);
if (maximumCheekTranslation > .0001) report.failures.push(`cheek-translation:${maximumCheekTranslation.toFixed(4)}`);
if (await evaluate(`Boolean(document.querySelector('#voice-settings-dialog'))`)) {
  await clickSelector("#voice-settings-dialog .primary-action");
  await wait(200);
}
await capture("10-talk-after-speech.png");

const mouthFrameCandidates = [];
for (const targetShape of ["CLOSED", "A", "E", "O", "U"]) {
  const naturalWindow = longestNaturalWindow(naturalVisemeTimes[targetShape]);
  if (!naturalWindow.length) continue;
  for (const frame of screencastFrames) {
    if (frame.capturedAtEpochMs >= naturalWindow[0] - 180 && frame.capturedAtEpochMs <= naturalWindow.at(-1) + 220 && !mouthFrameCandidates.includes(frame)) mouthFrameCandidates.push(frame);
  }
}
const markedMouthFrames = [];
const selectedMouthFrameData = {};
for (const frame of mouthFrameCandidates) {
  const markerRgb = await readScreencastMarker(frame.data);
  const viseme = visemeFromMarker(markerRgb);
  if (viseme) markedMouthFrames.push({ frame, viseme, markerRgb });
}
for (const targetShape of ["CLOSED", "A", "E", "O", "U"]) {
  const naturalWindow = longestNaturalWindow(naturalVisemeTimes[targetShape]);
  const matchingFrames = markedMouthFrames.filter((item) => item.viseme === targetShape);
  const match = matchingFrames[Math.floor(matchingFrames.length / 2)];
  if (!match) {
    report.failures.push(`natural-viseme-screenshot-missing:${targetShape}`);
    continue;
  }
  const screenshot = await cropScreencastFrame(`mouth-${targetShape.toLowerCase()}.png`, match.frame.data, regions.mouth, 2);
  selectedMouthFrameData[targetShape] = match.frame.data;
  report.visemeSamples[targetShape] = {
    screenshot,
    captureMode: "non-blocking-natural-screencast-state-marker",
    markerRgb: match.markerRgb,
    matchingFrames: matchingFrames.length,
    naturalWindowSamples: naturalWindow.length,
    naturalWindowDurationMs: naturalWindow.length > 1 ? Number((naturalWindow.at(-1) - naturalWindow[0]).toFixed(3)) : 0,
  };
}
await evaluate(`window.__XIAOAN_VISEME_MARKER_CLEANUP__?.(); true`);
for (const required of ["CLOSED", "A", "E", "O", "U"]) {
  if (!report.visemeSamples[required]?.screenshot) report.failures.push(`natural-viseme-missing:${required}`);
}
report.mouthGridEdges = {};
if (selectedMouthFrameData.CLOSED) {
  for (const shape of ["A", "E", "O", "U"]) {
    if (selectedMouthFrameData[shape]) report.mouthGridEdges[shape] = await measureMouthGridEdges(selectedMouthFrameData.CLOSED, selectedMouthFrameData[shape], regions.mouth, 2);
  }
}
const leftGridEdgeMaximum = Math.max(0, ...Object.values(report.mouthGridEdges).map((sample) => sample.left));
const rightGridEdgeMaximum = Math.max(0, ...Object.values(report.mouthGridEdges).map((sample) => sample.right));
report.mouthGridEdgeMaximums = { left: leftGridEdgeMaximum, right: rightGridEdgeMaximum };
if (leftGridEdgeMaximum > .34) report.failures.push(`mouth-left-grid-edge:${leftGridEdgeMaximum.toFixed(3)}`);
if (rightGridEdgeMaximum > .16) report.failures.push(`mouth-right-grid-edge:${rightGridEdgeMaximum.toFixed(3)}`);
report.observedVisemes = [...new Set([...report.observedVisemes, ...Object.keys(report.visemeSamples).filter((shape) => ["CLOSED", "A", "E", "O", "U"].includes(shape))])];
if (await evaluate(`Boolean(document.querySelector('#voice-settings-dialog'))`)) {
  await clickSelector("#voice-settings-dialog .primary-action");
  await wait(200);
}

await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
await wait(1200);
async function captureNaturalExpression(expression, text) {
  await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(text)}); true`);
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    const state = await evaluate(`(() => {
      const avatar = document.querySelector('.digital-human');
      const frames = [...document.querySelectorAll('.digital-human__expression-frame')]
        .filter((frame) => Number(getComputedStyle(frame).opacity) > .35 && getComputedStyle(frame).visibility !== 'hidden')
        .map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility }));
      return { expression: avatar?.dataset.expression || '', frames };
    })()`);
    if (state.expression === expression && state.frames.length === 1 && state.frames[0].className.includes(`--${expression}`)) {
      report.expressionSamples[expression] = { screenshot: await capture(`expression-${expression}.png`, regions.eyes, 2), activeFrames: state.frames, captureMode: "natural-tts-stable-expression" };
      await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
      await wait(240);
      return true;
    }
    await wait(12);
  }
  await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
  await wait(240);
  return false;
}
await captureNaturalExpression("concern", "头痛如果突然很严重，请及时就医。" );
await captureNaturalExpression("encourage", "您可以先记录，我们一起慢慢改善。" );
for (const expression of ["concern", "encourage"]) {
  if (!report.expressionSamples[expression]?.screenshot) report.failures.push(`natural-expression-missing:${expression}`);
}
// Blink acceptance is an isolated natural cycle. Wait until the preceding
// semantic-expression crossfade has fully returned to neutral so two distinct
// tests cannot be mistaken for an eye-layer overlap.
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
await wait(1200);

let cycleSawClosed = false;
let previousBlinkPhase = "";
let completedBlinkCycles = 0;
const naturalBlinkTimes = { entry: [], closed: [], exit: [] };
let blinkOverlapSamples = 0;
let blinkFrameMismatchSamples = 0;
let blinkHiddenSamples = 0;
await evaluate(`(() => {
  window.__XIAOAN_BLINK_MARKER_CLEANUP__?.();
  const avatar = document.querySelector('.digital-human');
  const marker = document.createElement('span');
  marker.id = 'xiaoan-natural-blink-marker';
  Object.assign(marker.style, { position: 'fixed', left: '0', top: '0', width: '12px', height: '12px', zIndex: '2147483647', pointerEvents: 'none', background: '#000' });
  document.body.append(marker);
  let sawClosed = false;
  let previousPhase = '';
  const update = () => {
    const phase = avatar?.dataset.blinkPhase || '';
    if (!phase && previousPhase) sawClosed = false;
    if (phase === 'closed') sawClosed = true;
    const naturalPhase = phase === 'closed' ? 'closed' : phase === 'half' ? (sawClosed ? 'exit' : 'entry') : '';
    marker.style.background = naturalPhase === 'entry' ? '#ff0000' : naturalPhase === 'closed' ? '#00ff00' : naturalPhase === 'exit' ? '#0000ff' : '#000000';
    previousPhase = phase;
  };
  const observer = new MutationObserver(update);
  observer.observe(avatar, { attributes: true, attributeFilter: ['data-blink-phase'] });
  update();
  window.__XIAOAN_BLINK_MARKER_CLEANUP__ = () => { observer.disconnect(); marker.remove(); delete window.__XIAOAN_BLINK_MARKER_CLEANUP__; };
  return true;
})()`);
screencastFrames.length = 0;
await send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
const blinkDeadline = performance.now() + 25_000;
while (performance.now() < blinkDeadline) {
  const state = await evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    const progress = Number(getComputedStyle(avatar).getPropertyValue('--blink-progress')) || 0;
      const blinkFrames = [...document.querySelectorAll('.digital-human__blink-frame')].map((frame) => { const style = getComputedStyle(frame); return { className: frame.className, opacity: Number(style.opacity), display: style.display, visibility: style.visibility }; });
      const expressionFrames = [...document.querySelectorAll('.digital-human__expression-frame')].map((frame) => ({ className: frame.className, opacity: Number(getComputedStyle(frame).opacity), visibility: getComputedStyle(frame).visibility }));
    return { progress, phase: avatar?.dataset.blinkPhase || '', expression: avatar?.dataset.expression || '', semanticExpression: avatar?.dataset.semanticExpression || 'neutral', capturedAtEpochMs: Date.now(), blinkFrames, expressionFrames };
  })()`);
  if (!state.phase && previousBlinkPhase) {
    completedBlinkCycles += 1;
    if (completedBlinkCycles >= 2 && Object.values(naturalBlinkTimes).every((times) => times.length > 0)) break;
    cycleSawClosed = false;
  }
  let phase = "";
  if (state.phase === "closed") { phase = "closed"; cycleSawClosed = true; }
  else if (state.phase === "half") phase = cycleSawClosed ? "exit" : "entry";
  if (phase) naturalBlinkTimes[phase].push(state.capturedAtEpochMs);
  if (state.expression === "blink") {
    const activeBlinkFrames = state.blinkFrames.filter((frame) => frame.opacity > .5 && frame.display !== "none" && frame.visibility !== "hidden");
    if (state.blinkFrames.some((frame) => frame.opacity > .5 && (frame.display === "none" || frame.visibility === "hidden"))) blinkHiddenSamples += 1;
    const visibleExpressionFrames = state.expressionFrames.filter((frame) => frame.visibility !== "hidden" && frame.opacity > 0.02);
    const expectsSemanticFrame = ["smile", "concern", "encourage", "listening"].includes(state.semanticExpression);
    const semanticFrameMatches = !expectsSemanticFrame || (visibleExpressionFrames.length === 1 && visibleExpressionFrames[0].className.includes(`--${state.semanticExpression}`));
    if (activeBlinkFrames.length !== 2 || visibleExpressionFrames.length !== (expectsSemanticFrame ? 1 : 0) || !semanticFrameMatches) blinkOverlapSamples += 1;
    if (activeBlinkFrames.some((frame) => !frame.className.includes(`--${state.phase}`))) blinkFrameMismatchSamples += 1;
  }
  previousBlinkPhase = state.phase;
  await wait(8);
}
await send("Page.stopScreencast");
await wait(80);
const allBlinkTimes = Object.values(naturalBlinkTimes).flat();
const markerCandidates = screencastFrames.filter((frame) => Number.isFinite(frame.capturedAtEpochMs)
  && allBlinkTimes.some((time) => Math.abs(frame.capturedAtEpochMs - time) <= 180));
const markedBlinkFrames = [];
for (const frame of markerCandidates) {
  const markerRgb = await readScreencastMarker(frame.data);
  const phase = blinkPhaseFromMarker(markerRgb);
  if (phase) markedBlinkFrames.push({ frame, phase, markerRgb });
}
for (const phase of ["entry", "closed", "exit"]) {
  const naturalWindow = longestNaturalWindow(naturalBlinkTimes[phase]);
  const matchingFrames = markedBlinkFrames.filter((item) => item.phase === phase);
  const match = matchingFrames[Math.floor(matchingFrames.length / 2)];
  if (!match) continue;
  report.blinkSamples[phase] = {
    screenshot: await cropScreencastFrame(`blink-${phase}.png`, match.frame.data, regions.eyes, 2),
    headScreenshot: await cropScreencastFrame(`blink-${phase}-head.png`, match.frame.data, regions.head, 2),
    captureMode: "non-blocking-natural-screencast-state-marker",
    markerRgb: match.markerRgb,
    matchingFrames: matchingFrames.length,
    naturalWindowSamples: naturalWindow.length,
    naturalWindowDurationMs: naturalWindow.length > 1 ? Number((naturalWindow.at(-1) - naturalWindow[0]).toFixed(3)) : 0,
  };
}
await evaluate(`window.__XIAOAN_BLINK_MARKER_CLEANUP__?.(); true`);
report.blink = { overlapSamples: blinkOverlapSamples, frameMismatchSamples: blinkFrameMismatchSamples, hiddenSamples: blinkHiddenSamples };
if (blinkOverlapSamples) report.failures.push(`blink-layer-overlap:${blinkOverlapSamples}`);
if (blinkHiddenSamples) report.failures.push(`blink-hidden:${blinkHiddenSamples}`);
if (blinkFrameMismatchSamples) report.failures.push(`blink-frame-mismatch:${blinkFrameMismatchSamples}`);
for (const phase of ["entry", "closed", "exit"]) if (!report.blinkSamples[phase]) report.failures.push(`natural-blink-${phase}-missing`);

report.result = report.failures.length ? "FAIL" : "PASS";
const reportPath = path.join(outputDir, "report.json");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, result: report.result, failures: report.failures, observedVisemes: report.observedVisemes, expressionSamples: Object.keys(report.expressionSamples), blinkSamples: Object.keys(report.blinkSamples) }, null, 2));
socket.close();
if (report.failures.length) process.exitCode = 1;
