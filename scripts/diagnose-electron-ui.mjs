import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9223";
const targets = await fetch(`${cdpUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("Electron page target not found");

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
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

await send("Runtime.enable");
const report = await evaluate(`(async () => {
  const describe = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      className: String(element.className || ''),
      text: String(element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 100),
      disabled: Boolean(element.disabled),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      display: style.display,
      zIndex: style.zIndex,
    };
  };
  const buttons = [...document.querySelectorAll('button')].map(describe);
  const shell = document.querySelector('.kiosk-shell');
  const expression = document.querySelector('.digital-human__blink-frame');
  const assessment = document.querySelector('.welcome-assessment');
  const assessmentRect = assessment?.getBoundingClientRect();
  const forehead = document.querySelector('.forehead-admin-trigger');
  const foreheadRect = forehead?.getBoundingClientRect();
  const foreheadHit = foreheadRect ? document.elementFromPoint(foreheadRect.x + foreheadRect.width / 2, foreheadRect.y + foreheadRect.height / 2) : null;
  const hit = assessmentRect
    ? document.elementFromPoint(assessmentRect.x + assessmentRect.width / 2, assessmentRect.y + assessmentRect.height / 2)
    : null;
  const speech = await window.kioskBridge?.speechStatus?.().catch((error) => ({ error: String(error) }));
  const runtime = await window.kioskBridge?.runtimeStatus?.().catch((error) => ({ error: String(error) }));
  const audioOutputs = navigator.mediaDevices?.enumerateDevices
    ? (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput').map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }))
    : [];
  return {
    title: document.title,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    hasBridge: Boolean(window.kioskBridge),
    bridgeKeys: Object.keys(window.kioskBridge || {}),
    speech,
    audioOutputs,
    runtime,
    shell: describe(shell),
    expression: expression ? {
      avatarDataset: { ...document.querySelector('.digital-human')?.dataset },
      top: getComputedStyle(expression).top,
      left: getComputedStyle(expression).left,
      opacity: getComputedStyle(expression).opacity,
      blinkProgress: getComputedStyle(document.querySelector('.digital-human')).getPropertyValue('--blink-progress').trim(),
    } : null,
    body: describe(document.body),
    assessment: describe(assessment),
    forehead: describe(forehead),
    hitAtForeheadCenter: describe(foreheadHit),
    hitAtAssessmentCenter: describe(hit),
    buttons,
    activeElement: describe(document.activeElement),
  };
})()`);
if (process.argv.includes("--probe-blink")) {
  report.blinkProbe = await evaluate(`(async () => {
    const avatar = document.querySelector('.digital-human');
    const sprite = document.querySelector('.digital-human__blink-frame');
    const deadline = performance.now() + 8500;
    let maximum = 0;
    let activeSamples = 0;
    const positions = new Set();
    const activeFrameOpacities = new Set();
    while (performance.now() < deadline) {
      const style = getComputedStyle(avatar);
      const amount = Number(style.getPropertyValue('--blink-progress')) || 0;
      maximum = Math.max(maximum, amount);
      if (amount > 0.01) {
        activeSamples += 1;
        activeFrameOpacities.add(sprite ? getComputedStyle(sprite).opacity : 'missing');
      }
      positions.add(sprite ? getComputedStyle(sprite).top : 'missing');
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return { maximum, activeSamples, positions: [...positions], activeFrameOpacities: [...activeFrameOpacities] };
  })()`);
}
if (process.argv.includes("--capture-blink")) {
  const outputPath = path.resolve("qa-v1.4.5-blink-replacement.png");
  await send("Page.enable");
  const deadline = performance.now() + 9000;
  while (performance.now() < deadline) {
    const blinkState = await evaluate(`(() => {
      const avatar = document.querySelector('.digital-human');
      const frames = [...document.querySelectorAll('.digital-human__blink-frame')];
      return {
        expression: avatar?.dataset.expression || '',
        progress: Number(getComputedStyle(avatar).getPropertyValue('--blink-progress')) || 0,
        frameOpacity: frames.map((frame) => Number(getComputedStyle(frame).opacity)),
      };
    })()`);
    if (blinkState.expression === 'blink' && blinkState.progress > .05 && blinkState.frameOpacity.every((opacity) => opacity === 1)) {
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
      report.blinkLayers = blinkState;
      report.blinkScreenshot = outputPath;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  if (!report.blinkScreenshot) report.blinkScreenshot = { captured: false };
}
if (process.argv.includes("--capture-visemes")) {
  await send("Page.enable");
  const restore = await evaluate(`(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('.topbar-home')?.click();
    await delay(120);
    for (let step = 0; step < 10 && !document.querySelector('.welcome-voice'); step += 1) {
      const back = document.querySelector('button[aria-label="返回"]') || [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '返回');
      if (!back) break;
      back.click();
      await delay(80);
    }
    const avatar = document.querySelector('.digital-human');
    const frames = [...document.querySelectorAll('.digital-human__mouth-frame')];
    if (!avatar) throw new Error('数字人不存在');
    if (frames.length !== 2) throw new Error('嘴型整帧不完整');
    const state = { avatarState: avatar.dataset.avatarState || '', viseme: avatar.dataset.viseme || '', style: avatar.getAttribute('style') || '', frameStyles: frames.map((frame) => frame.getAttribute('style') || '') };
    avatar.dataset.avatarState = 'speaking';
    frames.forEach((frame) => { frame.style.visibility = 'visible'; frame.style.transition = 'none'; });
    return state;
  })()`);
  report.visemeScreenshots = {};
  report.visemeComputed = {};
  const mouthRect = await evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    const rect = avatar.getBoundingClientRect();
    avatar.dataset.viseme = 'CLOSED';
    return { x: rect.x + rect.width * .405, y: rect.y + rect.width * .455, width: rect.width * .19, height: rect.width * .105 };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const baseCloseupPath = path.resolve("qa-v1.4.5-viseme-base-closeup.png");
  const baseCloseup = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...mouthRect, scale: 2 } });
  await fs.writeFile(baseCloseupPath, Buffer.from(baseCloseup.data, "base64"));
  report.visemeScreenshots.BASE_CLOSEUP = baseCloseupPath;
  for (const viseme of ['CLOSED', 'A', 'O']) {
    await evaluate(`(() => {
      const avatar = document.querySelector('.digital-human');
      const frameA = document.querySelector('.digital-human__mouth-frame--a');
      const frameO = document.querySelector('.digital-human__mouth-frame--o');
      avatar.dataset.viseme = ${JSON.stringify(viseme)};
      frameA.style.opacity = ${JSON.stringify(viseme)} === 'A' ? '1' : '0';
      frameO.style.opacity = ${JSON.stringify(viseme)} === 'O' ? '1' : '0';
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    report.visemeComputed[viseme] = await evaluate(`(() => {
      return [...document.querySelectorAll('.digital-human__mouth-frame')].map((frame) => {
        const style = getComputedStyle(frame);
        return { className: frame.className, opacity: style.opacity, visibility: style.visibility, objectPosition: style.objectPosition, maskImage: style.maskImage, rect: frame.getBoundingClientRect().toJSON() };
      });
    })()`);
    const outputPath = path.resolve(`qa-v1.4.5-viseme-${viseme.toLowerCase()}.png`);
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
    report.visemeScreenshots[viseme] = outputPath;
    const closeupPath = path.resolve(`qa-v1.4.5-viseme-${viseme.toLowerCase()}-closeup.png`);
    const closeup = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...mouthRect, scale: 2 } });
    await fs.writeFile(closeupPath, Buffer.from(closeup.data, "base64"));
    report.visemeScreenshots[`${viseme}_CLOSEUP`] = closeupPath;
  }
  await evaluate(`(() => {
    const avatar = document.querySelector('.digital-human');
    const frames = [...document.querySelectorAll('.digital-human__mouth-frame')];
    avatar.setAttribute('style', ${JSON.stringify(restore.style)});
    frames.forEach((frame, index) => frame.setAttribute('style', ${JSON.stringify(restore.frameStyles)}[index] || ''));
    if (${JSON.stringify(restore.avatarState)}) avatar.dataset.avatarState = ${JSON.stringify(restore.avatarState)}; else delete avatar.dataset.avatarState;
    if (${JSON.stringify(restore.viseme)}) avatar.dataset.viseme = ${JSON.stringify(restore.viseme)}; else delete avatar.dataset.viseme;
    return true;
  })()`);
}
if (process.argv.includes("--capture-assessment-avatar")) {
  await send("Page.enable");
  report.assessmentAvatar = await evaluate(`(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('.topbar-home')?.click();
    await delay(120);
    for (let step = 0; step < 10 && !document.querySelector('.welcome-assessment'); step += 1) {
      const back = document.querySelector('button[aria-label="返回"]');
      if (!back) break;
      back.click();
      await delay(80);
    }
    const button = document.querySelector('.welcome-assessment');
    if (!button) throw new Error('首页测评按钮不存在');
    button.click();
    const deadline = performance.now() + 3000;
    while (!document.querySelector('.screen-assessment') && performance.now() < deadline) await delay(40);
    await delay(350);
    const avatar = document.querySelector('.digital-human');
    const portrait = document.querySelector('.digital-human__image');
    return {
      screen: document.querySelector('.kiosk-shell')?.className || '',
      avatarClass: avatar?.className || '',
      portraitVisibility: portrait ? getComputedStyle(portrait).visibility : 'missing',
      portraitOpacity: portrait ? getComputedStyle(portrait).opacity : 'missing',
      portraitRect: portrait ? portrait.getBoundingClientRect().toJSON() : null,
    };
  })()`);
  const outputPath = path.resolve("qa-v1.4.5-assessment-avatar.png");
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  report.assessmentAvatar.screenshot = outputPath;
}
if (process.argv.includes("--capture-mouth") || process.argv.includes("--capture-talk-mouth")) {
  const captureTalkMouth = process.argv.includes("--capture-talk-mouth");
  const outputPath = path.resolve(captureTalkMouth ? "qa-v1.4.5-talk-welcome-mouth.png" : "qa-v1.4.5-mouth-open.png");
  await send("Page.enable");
  await evaluate(`(async () => {
    const waitFor = async (selector, timeoutMs = 5000) => {
      const deadline = performance.now() + timeoutMs;
      while (!document.querySelector(selector) && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return document.querySelector(selector);
    };
    if (${captureTalkMouth}) {
      const existingPrompt = document.querySelector('.screen-talk .prompt-row button');
      if (existingPrompt) {
        existingPrompt.click();
        return true;
      }
      if (!document.querySelector('.welcome-voice')) {
        document.querySelector('.topbar-home')?.click();
        for (let step = 0; step < 10 && !document.querySelector('.welcome-voice'); step += 1) {
          const back = document.querySelector('button[aria-label="返回"]') || [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '返回');
          if (!back) break;
          back.click();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        await waitFor('.welcome-voice', 3000);
      }
      const talkButton = document.querySelector('.welcome-voice');
      if (!talkButton) throw new Error('首页对话按钮不存在');
      talkButton.click();
      return true;
    }
    if (!document.querySelector('.answer-grid button')) {
      if (!document.querySelector('.welcome-assessment')) {
        document.querySelector('.topbar-home')?.click();
        await waitFor('.welcome-assessment');
      }
      document.querySelector('.welcome-assessment')?.click();
      await waitFor('.answer-grid button');
    }
    const deadline = performance.now() + 5000;
    while (!document.querySelector('.answer-grid button') && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const answer = document.querySelector('.answer-grid button');
    if (!answer) throw new Error('测评答案按钮不存在');
    answer.click();
    return true;
  })()`);
  const deadline = performance.now() + 12_000;
  let peak = 0;
  let captured = false;
  while (performance.now() < deadline) {
    const state = await evaluate(`(() => {
      const avatar = document.querySelector('.digital-human');
      return {
        open: Number(getComputedStyle(avatar).getPropertyValue('--mouth-open')) || 0,
        opacity: Number(getComputedStyle(avatar).getPropertyValue('--mouth-opacity')) || 0,
        speaking: avatar?.dataset.avatarState === 'speaking',
        viseme: avatar?.dataset.viseme || '',
        mouthFrameOpacity: [...document.querySelectorAll('.digital-human__mouth-frame')].map((frame) => Number(getComputedStyle(frame).opacity)),
      };
    })()`);
    peak = Math.max(peak, state.open);
    if (state.speaking && ['A', 'E'].includes(state.viseme) && state.open >= 0.3 && state.mouthFrameOpacity[0] > .9) {
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
      captured = true;
      report.mouthCapture = { ...state, peak, screenshot: outputPath };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (!captured) report.mouthCapture = { captured: false, peak };
}
console.log(JSON.stringify(report, null, 2));
socket.close();
