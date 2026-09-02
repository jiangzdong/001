import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9269);
const outputPath = path.resolve(process.argv[3] || "qa/station-avatar-performance.json");
const durationMs = Math.max(4000, Number(process.argv[4]) || 12_000);
const idleOnly = process.argv.includes("--idle");
const staticStageMask = process.argv.includes("--static-stage-mask");
const phrase = process.argv.slice(5).filter((value) => !value.startsWith("--")).join(" ") || "您好，我是小安。我们现在检查离线语音、自然口型、下巴同步和连续过渡是否流畅，请您稍等一下。";

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
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] || 0;

await Promise.all([send("Runtime.enable"), send("Page.enable")]);
await send("Page.bringToFront");
if (staticStageMask) {
  await evaluate(`(() => {
    document.getElementById('xiaoan-static-stage-mask-probe')?.remove();
    const style = document.createElement('style');
    style.id = 'xiaoan-static-stage-mask-probe';
    style.textContent = [
      '.advisor-avatar-stage.is-home{mask-image:none!important;-webkit-mask-image:none!important;}',
      '.advisor-avatar-stage.is-home>.advisor-full-body-avatar{',
      'mask-image:linear-gradient(to right,transparent 0,#000 17%,#000 100%),linear-gradient(to bottom,transparent 0,#000 2%,#000 96%,transparent 100%)!important;',
      '-webkit-mask-image:linear-gradient(to right,transparent 0,#000 17%,#000 100%),linear-gradient(to bottom,transparent 0,#000 2%,#000 96%,transparent 100%)!important;',
      'mask-composite:intersect!important;-webkit-mask-composite:source-in!important;',
      '}'
    ].join('');
    document.head.append(style);
    return true;
  })()`);
}
let ready = false;
for (let index = 0; index < 160; index += 1) {
  ready = await evaluate(`Boolean(window.__XIAOAN_AVATAR_QA__?.speakReference && document.querySelector('.station-advisor-digital-human')?.dataset.rigReady === 'true')`);
  if (ready) break;
  await wait(50);
}
if (!ready) throw new Error("Station avatar performance probe did not become ready");
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);
await wait(250);
await evaluate(`(() => {
  window.__XIAOAN_SPEECH_QA_EVENTS__ = [];
  const rig = document.querySelector('.station-advisor-digital-human__local-rig');
  if (rig) rig.__localFaceRigPerformance = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
  return true;
})()`);

const sampling = evaluate(`new Promise((resolve) => {
  const durationMs = ${JSON.stringify(durationMs)};
  const avatar = document.querySelector('.station-advisor-digital-human');
  const rig = document.querySelector('.station-advisor-digital-human__local-rig');
  const startedAt = performance.now();
  let previousAt = startedAt;
  let previousViseme = avatar?.dataset.viseme || 'CLOSED';
  let previousSpeaking = avatar?.dataset.speaking === 'true';
  const deltas = [];
  const speakingDeltas = [];
  const transitions = [];
  const speakingTransitions = [];
  const longFrameSamples = [];
  const suspensions = [];
  const longTasks = [];
  let longTaskObserver = null;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          atMs: Number((entry.startTime - startedAt).toFixed(2)),
          durationMs: Number(entry.duration.toFixed(2)),
          name: entry.name || '',
        });
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {}
  const tick = (timestamp) => {
    const delta = timestamp - previousAt;
    previousAt = timestamp;
    if (delta > 0 && delta < 1000) deltas.push(delta);
    const viseme = avatar?.dataset.viseme || 'CLOSED';
    const speaking = avatar?.dataset.speaking === 'true';
    if (speaking !== previousSpeaking) {
      speakingTransitions.push({ atMs: Number((timestamp - startedAt).toFixed(2)), speaking });
      previousSpeaking = speaking;
    }
    if (speaking && delta > 0 && delta < 1000) speakingDeltas.push(delta);
    if (delta > 50) {
      const frameSample = {
        atMs: Number((timestamp - startedAt).toFixed(2)),
        frameDeltaMs: Number(delta.toFixed(2)),
        viseme,
        speaking,
        avatarState: avatar?.dataset.avatarState || '',
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      };
      longFrameSamples.push(frameSample);
      if (delta >= 1000) suspensions.push(frameSample);
    }
    if (viseme !== previousViseme) {
      transitions.push({
        atMs: timestamp - startedAt,
        from: previousViseme,
        to: viseme,
        frameDeltaMs: delta,
        jawOpen: Number(avatar?.dataset.jawOpen || 0),
      });
      previousViseme = viseme;
    }
    if (timestamp - startedAt >= durationMs) {
      longTaskObserver?.disconnect();
      resolve({
        deltas,
        speakingDeltas,
        transitions,
        speakingTransitions,
        longFrameSamples,
        suspensions,
        longTasks,
        speechEvents: (window.__XIAOAN_SPEECH_QA_EVENTS__ || [])
          .filter((entry) => Number(entry?.at) >= startedAt)
          .map(({ at, ...entry }) => ({ ...entry, atMs: Number((Number(at) - startedAt).toFixed(2)) })),
        rig: rig?.dataset.rig || '',
        textureCache: rig?.dataset.textureCache || '',
        preparedTextures: Number(rig?.dataset.preparedTextures || 0),
        rigPerformance: rig?.__localFaceRigPerformance || null,
        screen: { width: window.screen.width, height: window.screen.height, devicePixelRatio: window.devicePixelRatio },
      });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`);
