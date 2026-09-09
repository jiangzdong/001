import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv.find((item) => item.startsWith("--port="))?.split("=")[1] || 9361);
const outputDirectory = path.resolve(process.argv.find((item) => item.startsWith("--out="))?.slice(6) || "QA-EXTERNAL/dual-speech-engine-ui-current");
const leaveQwen = process.argv.includes("--leave-qwen");
const expectQwenUnavailable = process.argv.includes("--expect-qwen-unavailable");
const packaged = process.argv.includes("--packaged");
const settingsOnly = process.argv.includes("--settings-only");
await fs.mkdir(outputDirectory, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targets = () => fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "renderer exception");
    } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      errors.push((message.params.args || []).map((item) => item.value || item.description || "").join(" "));
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
    return result.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { socket, send, evaluate, errors };
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const value = await fn(); if (value) return value; } catch { /* bounded retry */ }
    await delay(200);
  }
  throw new Error(`等待${label}超时`);
}

async function capture(client, name, width = 1440, height = 1024) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const filename = path.join(outputDirectory, name);
  await fs.writeFile(filename, Buffer.from(result.data, "base64"));
  return filename;
}

const target = (await targets()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!target) throw new Error("没有找到当前源码 App 页面");
const client = await connect(target);
await waitFor(() => client.evaluate("document.readyState === 'complete' && Boolean(window.kioskBridge)"), 30_000, "App 首屏");
await client.evaluate("document.querySelector('[aria-label=\"打开终端设置\"]')?.click(); true");
await waitFor(() => client.evaluate("Boolean(document.querySelector('[data-testid=advisor-open-speech-engine]'))"), 10_000, "终端设置");
await client.evaluate("document.querySelector('[data-testid=advisor-open-speech-engine]').click(); true");
await waitFor(() => client.evaluate("Boolean(document.querySelector('.advisor-speech-engine-dialog'))"), 10_000, "回答语音设置");
if (!expectQwenUnavailable) {
  await waitFor(() => client.evaluate("document.querySelector('.advisor-speech-engine-options')?.getAttribute('aria-busy') === 'false' && !document.querySelector('[data-testid=advisor-speech-engine-qwen3-tts]')?.disabled"), 180_000, "回答语音状态刷新");
}

const initial = await client.evaluate(`(() => ({
  status: document.querySelector('.advisor-speech-engine-current')?.innerText.replace(/\\s+/g, ' ').trim(),
  vitsChecked: document.querySelector('[data-testid=advisor-speech-engine-vits]')?.checked,
  qwenChecked: document.querySelector('[data-testid=advisor-speech-engine-qwen3-tts]')?.checked,
  qwenDisabled: document.querySelector('[data-testid=advisor-speech-engine-qwen3-tts]')?.disabled,
  controlsBelow44: [...document.querySelectorAll('.advisor-speech-engine-dialog button,.advisor-speech-engine-dialog label')].filter((item) => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.height < 44; }).map((item) => ({ className: item.className, text: item.innerText?.trim(), width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })),
  overflow: document.querySelector('.advisor-speech-engine-dialog').scrollWidth > document.querySelector('.advisor-speech-engine-dialog').clientWidth,
}))()`);
const initialBackendStatus = await client.evaluate("window.kioskBridge.speechEngineStatus()");
const initialScreenshot = await capture(client, "01-answer-voice-settings.png");

