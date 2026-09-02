import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || process.env.XIAOAN_CDP_PORT || 9234);
const outputDir = path.resolve(process.argv[3] || "qa/station-advisor-v1.5.5-runtime-electron");
const cdpBase = `http://127.0.0.1:${port}`;
const reportPath = path.join(outputDir, "station-advisor-v1.5.5-runtime-report.json");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await fs.mkdir(outputDir, { recursive: true });

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener("message", ({ data }) => this.handle(String(data)));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timeout")), 8_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  handle(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const handler of this.events.get(message.method) || []) handler(message.params || {});
  }

  on(method, handler) {
    this.events.set(method, [...(this.events.get(method) || []), handler]);
  }

  send(method, params = {}, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function screenshot(client, name) {
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const outputPath = path.join(outputDir, name);
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
  return outputPath;
}

async function click(client, point) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}

const READ_STATE = `(() => {
  const q = (selector) => document.querySelector(selector);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const rect = (element) => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
  };
  const avatar = q('.station-advisor-digital-human');
  const avatarStyle = avatar && getComputedStyle(avatar);
  const shell = q('.advisor-shell');
  const shellStyle = shell && getComputedStyle(shell);
  const backdrop = q('.advisor-screen-backdrop');
  const backdropImage = q('.advisor-screen-backdrop > img');
  const backdropImageStyle = backdropImage && getComputedStyle(backdropImage);
  const fullBody = q('.advisor-full-body-avatar');
  const fullBodyStyle = fullBody && getComputedStyle(fullBody);
  const sceneFlow = q('.advisor-scene-flow');
  const sceneFlowStyle = sceneFlow && getComputedStyle(sceneFlow);
  const greeting = q('.advisor-greeting');
  const greetingStyle = greeting && getComputedStyle(greeting);
  const greetingTailOuter = greeting && getComputedStyle(greeting, '::before');
  const greetingTailInner = greeting && getComputedStyle(greeting, '::after');
  const quick = [...document.querySelectorAll('.advisor-home-questions > button')]
    .find((button) => button.getAttribute('aria-label') === '今天站点有什么活动？');
  return {
    capturedAtEpochMs: Date.now(),
    performanceMs: performance.now(),
    title: document.title,
    url: location.href,
    protocol: location.protocol,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    shell: { rect: rect(shell), maskImage: shellStyle?.maskImage || shellStyle?.webkitMaskImage || '' },
    screenBackdrop: backdrop ? {
      rect: rect(backdrop),
      imageComplete: backdropImage?.complete || false,
      imageNaturalWidth: backdropImage?.naturalWidth || 0,
      imageNaturalHeight: backdropImage?.naturalHeight || 0,
      imageFilter: backdropImageStyle?.filter || '',
    } : null,
    fullBody: fullBody ? {
      src: fullBody.getAttribute('src') || '',
      currentSrc: fullBody.currentSrc || '',
      complete: fullBody.complete,
      naturalWidth: fullBody.naturalWidth,
      naturalHeight: fullBody.naturalHeight,
      opacity: number(fullBodyStyle?.opacity),
      display: fullBodyStyle?.display || '',
      visibility: fullBodyStyle?.visibility || '',
      rect: rect(fullBody),
    } : null,
    sceneFlow: sceneFlow ? {
      rect: rect(sceneFlow),
      backgroundImage: sceneFlowStyle?.backgroundImage || '',
      filter: sceneFlowStyle?.filter || '',
    } : null,
    greetingBubble: greeting ? {
      rect: rect(greeting),
      borderWidth: greetingStyle?.borderTopWidth || '',
      borderColor: greetingStyle?.borderTopColor || '',
      tailOuter: { content: greetingTailOuter?.content || '', clipPath: greetingTailOuter?.clipPath || '', width: greetingTailOuter?.width || '' },
      tailInner: { content: greetingTailInner?.content || '', clipPath: greetingTailInner?.clipPath || '', width: greetingTailInner?.width || '' },
    } : null,
    avatar: avatar ? {
      state: avatar.dataset.avatarState || '',
      speaking: avatar.dataset.speaking || '',
      viseme: avatar.dataset.viseme || '',
      visemeTarget: avatar.dataset.visemeTarget || '',
      visemeCurrent: avatar.dataset.visemeCurrent || '',
      visemeNext: avatar.dataset.visemeNext || '',
      alignment: avatar.dataset.visemeAlignment || '',
      jawOpen: number(avatar.dataset.jawOpen),
      cssJawOpen: number(avatarStyle?.getPropertyValue('--jaw-open')),
      mouthOpen: number(avatarStyle?.getPropertyValue('--mouth-open')),
      rigReady: avatar.dataset.rigReady || '',
      rigError: avatar.dataset.rigError || '',
      rect: rect(avatar),
    } : null,
    quickQuestion: { rect: rect(quick), label: quick?.getAttribute('aria-label') || '' },
    conversation: {
      present: Boolean(q('.advisor-conversation-panel')),
      title: q('.advisor-conversation-heading h1')?.textContent?.trim() || '',
      body: q('.advisor-answer-card p')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    },
    status: q('.advisor-composer__status > small')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
  };
})()`;

