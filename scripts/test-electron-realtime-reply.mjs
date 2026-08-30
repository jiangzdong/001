import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9228";
const screenshotPath = path.resolve(process.env.XIAOAN_REALTIME_SCREENSHOT || "qa-v1.4.10-realtime-gpu-handoff.png");
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
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  let result;
  try {
    result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  } catch (error) {
    throw new Error(`${error.message}; expression=${expression.slice(0, 120)}`);
  }
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const waitFor = async (probe, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(probe);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`${label} 超时`);
};
const clickVoiceControl = async () => {
  const point = await evaluate(`(() => {
    const button = document.querySelector('.screen-talk .voice-control');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error("对话页语音按钮不存在");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
};

await send("Runtime.enable");
await send("Page.enable");
await waitFor("document.readyState === 'complete'", 10_000, "页面加载");
const alreadyTalking = await evaluate(`document.querySelector('.kiosk-shell')?.classList.contains('screen-talk') || false`);
if (!alreadyTalking) {
  for (let index = 0; index < 5; index += 1) {
    if (await evaluate(`Boolean(document.querySelector('.welcome-voice'))`)) break;
    const point = await evaluate(`(() => {
      const button = document.querySelector('.topbar-home, button[aria-label="返回"]') || [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '返回');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (!point) break;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  await waitFor("Boolean(document.querySelector('.welcome-voice'))", 10_000, "返回首页");
  await evaluate(`(() => { document.querySelector('.welcome-voice').click(); return true; })()`);
}
await waitFor("document.querySelector('.kiosk-shell')?.classList.contains('screen-talk')", 10_000, "进入对话页");
await new Promise((resolve) => setTimeout(resolve, 500));
await waitFor("!document.querySelector('.digital-human')?.classList.contains('is-speaking') && !document.querySelector('.speaking-indicator.is-preparing')", 30_000, "欢迎播报结束");
await waitFor("Boolean(document.querySelector('.screen-talk .prompt-row button, .screen-talk .symptom-choice-grid button'))", 10_000, "对话选项出现");
const requestedAt = Date.now();
await evaluate(`(() => {
  const choices = [...document.querySelectorAll('.screen-talk .prompt-row button, .screen-talk .symptom-choice-grid button')];
  const button = choices.find((item) => item.textContent.includes('我最近有点头痛'))
    || choices.find((item) => item.textContent.includes('明显影响'))
    || choices[0];
  if (!button) throw new Error('对话选项不存在');
  button.click();
  return true;
})()`);

let speakingAt = null;
let frameAt = null;
let completedAt = null;
let screenshotSaved = false;
let state = null;
let mouthOpenMax = 0;
let speakingSamples = 0;
const observedVisemes = new Set();
let lastViseme = "";
let visemeTransitions = 0;
let lastExpression = "";
let expressionTransitions = 0;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  state = await evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    const canvas = document.querySelector('.digital-human__frame');
    return {
      speaking: avatar?.classList.contains('is-speaking') || false,
      frameReady: avatar?.classList.contains('has-ready-video') || false,
      canvas: canvas ? { width: canvas.width, height: canvas.height, objectFit: getComputedStyle(canvas).objectFit } : null,
      assistant: [...document.querySelectorAll('.message--assistant p')].map((item) => item.textContent.trim()).filter(Boolean).at(-1) || '',
      preparing: Boolean(document.querySelector('.speaking-indicator.is-preparing')),
      mouthOpen: Number.parseFloat(avatar?.style.getPropertyValue('--mouth-open') || '0') || 0,
      viseme: avatar?.dataset.viseme || '',
      avatarState: avatar?.dataset.avatarState || '',
      expression: avatar?.dataset.expression || '',
    };
  })()`);
  const now = Date.now();
  if (state.speaking && state.assistant) {
    speakingSamples += 1;
    mouthOpenMax = Math.max(mouthOpenMax, state.mouthOpen);
    if (state.viseme) observedVisemes.add(state.viseme);
    if (lastViseme && state.viseme && state.viseme !== lastViseme) visemeTransitions += 1;
    if (state.viseme) lastViseme = state.viseme;
    if (lastExpression && state.expression && state.expression !== lastExpression) expressionTransitions += 1;
    if (state.expression) lastExpression = state.expression;
    if (speakingAt == null) speakingAt = now;
  }
  if (state.frameReady && frameAt == null) frameAt = now;
  if (state.speaking && state.mouthOpen > 0.25 && state.viseme && state.viseme !== 'CLOSED' && !screenshotSaved) {
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    screenshotSaved = true;
  }
  if (speakingAt && !state.speaking && !state.preparing) {
    completedAt = now;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 40));
}

if (speakingAt == null || completedAt == null || !state?.assistant) throw new Error(`实时回答未完成: ${JSON.stringify(state)}`);
if (await evaluate(`document.querySelector('.screen-talk .voice-control')?.classList.contains('is-listening') || false`)) {
  await clickVoiceControl();
  await waitFor("!document.querySelector('.screen-talk .voice-control')?.classList.contains('is-listening')", 3_000, "停止自动聆听");
}
await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference('这是一段用于验证点击打断的较长自然播报。小安会继续说明健康记录、规律作息和适量活动的重要性。'); true`);
await waitFor("document.querySelector('.digital-human')?.classList.contains('is-speaking')", 15_000, "打断测试播报开始");
const interruptRequestedAt = Date.now();
await clickVoiceControl();
await waitFor("!document.querySelector('.digital-human')?.classList.contains('is-speaking')", 3_000, "点击打断停止播报");
const interruptStopLatencyMs = Date.now() - interruptRequestedAt;
await new Promise((resolve) => setTimeout(resolve, 180));
const listeningStartedAfterInterrupt = await evaluate(`document.querySelector('.screen-talk .voice-control')?.classList.contains('is-listening') || false`);
if (listeningStartedAfterInterrupt) await clickVoiceControl();
const result = {
  ok: true,
  clickToSpeechMs: speakingAt - requestedAt,
  speechDurationMs: completedAt - speakingAt,
  speakingSamples,
  mouthOpenMax,
  observedVisemes: [...observedVisemes],
  visemeTransitions,
  visemeTransitionsPerSecond: +(visemeTransitions / Math.max(0.001, (completedAt - speakingAt) / 1000)).toFixed(2),
  expressionTransitions,
  gpuFrameAfterSpeechStartMs: frameAt == null ? null : frameAt - speakingAt,
  screenshot: screenshotSaved ? screenshotPath : null,
  interruption: { stopLatencyMs: interruptStopLatencyMs, listeningStarted: listeningStartedAfterInterrupt },
  finalState: state,
};
console.log(JSON.stringify(result, null, 2));
socket.close();