async function selectSaveAndPlay(engine, text, { skipSave = false } = {}) {
  if (!skipSave) {
    await client.evaluate(`document.querySelector('[data-testid=advisor-speech-engine-${engine}]').click(); document.querySelector('[data-testid=advisor-speech-engine-save]').click(); true`);
    await waitFor(() => client.evaluate(`document.querySelector('.advisor-pin-message')?.innerText.includes('已切换到')`), engine === "qwen3-tts" ? 180_000 : 20_000, `${engine} 保存`);
  }
  if (settingsOnly) {
    const state = await client.evaluate("window.kioskBridge.speechEngineStatus()");
    return { requested: state?.requested, used: state?.used, degraded: Boolean(state?.degraded), fallbackReason: state?.fallbackReason || null, settingsOnly: true };
  }
  return client.evaluate(`(async () => {
    const result = await window.kioskBridge.synthesizeSpeech(${JSON.stringify(text)}, { turnId: ${JSON.stringify(`qa-${engine}`)}, strictEngine: true });
    const raw = result?.samples;
    const samples = raw instanceof Float32Array ? raw : new Float32Array(Object.values(raw || {}));
    const context = new AudioContext({ sampleRate: Number(result?.sampleRate) || 24000 });
    const buffer = context.createBuffer(1, samples.length, Number(result?.sampleRate) || 24000);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    const played = new Promise((resolve) => { source.onended = resolve; });
    source.start(); await played; await context.close();
    return { requested: result?.engineRequested, used: result?.engineUsed, degraded: Boolean(result?.degraded), fallbackReason: result?.fallbackReason || null, samples: samples.length, sampleRate: result?.sampleRate, played: true };
  })()`);
}

let qwenFailure = null;
if (expectQwenUnavailable) {
  await client.evaluate("document.querySelector('[data-testid=advisor-speech-engine-qwen3-tts]').click(); document.querySelector('[data-testid=advisor-speech-engine-save]').click(); true");
  await waitFor(() => client.evaluate("Boolean(document.querySelector('.advisor-pin-message.is-error'))"), 180_000, "Qwen 缺失资源提示");
  qwenFailure = await client.evaluate("document.querySelector('.advisor-pin-message.is-error')?.innerText.trim()");
}
const restoredQwen = initial.qwenChecked && initialBackendStatus?.requested === "qwen3-tts" && initialBackendStatus?.used === "qwen3-tts" && initialBackendStatus?.qwen?.trust === "release-signed";
const qwen = expectQwenUnavailable ? null : await selectSaveAndPlay("qwen3-tts", "您好，我是小安。现在使用高质量语音回答。", { skipSave: restoredQwen });
const qwenScreenshot = await capture(client, expectQwenUnavailable ? "02-qwen-unavailable.png" : "02-qwen-selected.png");
const vits = await selectSaveAndPlay("vits", "您好，我是小安。现在使用轻量语音回答。");
const vitsScreenshot = await capture(client, "03-vits-restored.png");
if (leaveQwen && !expectQwenUnavailable) {
  await client.evaluate("document.querySelector('[data-testid=advisor-speech-engine-qwen3-tts]').click(); document.querySelector('[data-testid=advisor-speech-engine-save]').click(); true");
  await waitFor(() => client.evaluate("document.querySelector('.advisor-pin-message')?.innerText.includes('已切换到')"), 180_000, "Qwen 最终保存");
}
const finalStatus = await client.evaluate("window.kioskBridge.speechEngineStatus()");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: packaged ? "packaged Electron GUI, release-signed external Qwen resource, actual speaker playback" : "source Electron GUI, explicit untrusted development Qwen resource, actual speaker playback",
  initial,
  initialBackendStatus,
  restoredQwen,
  qwen,
  qwenFailure,
  vits,
  finalStatus,
  consoleErrors: client.errors,
  screenshots: { initialScreenshot, qwenScreenshot, vitsScreenshot },
};
const qwenPassed = expectQwenUnavailable ? Boolean(qwenFailure) && finalStatus.requested === "vits" : !initial.qwenDisabled && qwen.requested === "qwen3-tts" && qwen.used === "qwen3-tts" && !qwen.degraded && (settingsOnly || (qwen.samples > 0 && qwen.played));
report.result = initial.controlsBelow44.length === 0 && !initial.overflow && qwenPassed
  && vits.requested === "vits" && vits.used === "vits" && !vits.degraded && (settingsOnly || (vits.samples > 0 && vits.played))
  && finalStatus.requested === (leaveQwen ? "qwen3-tts" : "vits") && finalStatus.used === (leaveQwen ? "qwen3-tts" : "vits") && client.errors.length === 0 ? "PASS" : "FAIL";
await fs.writeFile(path.join(outputDirectory, "dual-speech-engine-ui-report.json"), `${JSON.stringify(report, null, 2)}\n`);
client.socket.close();
process.stdout.write(`${JSON.stringify({ result: report.result, qwen, vits, outputDirectory })}\n`);
if (report.result !== "PASS") process.exitCode = 1;