const report = {
  suite: "station-advisor-v1.5.5-packaged-runtime",
  generatedAt: new Date().toISOString(),
  target: null,
  runtime: null,
  initial: null,
  samples: [],
  summary: null,
  screenshots: {},
  console: { warnings: [], errors: [], exceptions: [], crashes: [] },
  failures: [],
  result: "RUNNING",
};

let client;
try {
  const targets = await (await fetch(`${cdpBase}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === "page" && /站点咨询顾问/.test(candidate.title || ""))
    || targets.find((candidate) => candidate.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error(`No Electron page target at ${cdpBase}`);
  report.target = { title: target.title, url: target.url, id: target.id };
  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type !== "warning" && event.type !== "error") return;
    report.console[event.type === "warning" ? "warnings" : "errors"].push((event.args || []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" "));
  });
  client.on("Runtime.exceptionThrown", (event) => report.console.exceptions.push(event.exceptionDetails?.text || "renderer exception"));
  client.on("Inspector.targetCrashed", (event) => report.console.crashes.push(event));
  await Promise.all([client.send("Runtime.enable"), client.send("Page.enable"), client.send("Inspector.enable")]);
  await client.send("Page.bringToFront");
  await client.send("Page.reload", { ignoreCache: true });

  const readyDeadline = Date.now() + 15_000;
  while (Date.now() < readyDeadline) {
    report.initial = await evaluate(client, READ_STATE);
    if (report.initial?.fullBody?.complete && report.initial?.quickQuestion?.rect && report.initial?.avatar?.rigReady === "true") break;
    await wait(100);
  }
  if (!report.initial?.quickQuestion?.rect) throw new Error("Station advisor home actions did not become ready");
  report.runtime = await evaluate(client, `(async () => {
    try { return await window.kioskBridge?.runtimeStatus?.(); }
    catch (error) { return { error: error?.message || String(error) }; }
  })()`);
  report.screenshots.initial = await screenshot(client, "00-home-person-loaded.png");

  const quickRect = report.initial.quickQuestion.rect;
  await click(client, { x: quickRect.x + quickRect.width / 2, y: quickRect.y + quickRect.height / 2 });

  const sampleStartedAt = performance.now();
  const deadline = sampleStartedAt + 45_000;
  let speakingSamples = 0;
  let endedAfterSpeaking = false;
  let speakingScreenshotTaken = false;
  while (performance.now() < deadline) {
    const state = await evaluate(client, READ_STATE);
    const sample = {
      timeMs: +(performance.now() - sampleStartedAt).toFixed(1),
      status: state.status,
      conversationPresent: state.conversation.present,
      fullBodyWidth: state.fullBody?.naturalWidth || 0,
      avatarState: state.avatar?.state || "",
      speaking: state.avatar?.speaking || "",
      viseme: state.avatar?.viseme || "",
      visemeTarget: state.avatar?.visemeTarget || "",
      alignment: state.avatar?.alignment || "",
      jawOpen: state.avatar?.jawOpen ?? null,
      mouthOpen: state.avatar?.mouthOpen ?? null,
      rigReady: state.avatar?.rigReady || "",
    };
    report.samples.push(sample);
    if (sample.speaking === "true" || sample.avatarState === "speaking") {
      speakingSamples += 1;
      if (!speakingScreenshotTaken) {
        report.screenshots.speaking = await screenshot(client, "10-real-tts-speaking.png");
        speakingScreenshotTaken = true;
      }
    } else if (speakingSamples >= 6) {
      endedAfterSpeaking = true;
      break;
    }
    await wait(55);
  }

  const visemes = new Set(report.samples.map((sample) => sample.viseme).filter(Boolean));
  const maxJawOpen = Math.max(0, ...report.samples.map((sample) => Number(sample.jawOpen) || 0));
  const maxMouthOpen = Math.max(0, ...report.samples.map((sample) => Number(sample.mouthOpen) || 0));
  const alignedSamples = report.samples.filter((sample) => sample.alignment && sample.alignment !== "none").length;
  report.summary = {
    sampleCount: report.samples.length,
    speakingSamples,
    endedAfterSpeaking,
    maxJawOpen: +maxJawOpen.toFixed(4),
    maxMouthOpen: +maxMouthOpen.toFixed(4),
    visemes: [...visemes],
    alignedSamples,
  };
  report.screenshots.final = await screenshot(client, "20-conversation-final.png");

  if (report.initial.title !== "小安站点咨询顾问 V1.5.5") report.failures.push(`unexpected-title:${report.initial.title}`);
  if (report.runtime?.packaged !== true) report.failures.push("runtime-not-packaged");
  if (report.runtime?.version !== "1.5.5") report.failures.push(`unexpected-runtime-version:${report.runtime?.version || "missing"}`);
  if (!report.runtime?.speech?.ready || !report.runtime?.speech?.offline) report.failures.push("offline-speech-not-ready");
  if (!report.initial.fullBody || report.initial.fullBody.naturalWidth <= 0 || report.initial.fullBody.naturalHeight <= 0) report.failures.push("full-body-avatar-not-loaded");
  if (report.initial.fullBody?.display === "none" || report.initial.fullBody?.visibility === "hidden" || report.initial.fullBody?.opacity === 0) report.failures.push("full-body-avatar-not-visible");
  if (!report.initial.screenBackdrop?.imageComplete || report.initial.screenBackdrop.imageNaturalWidth <= 0) report.failures.push("extended-screen-backdrop-not-loaded");
  if (report.initial.screenBackdrop?.rect?.width < report.initial.viewport.width || report.initial.screenBackdrop?.rect?.height < report.initial.viewport.height) report.failures.push("extended-screen-backdrop-does-not-cover-viewport");
  if (report.initial.viewport.width > report.initial.shell?.rect?.width + 2 && !report.initial.shell.maskImage.includes("gradient")) report.failures.push("wide-screen-edge-blending-missing");
  if (!report.initial.sceneFlow?.rect || !report.initial.sceneFlow.backgroundImage.includes("radial-gradient")) report.failures.push("scene-flow-accent-missing");
  if (!report.initial.greetingBubble?.rect || report.initial.greetingBubble.borderWidth === "0px") report.failures.push("greeting-bubble-outline-missing");
  if (!report.initial.greetingBubble?.tailOuter?.clipPath.includes("polygon") || !report.initial.greetingBubble?.tailInner?.clipPath.includes("polygon")) report.failures.push("greeting-bubble-double-tail-missing");
  if (report.initial.avatar?.rigReady !== "true") report.failures.push(`local-rig-not-ready:${report.initial.avatar?.rigError || "unknown"}`);
  if (speakingSamples < 6) report.failures.push(`real-tts-speaking-not-observed:${speakingSamples}`);
  if (maxJawOpen < 0.04 || maxMouthOpen < 0.04) report.failures.push(`mouth-motion-not-observed:${maxJawOpen}/${maxMouthOpen}`);
  if (visemes.size < 2) report.failures.push(`viseme-change-not-observed:${[...visemes].join(",") || "none"}`);
  if (!report.samples.some((sample) => sample.conversationPresent)) report.failures.push("conversation-screen-not-opened");
  if (report.console.errors.length || report.console.exceptions.length || report.console.crashes.length) report.failures.push("renderer-errors-observed");
  report.result = report.failures.length ? "FAIL" : "PASS";
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
  report.result = "FAIL";
} finally {
  report.generatedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  client?.close();
}

process.stdout.write(`${JSON.stringify({ result: report.result, failures: report.failures, reportPath, summary: report.summary, screenshots: report.screenshots }, null, 2)}\n`);
process.exitCode = report.result === "PASS" ? 0 : 1;
