import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9223";
const outputPath = path.resolve(process.env.XIAOAN_ELECTRON_FRAME_SCREENSHOT || "ditto-validation/electron-frame-display.png");

const targets = await fetch(`${cdpUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && /小安数字健康管理师/.test(item.title));
if (!target?.webSocketDebuggerUrl) throw new Error("没有找到小安 Electron CDP 页面");

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

function send(method, params = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }, 600_000);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Electron 页面执行失败");
  return result.result?.value;
}

await send("Runtime.enable");
await send("Page.enable");

await evaluate(`(() => {
  const canvas = document.querySelector('canvas.digital-human__frame');
  if (!canvas || !window.kioskBridge?.streamAvatar) throw new Error('正式 Canvas 或 kioskBridge 不可用');
  window.__xiaoanFrameProbe = { phase: 'rendering', frameCount: 0, audioSamples: 0, sampleRate: 0, error: '' };
  const frames = [];
  let audio = null;
  const draw = async (event) => {
    const bytes = event.bytes instanceof Uint8Array ? event.bytes : new Uint8Array(event.bytes);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    document.querySelector('.digital-human')?.classList.add('has-ready-video');
  };
  window.kioskBridge.streamAvatar('您好', { speed: 1, voiceId: 'zh-ll-2', turnId: 'electron-frame-probe' }, (event) => {
    if (event?.type === 'audio') {
      audio = event;
      window.__xiaoanFrameProbe.audioSamples = event.samples?.length || 0;
      window.__xiaoanFrameProbe.sampleRate = event.sampleRate || 0;
    }
    if (event?.type === 'frame' && event.bytes?.length) {
      frames.push(event);
      window.__xiaoanFrameProbe.frameCount = frames.length;
    }
  }).then(async (result) => {
    if (!result?.ok || !audio || !frames.length) throw new Error(result?.message || '帧流未返回音频或帧');
    window.__xiaoanFrameProbe.phase = 'playing';
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    if (context.state === 'suspended') await context.resume();
    const samples = audio.samples instanceof Float32Array ? audio.samples : new Float32Array(audio.samples);
    const buffer = context.createBuffer(1, samples.length, audio.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const audioEnded = new Promise((resolve) => { source.onended = resolve; });
    source.start();
    for (const frame of frames) {
      await draw(frame);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await audioEnded;
    window.__xiaoanFrameProbe.phase = 'complete';
    window.__xiaoanFrameProbe.canvasWidth = canvas.width;
    window.__xiaoanFrameProbe.canvasHeight = canvas.height;
    window.__xiaoanFrameProbe.canvasDataLength = canvas.toDataURL('image/jpeg', 0.8).length;
    await context.close();
  }).catch((error) => {
    window.__xiaoanFrameProbe.phase = 'error';
    window.__xiaoanFrameProbe.error = error?.stack || String(error);
  });
  return true;
})()`);

const deadline = Date.now() + 240_000;
let captured = false;
let probe;
while (Date.now() < deadline) {
  probe = await evaluate("window.__xiaoanFrameProbe");
  if (!captured && probe?.phase === "playing" && probe.frameCount > 0) {
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 30_000);
    await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
    captured = true;
  }
  if (probe?.phase === "complete" || probe?.phase === "error") break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!probe || probe.phase !== "complete") throw new Error(probe?.error || `Electron 帧展示未完成: ${JSON.stringify(probe)}`);
if (!captured || probe.frameCount < 2 || !probe.audioSamples || !probe.canvasDataLength) {
  throw new Error(`Electron 帧展示证据不完整: ${JSON.stringify(probe)}`);
}

console.log(JSON.stringify({ ok: true, screenshot: outputPath, ...probe }, null, 2));
socket.close();