if (!idleOnly) await evaluate(`window.__XIAOAN_AVATAR_QA__.speakReference(${JSON.stringify(phrase)}); true`);
const sample = await sampling;
await evaluate(`window.__XIAOAN_AVATAR_QA__.stopSpeech(); true`);

const deltas = sample.deltas.slice(3).sort((left, right) => left - right);
const speakingDeltas = sample.speakingDeltas.sort((left, right) => left - right);
const transitionDeltas = sample.transitions.map((entry) => entry.frameDeltaMs).filter((value) => value > 0).sort((left, right) => left - right);
const report = {
  generatedAt: new Date().toISOString(),
  runtime: await evaluate("window.kioskBridge?.runtimeStatus?.()"),
  durationMs,
  mode: idleOnly ? "idle-baseline" : "local-tts-speaking",
  phrase,
  rig: sample.rig,
  textureCache: sample.textureCache,
  preparedTextures: sample.preparedTextures,
  rigPerformance: sample.rigPerformance && {
    count: sample.rigPerformance.count,
    averageMs: Number((sample.rigPerformance.totalMs / Math.max(1, sample.rigPerformance.count)).toFixed(2)),
    maxMs: Number(sample.rigPerformance.maxMs.toFixed(2)),
    lastMs: Number(sample.rigPerformance.lastMs.toFixed(2)),
  },
  screen: sample.screen,
  frames: deltas.length,
  approximateFps: deltas.length ? Number((1000 / (deltas.reduce((sum, value) => sum + value, 0) / deltas.length)).toFixed(2)) : 0,
  frameMs: {
    p50: Number(percentile(deltas, 0.5).toFixed(2)),
    p95: Number(percentile(deltas, 0.95).toFixed(2)),
    p99: Number(percentile(deltas, 0.99).toFixed(2)),
    max: Number((deltas.at(-1) || 0).toFixed(2)),
  },
  speakingFrameMs: {
    frames: speakingDeltas.length,
    p50: Number(percentile(speakingDeltas, 0.5).toFixed(2)),
    p95: Number(percentile(speakingDeltas, 0.95).toFixed(2)),
    p99: Number(percentile(speakingDeltas, 0.99).toFixed(2)),
    max: Number((speakingDeltas.at(-1) || 0).toFixed(2)),
    above50ms: speakingDeltas.filter((value) => value > 50).length,
    above80ms: speakingDeltas.filter((value) => value > 80).length,
  },
  longFrames: {
    above33ms: deltas.filter((value) => value > 33.4).length,
    above50ms: deltas.filter((value) => value > 50).length,
    above80ms: deltas.filter((value) => value > 80).length,
    samples: sample.longFrameSamples,
  },
  suspensions: {
    count: sample.suspensions.length,
    speaking: sample.suspensions.filter((entry) => entry.speaking).length,
    samples: sample.suspensions,
  },
  longTasks: sample.longTasks,
  speechEvents: sample.speechEvents,
  transitions: {
    count: sample.transitions.length,
    p95FrameMs: Number(percentile(transitionDeltas, 0.95).toFixed(2)),
    maxFrameMs: Number((transitionDeltas.at(-1) || 0).toFixed(2)),
    samples: sample.transitions,
  },
  speakingTransitions: sample.speakingTransitions,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify({ outputPath, ...report }, null, 2));
if (report.frameMs.p95 > 34 || report.longFrames.above80ms > 0 || report.suspensions.count > 0) process.exit(1);
