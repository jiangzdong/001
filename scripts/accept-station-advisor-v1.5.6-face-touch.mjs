import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9256);
const outputDir = path.resolve(process.argv[3] || "qa/station-advisor-v1.5.6-face-touch");
const cdpBase = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await fs.mkdir(outputDir, { recursive: true });

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener("message", ({ data }) => this.handle(JSON.parse(String(data))));
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
  handle(message) {
    if (!message.id) {
      for (const handler of this.events.get(message.method) || []) handler(message.params || {});
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result);
  }
  on(method, handler) { this.events.set(method, [...(this.events.get(method) || []), handler]); }
  send(method, params = {}, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function capture(client, name, clip) {
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
  const output = path.join(outputDir, name);
  await fs.writeFile(output, Buffer.from(result.data, "base64"));
  return output;
}

async function cropScreencastFrame(client, name, frameData, clip) {
  const data = await evaluate(client, `(async () => {
    const image=new Image(); image.src='data:image/jpeg;base64,'+${JSON.stringify(frameData)}; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=Math.round(${clip.width}*2); canvas.height=Math.round(${clip.height}*2);
    const context=canvas.getContext('2d',{alpha:false});
    const ratioX=image.naturalWidth/innerWidth, ratioY=image.naturalHeight/innerHeight;
    context.drawImage(image,${clip.x}*ratioX,${clip.y}*ratioY,${clip.width}*ratioX,${clip.height}*ratioY,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  })()`);
  const output = path.join(outputDir, name);
  await fs.writeFile(output, Buffer.from(data, "base64"));
  return output;
}

async function readScreencastMarkers(client, frameData) {
  return evaluate(client, `(async () => {
    const image=new Image(); image.src='data:image/jpeg;base64,'+${JSON.stringify(frameData)}; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=2; canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    const rx=image.naturalWidth/innerWidth, ry=image.naturalHeight/innerHeight;
    context.drawImage(image,12*rx,12*ry,1,1,0,0,1,1);
    context.drawImage(image,38*rx,12*ry,1,1,1,0,1,1);
    const pixels=context.getImageData(0,0,2,1).data;
    return { blink:[pixels[0],pixels[1],pixels[2]], mouth:[pixels[4],pixels[5],pixels[6]], width:image.naturalWidth, height:image.naturalHeight };
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

async function touch(client, point) {
  const contact = { x: point.x, y: point.y, radiusX: 7, radiusY: 7, force: .8, id: 1 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact] });
  await wait(45);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(65);
}

const READ_STATE = `(() => {
  const q = (selector) => document.querySelector(selector);
  const rect = (element) => { const value = element?.getBoundingClientRect(); return value ? { x:value.x,y:value.y,width:value.width,height:value.height,right:value.right,bottom:value.bottom } : null; };
  const avatar = q('.station-advisor-digital-human');
  const localRig = q('.station-advisor-digital-human__local-rig');
  const fullBody = q('.advisor-full-body-avatar');
  const shell = q('.advisor-shell');
  const keyboard = q('[data-testid="advisor-soft-keyboard"]');
  const input = q('#advisor-question-input');
  const localRigStyle = localRig && getComputedStyle(localRig);
  return {
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    shell: rect(shell), fullBody: rect(fullBody), avatar: rect(avatar), keyboard: rect(keyboard),
    keyboardInsideShell: Boolean(keyboard && shell && keyboard.getBoundingClientRect().left >= shell.getBoundingClientRect().left - .5 && keyboard.getBoundingClientRect().right <= shell.getBoundingClientRect().right + .5 && keyboard.getBoundingClientRect().bottom <= shell.getBoundingClientRect().bottom + .5),
    input: { value: input?.value || '', active: document.activeElement === input },
    composition: q('.advisor-soft-keyboard__topline span')?.textContent?.trim() || '',
    rigReady: avatar?.dataset.rigReady || '', speaking: avatar?.dataset.speaking || '',
    jawOpen: Number(avatar?.dataset.jawOpen || 0), viseme: avatar?.dataset.viseme || '', renderedViseme: localRig?.dataset.textureFrame || avatar?.dataset.viseme || '', blinkPhase: avatar?.dataset.blinkPhase || '', expressionStrength: avatar ? Number(getComputedStyle(avatar).getPropertyValue('--expression-strength') || 0) : 0,
    chinOffsetPx: Number(localRig?.dataset.chinOffsetPx || 0), upperLipOffsetPx: Number(localRig?.dataset.upperLipOffsetPx || 0), lowerLipOffsetPx: Number(localRig?.dataset.lowerLipOffsetPx || 0), mouthChinDistanceDeltaPx: Number(localRig?.dataset.mouthChinDistanceDeltaPx || 0),
    localRigCompositor: localRig && {
      maskImage: localRigStyle.maskImage,
      webkitMaskImage: localRigStyle.webkitMaskImage,
      opacity: localRigStyle.opacity,
      visibility: localRigStyle.visibility,
      rig: localRig.dataset.rig || '',
      textureFrame: localRig.dataset.textureFrame || '',
      texturePolicy: localRig.dataset.texturePolicy || '',
    },
    markerStyles: { blink: q('#xiaoan-dynamic-blink-marker')?.style.background || '', mouth: q('#xiaoan-dynamic-mouth-marker')?.style.background || '' },
    externalKeyboardBridgePresent: typeof window.kioskBridge?.showSystemKeyboard === 'function',
  };
})()`;

function center(rect) { return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y); }
function mapMasterToFullBody(point) {
  return {
    x: .647438932 * point.x + .000315010204 * point.y + 210.596058,
    y: -.000315010204 * point.x + .647438932 * point.y - 4.08164974,
  };
}
function screenPoint(rect, sourcePoint) {
  return { x: rect.x + sourcePoint.x / 941 * rect.width, y: rect.y + sourcePoint.y / 1672 * rect.height };
}
function dynamicPoint(rect, sourcePoint) { return screenPoint(rect, sourcePoint); }

const report = { suite: "station-advisor-v1.5.6-packaged-face-touch", generatedAt: new Date().toISOString(), runtime: null, initial: null, compositor: {}, alignment: {}, keyboard: {}, speech: {}, blink: {}, dynamicFrames: { mouth: {}, blink: {} }, screenshots: {}, failures: [], result: "RUNNING" };
const screencastFrames = [];
let client;
try {
  const targets = await (await fetch(`${cdpBase}/json/list`)).json();
  const target = targets.find((item) => item.type === "page" && /站点咨询顾问/.test(item.title || "")) || targets.find((item) => item.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Electron page target missing");
  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  client.on("Page.screencastFrame", (event) => {
    screencastFrames.push({ data: event.data, metadataTimestampMs: Number(event.metadata?.timestamp) * 1000, receivedAtEpochMs: Date.now() });
    if (screencastFrames.length > 1400) screencastFrames.shift();
    void client.send("Page.screencastFrameAck", { sessionId: event.sessionId }, 5_000).catch(() => {});
  });
  await Promise.all([client.send("Runtime.enable"), client.send("Page.enable")]);
  await client.send("Page.bringToFront");
  await client.send("Page.reload", { ignoreCache: true });
  for (let index = 0; index < 150; index += 1) {
    report.initial = await evaluate(client, READ_STATE);
    if (report.initial?.fullBody && report.initial?.rigReady === "true" && report.initial?.localRigCompositor?.rig === "local-mouth-chin-v34") break;
    await wait(100);
  }
  report.runtime = await evaluate(client, `window.kioskBridge?.runtimeStatus?.()`);
  report.screenshots.initial = await capture(client, "00-home.png");
  report.compositor = {
    contract: "final-window-soft-mask-must-cover-both-mouth-corners-and-complete-moving-chin",
    initial: report.initial.localRigCompositor,
  };
  const pageMask = report.initial.localRigCompositor?.maskImage || report.initial.localRigCompositor?.webkitMaskImage || "";
  if (!pageMask.includes("42% 46%") || !pageMask.includes("50% 54%")) report.failures.push(`home-local-rig-soft-mask-missing:${pageMask || "none"}`);
  if (report.initial.localRigCompositor?.rig !== "local-mouth-chin-v34") report.failures.push(`unexpected-local-rig:${report.initial.localRigCompositor?.rig || "missing"}`);
  if (report.initial.localRigCompositor?.texturePolicy !== "split-mouth-dominant-sharp-stable-buffer") report.failures.push(`unexpected-texture-policy:${report.initial.localRigCompositor?.texturePolicy || "missing"}`);
  if (report.initial.viewport?.width !== 2400 || report.initial.viewport?.height !== 3840) report.failures.push(`extension-fullscreen-missing:${report.initial.viewport?.width || 0}x${report.initial.viewport?.height || 0}`);
  if (Math.abs((report.initial.shell?.width || 0) - 2400) > .5 || Math.abs((report.initial.shell?.height || 0) - 3840) > .5) report.failures.push(`app-shell-not-fullscreen:${report.initial.shell?.width || 0}x${report.initial.shell?.height || 0}`);
  if (report.initial.localRigCompositor?.opacity !== "1" || report.initial.localRigCompositor?.visibility !== "visible") report.failures.push("local-rig-not-visible-in-final-compositor");

  const sourcePoints = {
    mouth: { x: 470.5, y: 941 * .515 },
    leftEye: { x: 941 * .442, y: 941 * .4145 },
    rightEye: { x: 941 * .529, y: 941 * .411 },
  };
  for (const [name, source] of Object.entries(sourcePoints)) {
    const expected = screenPoint(report.initial.fullBody, mapMasterToFullBody(source));
    const actual = dynamicPoint(report.initial.avatar, source);
    report.alignment[name] = { expected, actual, deltaPx: +distance(expected, actual).toFixed(3) };
    if (report.alignment[name].deltaPx > 1.5) report.failures.push(`${name}-alignment:${report.alignment[name].deltaPx}`);
  }
  const faceCenter = screenPoint(report.initial.fullBody, { x: 515, y: 285 });
  const faceClip = { x: Math.max(0, faceCenter.x - 105), y: Math.max(0, faceCenter.y - 125), width: 210, height: 270 };
  report.screenshots.idleFace = await capture(client, "01-idle-face.png", faceClip);

  const triggerRect = await evaluate(client, `(() => { const r=document.querySelector('[data-testid="advisor-keyboard-trigger"]')?.getBoundingClientRect(); return r&&{x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
  if (!triggerRect) throw new Error("Chinese keyboard trigger missing");
  await touch(client, center(triggerRect));
  report.keyboard.open = await evaluate(client, READ_STATE);
  for (const number of ["1", "2", "3"]) {
    const numberRect = await evaluate(client, `(() => { const r=document.querySelector('button[aria-label="数字 ${number}"]')?.getBoundingClientRect(); return r&&{x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    if (!numberRect) throw new Error(`Numeric touch key missing:${number}`);
    await touch(client, center(numberRect));
  }
  const backspaceRect = await evaluate(client, `(() => { const r=document.querySelector('button[aria-label="退格"]')?.getBoundingClientRect(); return r&&{x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
  if (!backspaceRect) throw new Error("Touch backspace key missing");
  await touch(client, center(backspaceRect));
  report.keyboard.numeric = await evaluate(client, READ_STATE);
  await touch(client, center(backspaceRect));
  await touch(client, center(backspaceRect));
  for (const letter of "jintian") {
    const keyRect = await evaluate(client, `(() => { const r=document.querySelector('button[aria-label="拼音字母 ${letter}"]')?.getBoundingClientRect(); return r&&{x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    if (!keyRect) throw new Error(`Pinyin touch key missing:${letter}`);
    await touch(client, center(keyRect));
  }
  report.keyboard.composed = await evaluate(client, READ_STATE);
  const candidateRect = await evaluate(client, `(() => { const button=[...document.querySelectorAll('.advisor-soft-keyboard__candidates button')].find((item)=>item.textContent.trim()==='今天'); const r=button?.getBoundingClientRect(); return r&&{x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
  if (!candidateRect) throw new Error("Chinese candidate 今天 missing");
  await touch(client, center(candidateRect));
  report.keyboard.committed = await evaluate(client, READ_STATE);
  report.screenshots.keyboard = await capture(client, "10-touch-chinese-keyboard.png");
  if (!report.keyboard.open?.keyboardInsideShell) report.failures.push("keyboard-outside-app-shell");
  if (report.keyboard.open?.externalKeyboardBridgePresent) report.failures.push("external-system-keyboard-bridge-present");
  if (report.keyboard.numeric?.input?.value !== "12") report.failures.push(`numeric-touch-input:${report.keyboard.numeric?.input?.value}`);
  if (report.keyboard.composed?.composition !== "jintian") report.failures.push(`pinyin-composition:${report.keyboard.composed?.composition}`);
  if (report.keyboard.committed?.input?.value !== "今天") report.failures.push(`chinese-candidate-not-committed:${report.keyboard.committed?.input?.value}`);

  await client.send("Page.reload", { ignoreCache: true });
  let ready;
  for (let index = 0; index < 150; index += 1) {
    ready = await evaluate(client, READ_STATE);
    if (ready?.fullBody && ready?.rigReady === "true" && ready?.localRigCompositor?.rig === "local-mouth-chin-v34") break;
    await wait(100);
  }
  await evaluate(client, `(() => {
    window.__XIAOAN_DYNAMIC_MARKERS_CLEANUP__?.();
    const make=(id,left)=>{const marker=document.createElement('span');marker.id=id;Object.assign(marker.style,{position:'fixed',left:left+'px',top:'0',width:'24px',height:'24px',zIndex:'2147483647',pointerEvents:'none',background:'#000'});document.body.append(marker);return marker;};
    const blink=make('xiaoan-dynamic-blink-marker',0), mouth=make('xiaoan-dynamic-mouth-marker',26);
    let sawClosed=false, previous='', frame=0;
    const update=()=>{
      const avatar=document.querySelector('.station-advisor-digital-human');
      const rig=document.querySelector('.station-advisor-digital-human__local-rig');
      const phase=avatar?.dataset.blinkPhase||'';
      if (!phase&&previous) sawClosed=false;
      if (phase==='closed') sawClosed=true;
      const natural=phase==='closed'?'closed':phase==='half'?(sawClosed?'exit':'entry'):'';
      blink.style.background=natural==='entry'?'#ff0000':natural==='closed'?'#00ff00':natural==='exit'?'#0000ff':'#000000';
      const colors={CLOSED:'#ff00ff',A:'#ff0000',E:'#00ff00',O:'#0000ff',U:'#00ffff'};
      mouth.style.background=avatar?.dataset.speaking==='true'?(colors[rig?.dataset.textureFrame||avatar.dataset.viseme]||'#000000'):'#000000';
      previous=phase;
      frame=requestAnimationFrame(update);
    };
    update();
    window.__XIAOAN_DYNAMIC_MARKERS_CLEANUP__=()=>{cancelAnimationFrame(frame);blink.remove();mouth.remove();delete window.__XIAOAN_DYNAMIC_MARKERS_CLEANUP__;};
    return true;
  })()`);
  // Preserve enough final-compositor detail for MediaPipe and corner/seam
  // review. The previous 750px screencast was enlarged after capture and could
  // turn a valid natural A frame into an undetectable blurry crop.
  await client.send("Page.startScreencast", { format: "jpeg", quality: 100, maxWidth: 2400, maxHeight: 3840, everyNthFrame: 1 });
  const qaSpeechReady = await evaluate(client, `Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference)`);
  if (qaSpeechReady) {
    await evaluate(client, `window.__XIAOAN_AVATAR_QA__.stopSpeech(); window.__XIAOAN_AVATAR_QA__.speakReference("您好，我是小安。口型验收开始。啊啊啊，啊啊啊。诶诶诶，诶诶诶。哦哦哦，哦哦哦。呜呜呜，呜呜呜。下巴会跟随下嘴唇自然同步。"); true`);
  } else {
    const activityRect = await evaluate(client, `(() => { const b=[...document.querySelectorAll('.advisor-home-questions button')].find((item)=>item.getAttribute('aria-label')==='今天站点有什么活动？'); const r=b?.getBoundingClientRect(); return r&&{x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    await touch(client, center(activityRect));
  }
  const visemes = new Set();
  const visemeTimes = { A: [], E: [], O: [], U: [], CLOSED: [] };
  const visemeSamples = { A: [], E: [], O: [], U: [], CLOSED: [] };
  // Capture triggers sit below the physiological gates so short local-TTS
  // vowels are not missed between CDP samples. Acceptance still uses the
  // measured chin travel and the separate MediaPipe landmark comparison.
  const directMouthThreshold = { A: .18, E: .035, O: .16, U: .08 };
  const jawEvidence = { maxJawOpen: 0, maxUpperLipDownPx: 0, maxChinOffsetPx: 0, maxMouthChinDistanceDeltaPx: 0, maxExpressionStrength: 0 };
  let maxJawSample = null;
  let speechIdleSince = 0;
  for (let index = 0; index < 700; index += 1) {
    const state = await evaluate(client, READ_STATE);
    const sampledAtEpochMs = Date.now();
    if (!maxJawSample || (state.jawOpen || 0) > maxJawSample.jawOpen) maxJawSample = { ...state, sampledAtEpochMs };
    jawEvidence.maxJawOpen = Math.max(jawEvidence.maxJawOpen, state.jawOpen || 0);
    jawEvidence.maxUpperLipDownPx = Math.max(jawEvidence.maxUpperLipDownPx, state.upperLipOffsetPx || 0);
    jawEvidence.maxChinOffsetPx = Math.max(jawEvidence.maxChinOffsetPx, state.chinOffsetPx || 0);
    jawEvidence.maxMouthChinDistanceDeltaPx = Math.max(jawEvidence.maxMouthChinDistanceDeltaPx, state.mouthChinDistanceDeltaPx || 0);
    jawEvidence.maxExpressionStrength = Math.max(jawEvidence.maxExpressionStrength, state.expressionStrength || 0);
    const renderedViseme = state.renderedViseme || state.viseme;
    if (renderedViseme) visemes.add(renderedViseme);
    if (state.speaking === "true" && visemeTimes[renderedViseme] && state.jawOpen > .035) {
      visemeTimes[renderedViseme].push(sampledAtEpochMs);
      visemeSamples[renderedViseme].push({ timestamp: sampledAtEpochMs, jawOpen: state.jawOpen || 0 });
    }
    if (
      state.speaking === "true"
      && directMouthThreshold[renderedViseme]
      && state.jawOpen >= directMouthThreshold[renderedViseme]
      && !report.dynamicFrames.mouth[renderedViseme]
    ) {
      const screenshot = await capture(client, `dynamic-mouth-${renderedViseme}.png`, faceClip);
      report.dynamicFrames.mouth[renderedViseme] = {
        screenshot,
        matchingFrames: 1,
        selectedJawOpen: state.jawOpen,
        captureMode: "direct-packaged-runtime-state-frame",
      };
    }
    if (!report.speech.started && state.speaking === "true") report.speech.started = true;
    if (state.speaking === "true" && state.jawOpen > .18 && !report.screenshots.speakingFace) {
      report.speech.sample = state;
      report.screenshots.speaking = await capture(client, "20-real-tts-speaking.png");
      report.screenshots.speakingFace = await capture(client, "21-real-tts-speaking-face.png", faceClip);
    }
    if (state.speaking === "true" && state.jawOpen > .35 && !report.screenshots.highJawFace) {
      await evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      report.screenshots.highJawFace = await capture(client, "22-real-tts-high-jaw-face.png", faceClip);
    }
    if (report.speech.started && state.speaking !== "true" && report.screenshots.speakingFace) {
      if (!speechIdleSince) speechIdleSince = Date.now();
      const requiredVisemesSeen = ["A", "E", "O", "U"].every((name) => visemes.has(name));
      if (requiredVisemesSeen && Date.now() - speechIdleSince >= 700) { report.speech.ended = true; break; }
    } else {
      speechIdleSince = 0;
    }
    await wait(35);
  }

  // A long streamed sentence can contain short idle gaps or very brief vowel
  // events. Verify each authored vowel again with its own real local-TTS turn so
  // frame capture latency cannot hide the strongest mandibular pose.
  if (qaSpeechReady) {
    const focusedVowels = {
      A: "啊啊啊啊啊啊。",
      E: "诶诶诶诶诶诶。",
      O: "哦哦哦哦哦哦。",
      U: "呜呜呜呜呜呜。",
    };
    for (const [shape, phrase] of Object.entries(focusedVowels)) {
      await evaluate(client, `window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
      // Let the previous streamed VITS turn fully release its cancellation
      // token before starting the next focused vowel. A shorter gap can make a
      // valid request inherit the prior turn's cancel signal on slower disks.
      await wait(520);
      await evaluate(client, `window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(phrase)}); true`);
      let focusedSpeechSeen = false;
      let focusedIdleSince = 0;
      const focusedDeadline = Date.now() + 20_000;
      while (Date.now() < focusedDeadline) {
        const state = await evaluate(client, READ_STATE);
        const sampledAtEpochMs = Date.now();
        focusedSpeechSeen ||= state.speaking === "true";
        const renderedViseme = state.renderedViseme || state.viseme;
        if (renderedViseme) visemes.add(renderedViseme);
        jawEvidence.maxJawOpen = Math.max(jawEvidence.maxJawOpen, state.jawOpen || 0);
        jawEvidence.maxUpperLipDownPx = Math.max(jawEvidence.maxUpperLipDownPx, state.upperLipOffsetPx || 0);
        jawEvidence.maxChinOffsetPx = Math.max(jawEvidence.maxChinOffsetPx, state.chinOffsetPx || 0);
        jawEvidence.maxMouthChinDistanceDeltaPx = Math.max(jawEvidence.maxMouthChinDistanceDeltaPx, state.mouthChinDistanceDeltaPx || 0);
        jawEvidence.maxExpressionStrength = Math.max(jawEvidence.maxExpressionStrength, state.expressionStrength || 0);
        if (!maxJawSample || (state.jawOpen || 0) > maxJawSample.jawOpen) maxJawSample = { ...state, sampledAtEpochMs };
        if (state.speaking === "true" && renderedViseme === shape && state.jawOpen > .035) {
          visemeTimes[shape].push(sampledAtEpochMs);
          visemeSamples[shape].push({ timestamp: sampledAtEpochMs, jawOpen: state.jawOpen || 0 });
          const previousJaw = Number(report.dynamicFrames.mouth[shape]?.selectedJawOpen) || -1;
          if (state.jawOpen >= directMouthThreshold[shape] && state.jawOpen > previousJaw + .012) {
            report.dynamicFrames.mouth[shape] = {
              screenshot: await capture(client, `dynamic-mouth-${shape}.png`, faceClip),
              matchingFrames: 1,
              selectedJawOpen: state.jawOpen,
              captureMode: "focused-real-local-tts-strongest-frame",
            };
          }
        }
        if (focusedSpeechSeen && state.speaking !== "true") {
          if (!focusedIdleSince) focusedIdleSince = Date.now();
          if (Date.now() - focusedIdleSince >= 600) break;
        } else {
          focusedIdleSince = 0;
        }
        await wait(24);
      }
    }
    await evaluate(client, `window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
  }
  report.speech.visemes = [...visemes];
  if (report.speech.started && speechIdleSince) report.speech.ended = true;
  report.speech.jawEvidence = Object.fromEntries(Object.entries(jawEvidence).map(([key, value]) => [key, +value.toFixed(3)]));
  report.speech.maxJawSample = maxJawSample;
  if (!report.speech.started || !report.speech.ended) report.failures.push("real-local-tts-cycle-missing");
  if (!report.screenshots.speakingFace || visemes.size < 3) report.failures.push("real-mouth-motion-evidence-missing");
  // These are renderer-mesh deltas, not total landmark motion. The final
  // physiology gate is a MediaPipe comparison of the captured open/closed
  // frames; this runtime gate only proves that the chin visibly participated.
  if (jawEvidence.maxChinOffsetPx < 5 || jawEvidence.maxMouthChinDistanceDeltaPx < 4) report.failures.push(`visible-jaw-travel-missing:${jawEvidence.maxChinOffsetPx.toFixed(3)}/${jawEvidence.maxMouthChinDistanceDeltaPx.toFixed(3)}`);
  if (jawEvidence.maxUpperLipDownPx > .15) report.failures.push(`upper-lip-dragged-down:${jawEvidence.maxUpperLipDownPx.toFixed(3)}`);
  if (jawEvidence.maxExpressionStrength < .1) report.failures.push(`speaking-expression-missing:${jawEvidence.maxExpressionStrength.toFixed(3)}`);

  for (let index = 0; index < 300; index += 1) {
    if (!(await evaluate(client, READ_STATE)).blinkPhase) break;
    await wait(8);
  }
  const blinkTimes = { entry: [], closed: [], exit: [] };
  let sawClosed = false;
  let previousPhase = "";
  const blinkDeadline = Date.now() + 25_000;
  while (Date.now() < blinkDeadline) {
    const state = await evaluate(client, READ_STATE);
    let natural = "";
    if (state.blinkPhase === "closed") { natural = "closed"; sawClosed = true; }
    else if (state.blinkPhase === "half") natural = sawClosed ? "exit" : "entry";
    if (natural) {
      blinkTimes[natural].push(Date.now());
      if (!report.dynamicFrames.blink[natural]) {
        const screenshot = await capture(client, `dynamic-blink-${natural}.png`, faceClip);
        report.dynamicFrames.blink[natural] = {
          screenshot,
          matchingFrames: 1,
          captureMode: "direct-packaged-runtime-state-frame",
        };
      }
    }
    if (!state.blinkPhase && previousPhase) {
      if (sawClosed && Object.values(blinkTimes).every((times) => times.length)) break;
      // A full-screen render can miss the first half-closing sample and begin
      // at CLOSED. Reset between cycles so the next natural half phase is
      // classified as entry rather than permanently treated as an exit.
      sawClosed = false;
    }
    previousPhase = state.blinkPhase;
    await wait(8);
  }
  await wait(120);
  await client.send("Page.stopScreencast");
  await evaluate(client, `window.__XIAOAN_DYNAMIC_MARKERS_CLEANUP__?.(); true`);

  const nearAny = (timestamp, times, threshold = 180) => times.some((time) => Math.abs(timestamp - time) <= threshold);
  const mouthTimes = Object.values(visemeTimes).flat();
  const blinkSampleTimes = Object.values(blinkTimes).flat();
  const candidateFrames = screencastFrames.filter((frame) => nearAny(frame.receivedAtEpochMs, mouthTimes) || nearAny(frame.receivedAtEpochMs, blinkSampleTimes) || Math.abs(frame.receivedAtEpochMs - (maxJawSample?.sampledAtEpochMs || 0)) <= 180);
  const markedFrames = [];
  for (const frame of candidateFrames) {
    const markers = await readScreencastMarkers(client, frame.data);
    markedFrames.push({ frame, markers, viseme: visemeFromMarker(markers.mouth), blink: blinkPhaseFromMarker(markers.blink) });
  }
  for (const viseme of ["A", "E", "O", "U"]) {
    // Chromium may temporarily downscale an individual screencast frame while
    // the 4K compositor is busy. Such a frame makes the whole face look soft
    // and is invalid visual evidence even when its viseme marker is correct.
    const matches = markedFrames.filter((item) => item.viseme === viseme && item.markers.width >= report.initial.viewport.width * .9 && item.markers.height >= report.initial.viewport.height * .9);
    const strongestSample = visemeSamples[viseme].reduce((best, item) => !best || item.jawOpen > best.jawOpen ? item : best, null);
    const match = strongestSample
      ? matches.reduce((best, item) => !best || Math.abs(item.frame.receivedAtEpochMs - strongestSample.timestamp) < Math.abs(best.frame.receivedAtEpochMs - strongestSample.timestamp) ? item : best, null)
      : matches[Math.floor(matches.length / 2)];
    if (!match) {
      if (!report.dynamicFrames.mouth[viseme]) report.failures.push(`dynamic-viseme-frame-missing:${viseme}`);
      continue;
    }
    const screenshot = await cropScreencastFrame(client, `dynamic-mouth-${viseme}.png`, match.frame.data, faceClip);
    report.dynamicFrames.mouth[viseme] = { screenshot, matchingFrames: matches.length, marker: match.markers.mouth, selectedJawOpen: strongestSample?.jawOpen || null, captureMode: "natural-tts-strongest-viseme-frame" };
  }
  const maxJawFrame = maxJawSample && screencastFrames.reduce((best, frame) => !best || Math.abs(frame.receivedAtEpochMs - maxJawSample.sampledAtEpochMs) < Math.abs(best.receivedAtEpochMs - maxJawSample.sampledAtEpochMs) ? frame : best, null);
  if (maxJawFrame) {
    report.screenshots.maxJawFace = await cropScreencastFrame(client, "dynamic-jaw-max.png", maxJawFrame.data, faceClip);
  } else {
    report.failures.push("dynamic-max-jaw-frame-missing");
  }
  for (const phase of ["entry", "closed", "exit"]) {
    const matches = markedFrames.filter((item) => item.blink === phase);
    const match = matches[Math.floor(matches.length / 2)];
    if (!match) {
      if (!report.dynamicFrames.blink[phase]) report.failures.push(`dynamic-blink-frame-missing:${phase}`);
      continue;
    }
    const screenshot = await cropScreencastFrame(client, `dynamic-blink-${phase}.png`, match.frame.data, faceClip);
    report.dynamicFrames.blink[phase] = { screenshot, matchingFrames: matches.length, marker: match.markers.blink, captureMode: "natural-blink-screencast-frame" };
  }
  report.dynamicFrames.diagnostics = {
    capturedFrames: screencastFrames.length,
    candidateFrames: candidateFrames.length,
    firstReceivedAtEpochMs: screencastFrames[0]?.receivedAtEpochMs || null,
    lastReceivedAtEpochMs: screencastFrames.at(-1)?.receivedAtEpochMs || null,
    metadataTimestampRange: [screencastFrames[0]?.metadataTimestampMs || null, screencastFrames.at(-1)?.metadataTimestampMs || null],
    mouthTimeRange: mouthTimes.length ? [Math.min(...mouthTimes), Math.max(...mouthTimes)] : [],
    blinkTimeRange: blinkSampleTimes.length ? [Math.min(...blinkSampleTimes), Math.max(...blinkSampleTimes)] : [],
    markerSamples: markedFrames.slice(0, 12).map((item) => ({ markers: item.markers, viseme: item.viseme, blink: item.blink })),
  };
  report.blink = { naturalCycleObserved: Object.values(blinkTimes).every((times) => times.length), sampleCounts: Object.fromEntries(Object.entries(blinkTimes).map(([key, value]) => [key, value.length])) };
  if (!report.blink.naturalCycleObserved) report.failures.push("natural-blink-cycle-not-observed");

  if (report.initial.title !== "小安站点咨询顾问 V1.5.6") report.failures.push(`unexpected-title:${report.initial.title}`);
  if (report.runtime?.version !== "1.5.6") report.failures.push(`unexpected-runtime-version:${report.runtime?.version || "missing"}`);
  if (report.runtime?.packaged !== true) report.failures.push("runtime-not-packaged");
  if (!report.runtime?.speech?.ready || !report.runtime?.speech?.offline) report.failures.push("offline-speech-not-ready");
  report.result = report.failures.length ? "FAIL" : "PASS";
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
  report.result = "FAIL";
} finally {
  report.generatedAt = new Date().toISOString();
  report.reportPath = path.join(outputDir, "station-advisor-v1.5.6-face-touch-report.json");
  await fs.writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  client?.close();
}

process.stdout.write(`${JSON.stringify({ result:report.result, failures:report.failures, reportPath:report.reportPath, compositor:report.compositor, alignment:report.alignment, keyboard:report.keyboard, speech:report.speech, blink:report.blink, dynamicFrames:report.dynamicFrames, screenshots:report.screenshots }, null, 2)}\n`);
process.exitCode = report.result === "PASS" ? 0 : 1;
