import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cropPngScript = path.join(scriptDirectory, "crop-png.ps1");
const powershellExecutable = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

const EXPECTED_TITLE = "小安站点咨询顾问 V1.5.2";
const ORDINARY_QUESTION = "今天站点有什么活动？";
const INTERRUPT_LABEL = "打断回答并开始聆听";
const DEFAULT_PORT = 9229;
const SAMPLE_INTERVAL_MS = 20;
const DOM_TIMEOUT_MS = 12_000;
const INITIAL_LISTEN_TIMEOUT_MS = 9_000;
const SPEECH_AND_INTERRUPT_TIMEOUT_MS = 35_000;
const JAW_ZERO_TOLERANCE = 0.01;
const OPEN_JAW_THRESHOLD = 0.14;
const MIN_MOUTH_MEAN_RGB_DELTA = 4;
const MIN_MOUTH_CHANGED_SAMPLE_RATIO = 0.05;

function printUsage() {
  process.stdout.write(`Usage: node scripts/accept-station-advisor-v1.5.2-electron.mjs [options]\n\nOptions:\n  --port <port>             Electron remote-debugging port (default: ${DEFAULT_PORT})\n  --output-dir <directory>  Evidence output directory\n  --help                    Show this help\n\nEnvironment fallbacks:\n  XIAOAN_CDP_PORT, XIAOAN_QA_DIR\n`);
}

function readOption(argv, name) {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const known = new Set(["--port", "--output-dir"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const name = argument.split("=", 1)[0];
    if (!known.has(name)) throw new Error(`Unknown option: ${name}`);
    if (!argument.includes("=")) index += 1;
  }

  const portText = readOption(argv, "--port") || process.env.XIAOAN_CDP_PORT || String(DEFAULT_PORT);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid CDP port: ${portText}`);

  const outputDir = path.resolve(
    readOption(argv, "--output-dir")
      || process.env.XIAOAN_QA_DIR
      || "qa/station-advisor-v1.5.2-electron",
  );
  return { help: false, port, outputDir };
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

const cdpUrl = `http://127.0.0.1:${options.port}`;
const reportPath = path.join(options.outputDir, "station-advisor-v1.5.2-electron-report.json");
await fs.mkdir(options.outputDir, { recursive: true });

const report = {
  schemaVersion: 1,
  suite: "station-advisor-v1.5.2-packaged-electron-cdp",
  generatedAt: new Date().toISOString(),
  parameters: {
    port: options.port,
    cdpUrl,
    outputDir: options.outputDir,
  },
  target: null,
  page: null,
  initial: {
    observations: [],
    autoListeningObserved: false,
    readyState: null,
  },
  interaction: {
    recommendedQuestion: ORDINARY_QUESTION,
    clickedQuestion: null,
    clickedAt: null,
    conversationReached: false,
    responseTitle: "",
    responseBody: "",
  },
  sampling: {
    intervalTargetMs: SAMPLE_INTERVAL_MS,
    startedAt: null,
    finishedAt: null,
    sampleCount: 0,
    durationMs: 0,
    firstSpeakingMs: null,
    observedAvatarStates: [],
    observedVisemes: [],
    observedVisemeTargets: [],
    observedAlignmentProviders: [],
    observedBlinkPhases: [],
    observedExpressions: [],
    observedLocalRigs: [],
    rigReadyObserved: false,
    rigErrorObserved: false,
    maxJawOpen: 0,
    blinkTelemetryObserved: false,
    openMouthTelemetryEvidence: null,
    speakingFrameEvidence: null,
    visualMouthGate: {
      minMeanAbsoluteRgbDelta: MIN_MOUTH_MEAN_RGB_DELTA,
      minChangedSampleRatio: MIN_MOUTH_CHANGED_SAMPLE_RATIO,
      passed: false,
    },
    samples: [],
  },
  screenshots: {
    initialFullPage: null,
    initialMouthReference: null,
    initialMouthCrop: null,
    speakingFullPage: null,
    openMouthCropSource: null,
    openMouthCloseup: null,
    openMouthCrop: null,
    afterInterruptFullPage: null,
  },
  interrupt: {
    controlLabel: INTERRUPT_LABEL,
    clickedDuringSpeaking: false,
    clickedAt: null,
    stateBeforeClick: null,
    jawSettled: false,
    jawReturnedToZero: false,
    jawZeroTolerance: JAW_ZERO_TOLERANCE,
    jawSettledAtMs: null,
    jawAfterRecovery: null,
    autoListeningRecovered: false,
    recoveredAtMs: null,
    recoveredState: null,
  },
  console: {
    warnings: [],
    errors: [],
    exceptions: [],
    crashes: [],
  },
  notes: [],
  failures: [],
  result: "RUNNING",
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url, timeoutMs = 6_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", ({ data }) => this.handleMessage(data));
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("CDP WebSocket closed"));
      this.pending.clear();
    });
  }

  static async connect(webSocketDebuggerUrl, timeoutMs = 8_000) {
    if (typeof WebSocket !== "function") throw new Error("This Node runtime does not provide global WebSocket support");
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Electron CDP WebSocket")), timeoutMs);
      const finish = (callback) => (event) => {
        clearTimeout(timer);
        callback(event);
      };
      socket.addEventListener("open", finish(resolve), { once: true });
      socket.addEventListener("error", finish(() => reject(new Error("Electron CDP WebSocket connection failed"))), { once: true });
    });
    return new CdpClient(socket);
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.id) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
      return;
    }
    const handlers = this.listeners.get(message.method) || [];
    for (const handler of handlers) {
      try {
        handler(message.params || {});
      } catch {
        // Evidence collection must not break the acceptance flow.
      }
    }
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  send(method, params = {}, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // The target may already be gone; the report is still useful.
    }
  }
}

function remoteValuePreview(argument) {
  if (Object.prototype.hasOwnProperty.call(argument || {}, "value")) {
    try {
      return typeof argument.value === "string" ? argument.value : JSON.stringify(argument.value);
    } catch {
      return String(argument.value);
    }
  }
  return argument?.description || argument?.unserializableValue || argument?.type || "";
}

function addConsoleListeners(client) {
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type !== "warning" && event.type !== "error") return;
    const destination = event.type === "warning" ? report.console.warnings : report.console.errors;
    destination.push({
      source: "Runtime.consoleAPICalled",
      type: event.type,
      timestamp: event.timestamp || null,
      text: (event.args || []).map(remoteValuePreview).filter(Boolean).join(" "),
      stackTrace: event.stackTrace || null,
    });
  });
  client.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level !== "warning" && entry?.level !== "error") return;
    const destination = entry.level === "warning" ? report.console.warnings : report.console.errors;
    destination.push({
      source: "Log.entryAdded",
      type: entry.level,
      timestamp: entry.timestamp || null,
      text: entry.text || "",
      url: entry.url || "",
      lineNumber: entry.lineNumber ?? null,
    });
  });
  client.on("Runtime.exceptionThrown", ({ timestamp, exceptionDetails }) => {
    report.console.exceptions.push({
      timestamp: timestamp || null,
      text: exceptionDetails?.exception?.description || exceptionDetails?.text || "Unhandled renderer exception",
      url: exceptionDetails?.url || "",
      lineNumber: exceptionDetails?.lineNumber ?? null,
      columnNumber: exceptionDetails?.columnNumber ?? null,
    });
  });
  client.on("Inspector.targetCrashed", (event) => report.console.crashes.push({ timestamp: Date.now(), ...event }));
}

async function evaluate(client, expression, timeoutMs = 15_000) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

const READ_UI_STATE = `(() => {
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() || '';
  const shell = document.querySelector('.advisor-shell');
  const avatar = document.querySelector('.station-advisor-digital-human');
  const composer = document.querySelector('.advisor-composer');
  const microphone = document.querySelector('.advisor-composer__mic');
  const avatarStyle = avatar ? getComputedStyle(avatar) : null;
  const rect = avatar?.getBoundingClientRect();
  let mouthClip = null;
  if (rect?.width && rect?.height) {
    const raw = {
      x: rect.left + rect.width * .37,
      y: rect.top + rect.width * .43,
      width: rect.width * .26,
      height: rect.width * .20,
    };
    const x = Math.max(0, raw.x);
    const y = Math.max(0, raw.y);
    mouthClip = {
      x,
      y,
      width: Math.max(1, Math.min(raw.width, innerWidth - x)),
      height: Math.max(1, Math.min(raw.height, innerHeight - y)),
    };
  }
  return {
    capturedAtEpochMs: Date.now(),
    performanceMs: performance.now(),
    title: document.title,
    url: location.href,
    protocol: location.protocol,
    readyState: document.readyState,
    shellPresent: Boolean(shell),
    shellClass: shell?.className || '',
    avatarPresent: Boolean(avatar),
    avatar: avatar ? {
      state: avatar.dataset.avatarState || '',
      dataSpeaking: avatar.dataset.speaking || '',
      mode: avatar.dataset.avatarMode || '',
      viseme: avatar.dataset.viseme || '',
      visemeTarget: avatar.dataset.visemeTarget || '',
      visemeCurrent: avatar.dataset.visemeCurrent || '',
      visemeNext: avatar.dataset.visemeNext || '',
      visemeBlend: number(avatar.dataset.visemeBlend),
      alignment: avatar.dataset.visemeAlignment || '',
      jawOpen: number(avatar.dataset.jawOpen),
      cssJawOpen: number(avatarStyle?.getPropertyValue('--jaw-open')),
      mouthOpen: number(avatarStyle?.getPropertyValue('--mouth-open')),
      blinkPhase: avatar.dataset.blinkPhase || '',
      blinkProgress: number(avatarStyle?.getPropertyValue('--blink-progress')),
      blinkWaitMs: number(avatar.dataset.blinkWaitMs),
      expression: avatar.dataset.expression || '',
      semanticExpression: avatar.dataset.semanticExpression || '',
      rigReady: avatar.dataset.rigReady || '',
      rigError: avatar.dataset.rigError || '',
      localRig: avatar.dataset.localRig || '',
      motionPhase: avatar.dataset.motionPhase || '',
      motionSource: avatar.dataset.motionSource || '',
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      mouthClip,
    } : null,
    composer: {
      present: Boolean(composer),
      listeningClass: Boolean(composer?.classList.contains('is-listening')),
      micLabel: microphone?.getAttribute('aria-label') || '',
      micPressed: microphone?.getAttribute('aria-pressed') || '',
      mode: text('.advisor-composer__mode > strong'),
      status: text('.advisor-composer__field > small > span[aria-hidden="true"]'),
      inputValue: document.querySelector('[aria-label="站点咨询问题"]')?.value || '',
    },
    presence: {
      label: text('.advisor-presence small'),
      status: text('.advisor-presence strong'),
    },
    conversation: {
      present: Boolean(document.querySelector('.advisor-conversation-panel')),
      title: text('.advisor-conversation-heading h1'),
      body: text('.advisor-answer-card p'),
    },
  };
})()`;

function isListeningReady(state) {
  if (!state?.composer?.listeningClass || state.composer.micLabel !== "暂停自动聆听") return false;
  if (!state.composer.mode.includes("自动聆听")) return false;
  return !state.composer.status.includes("正在打开麦克风");
}

function compactSample(state, relativeMs) {
  return {
    timeMs: +relativeMs.toFixed(1),
    capturedAtEpochMs: state.capturedAtEpochMs,
    screen: state.shellClass,
    avatarState: state.avatar?.state || "",
    dataSpeaking: state.avatar?.dataSpeaking || "",
    avatarMode: state.avatar?.mode || "",
    viseme: state.avatar?.viseme || "",
    visemeTarget: state.avatar?.visemeTarget || "",
    visemeCurrent: state.avatar?.visemeCurrent || "",
    visemeNext: state.avatar?.visemeNext || "",
    visemeBlend: state.avatar?.visemeBlend ?? null,
    alignment: state.avatar?.alignment || "",
    jawOpen: state.avatar?.jawOpen ?? null,
    cssJawOpen: state.avatar?.cssJawOpen ?? null,
    mouthOpen: state.avatar?.mouthOpen ?? null,
    blinkPhase: state.avatar?.blinkPhase || "",
    blinkProgress: state.avatar?.blinkProgress ?? null,
    blinkWaitMs: state.avatar?.blinkWaitMs ?? null,
    expression: state.avatar?.expression || "",
    semanticExpression: state.avatar?.semanticExpression || "",
    rigReady: state.avatar?.rigReady || "",
    rigError: state.avatar?.rigError || "",
    localRig: state.avatar?.localRig || "",
    motionPhase: state.avatar?.motionPhase || "",
    motionSource: state.avatar?.motionSource || "",
    composerListening: state.composer?.listeningClass || false,
    micLabel: state.composer?.micLabel || "",
    composerMode: state.composer?.mode || "",
    composerStatus: state.composer?.status || "",
  };
}

async function captureFullPage(client, filename) {
  const metrics = await client.send("Page.getLayoutMetrics");
  const content = metrics.cssContentSize || metrics.contentSize;
  const layoutViewport = metrics.cssLayoutViewport || metrics.layoutViewport;
  const visualViewport = metrics.cssVisualViewport || metrics.visualViewport;
  const captureViewport = visualViewport || layoutViewport || content;
  const x = Number(captureViewport?.pageX ?? captureViewport?.x ?? 0);
  const y = Number(captureViewport?.pageY ?? captureViewport?.y ?? 0);
  const width = Number(captureViewport?.clientWidth ?? captureViewport?.width ?? 0);
  const height = Number(captureViewport?.clientHeight ?? captureViewport?.height ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
    throw new Error("Full-page CSS dimensions are unavailable");
  }

  // Electron 37 may ignore non-zero CDP clip x/y. Capture the complete kiosk
  // frame without a CDP clip; the mouth crop is applied to this PNG later.
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  }, 25_000);
  const outputPath = path.join(options.outputDir, filename);
  await fs.writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 64) throw new Error(`Full-page PNG was not written: ${filename}`);
  return {
    outputPath,
    cssPageBounds: { x, y, width, height },
    cssLayoutViewport: layoutViewport || null,
    cssVisualViewport: visualViewport || null,
  };
}

function viewportClipToPageClip(viewportClip, capture) {
  if (!viewportClip || viewportClip.width <= 1 || viewportClip.height <= 1) {
    throw new Error("Open-mouth CSS clip is unavailable");
  }
  const viewport = capture.cssVisualViewport || capture.cssLayoutViewport || {};
  const pageX = Number(viewport.pageX ?? capture.cssLayoutViewport?.pageX ?? 0);
  const pageY = Number(viewport.pageY ?? capture.cssLayoutViewport?.pageY ?? 0);
  const pageClip = {
    x: Number(viewportClip.x) + pageX,
    y: Number(viewportClip.y) + pageY,
    width: Number(viewportClip.width),
    height: Number(viewportClip.height),
  };
  if (Object.values(pageClip).some((value) => !Number.isFinite(value)) || pageClip.width <= 1 || pageClip.height <= 1) {
    throw new Error("Open-mouth page coordinates are invalid");
  }
  return pageClip;
}

async function cropPngWithSystemDrawing({ sourcePath, outputFilename, viewportClip, capture, referencePath = "" }) {
  const outputPath = path.join(options.outputDir, outputFilename);
  const pageClip = viewportClipToPageClip(viewportClip, capture);
  const page = capture.cssPageBounds;
  const numberArgument = (value, label) => {
    if (!Number.isFinite(value)) throw new Error(`Invalid ${label}: ${value}`);
    return value.toFixed(6);
  };
  const argumentsList = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    cropPngScript,
    "-InputPath",
    sourcePath,
    "-OutputPath",
    outputPath,
    "-CssX",
    numberArgument(pageClip.x, "CSS crop x"),
    "-CssY",
    numberArgument(pageClip.y, "CSS crop y"),
    "-CssWidth",
    numberArgument(pageClip.width, "CSS crop width"),
    "-CssHeight",
    numberArgument(pageClip.height, "CSS crop height"),
    "-CssPageX",
    numberArgument(page.x, "CSS page x"),
    "-CssPageY",
    numberArgument(page.y, "CSS page y"),
    "-CssPageWidth",
    numberArgument(page.width, "CSS page width"),
    "-CssPageHeight",
    numberArgument(page.height, "CSS page height"),
  ];
  if (referencePath) argumentsList.push("-ReferencePath", referencePath);
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(powershellExecutable, argumentsList, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      shell: false,
      windowsHide: true,
    }));
  } catch (error) {
    const detail = [errorMessage(error), error?.stderr, error?.stdout].filter(Boolean).join(" | ");
    throw new Error(`System.Drawing mouth crop failed: ${detail}`);
  }
  const outputLines = String(stdout || "").replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  let cropResult;
  try {
    cropResult = JSON.parse(outputLines.at(-1) || "");
  } catch {
    throw new Error(`System.Drawing mouth crop returned invalid JSON: ${String(stdout || stderr || "no output").trim()}`);
  }
  if (cropResult?.ok !== true) throw new Error("System.Drawing mouth crop did not report success");
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 64) throw new Error("System.Drawing mouth crop PNG was not written");
  return { outputPath, crop: cropResult };
}

async function clickPoint(client, point) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function recommendedQuestionPoint(client) {
  return evaluate(client, `(() => {
    const expected = ${JSON.stringify(ORDINARY_QUESTION)};
    const buttons = [...document.querySelectorAll('.advisor-home-questions button')];
    const button = buttons.find((candidate) => candidate.textContent.replace(/\\s+/g, ' ').trim() === expected);
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button.getBoundingClientRect();
    return {
      label: button.textContent.replace(/\\s+/g, ' ').trim(),
      disabled: Boolean(button.disabled),
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  })()`);
}

async function interruptPoint(client) {
  return evaluate(client, `(() => {
    const button = document.querySelector('.advisor-composer__mic[aria-label=${JSON.stringify(INTERRUPT_LABEL)}]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return {
      label: button.getAttribute('aria-label') || '',
      disabled: Boolean(button.disabled),
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  })()`);
}

function stateForReport(state) {
  if (!state) return null;
  return {
    capturedAtEpochMs: state.capturedAtEpochMs,
    shellClass: state.shellClass,
    avatar: state.avatar,
    composer: state.composer,
    presence: state.presence,
    conversation: state.conversation,
  };
}

async function writeReport() {
  report.generatedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

let client;
let exitCode = 0;
try {
  const targets = await fetchJson(`${cdpUrl}/json/list`);
  const pages = Array.isArray(targets) ? targets.filter((target) => target.type === "page") : [];
  const target = pages.find((candidate) => /站点咨询顾问/.test(candidate.title || "")) || pages[0];
  if (!target?.webSocketDebuggerUrl) throw new Error(`No Electron page target found at ${cdpUrl}`);
  report.target = {
    id: target.id || "",
    title: target.title || "",
    url: target.url || "",
    type: target.type || "",
  };

  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  addConsoleListeners(client);
  await Promise.all([
    client.send("Runtime.enable"),
    client.send("Log.enable"),
    client.send("Page.enable"),
    client.send("Inspector.enable"),
  ]);
  await client.send("Page.bringToFront");
  await client.send("Page.reload", { ignoreCache: true });

  let initialState = null;
  const domDeadline = performance.now() + DOM_TIMEOUT_MS;
  while (performance.now() < domDeadline) {
    initialState = await evaluate(client, READ_UI_STATE);
    if (initialState?.shellPresent && initialState?.avatarPresent && initialState?.composer?.present) break;
    await wait(100);
  }
  if (!initialState?.shellPresent || !initialState?.avatarPresent || !initialState?.composer?.present) {
    throw new Error("StationAdvisor DOM did not become ready after reload");
  }

  const runtime = await evaluate(client, `(async () => {
    try {
      return await window.kioskBridge?.runtimeStatus?.();
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  })()`);
  report.page = {
    title: initialState.title,
    url: initialState.url,
    protocol: initialState.protocol,
    packagedUrl: runtime?.packaged === true && initialState.protocol === "file:" ? initialState.url : null,
    readyState: initialState.readyState,
    stationAdvisorDom: {
      shell: initialState.shellPresent,
      avatar: initialState.avatarPresent,
      composer: initialState.composer.present,
    },
    runtime: runtime || null,
  };

  if (initialState.title !== EXPECTED_TITLE) report.failures.push(`unexpected-title:${initialState.title || "missing"}`);
  if (!initialState.shellPresent || !initialState.avatarPresent || !initialState.composer.present) report.failures.push("station-advisor-dom-missing");
  if (initialState.protocol !== "file:") report.failures.push(`not-packaged-url:${initialState.url || "missing"}`);
  if (runtime?.packaged !== true) report.failures.push("runtime-not-packaged");
  if (runtime?.version && runtime.version !== "1.5.2") report.failures.push(`unexpected-runtime-version:${runtime.version}`);

  const initialListenDeadline = performance.now() + INITIAL_LISTEN_TIMEOUT_MS;
  while (performance.now() < initialListenDeadline) {
    const state = await evaluate(client, READ_UI_STATE);
    report.initial.observations.push({
      timeMs: +Math.max(0, INITIAL_LISTEN_TIMEOUT_MS - (initialListenDeadline - performance.now())).toFixed(1),
      composerListening: state.composer.listeningClass,
      micLabel: state.composer.micLabel,
      mode: state.composer.mode,
      status: state.composer.status,
      presence: state.presence,
    });
    if (isListeningReady(state)) {
      report.initial.autoListeningObserved = true;
      report.initial.readyState = stateForReport(state);
      initialState = state;
      break;
    }
    await wait(125);
  }
  if (!report.initial.autoListeningObserved) {
    initialState = await evaluate(client, READ_UI_STATE);
    report.initial.readyState = stateForReport(initialState);
    report.failures.push("initial-auto-listening-not-ready");
  }
  const initialCapture = await captureFullPage(client, "00-initial-full-page.png");
  report.screenshots.initialFullPage = initialCapture.outputPath;
  const initialMouthReference = await cropPngWithSystemDrawing({
    sourcePath: initialCapture.outputPath,
    outputFilename: "00-initial-mouth-reference.png",
    viewportClip: initialState.avatar?.mouthClip,
    capture: initialCapture,
  });
  report.screenshots.initialMouthReference = initialMouthReference.outputPath;
  report.screenshots.initialMouthCrop = initialMouthReference.crop;

  const question = await recommendedQuestionPoint(client);
  if (!question) throw new Error(`Ordinary recommendation not found: ${ORDINARY_QUESTION}`);
  if (question.disabled) throw new Error(`Ordinary recommendation is disabled: ${question.label}`);
  if (/会员|积分|本人|身份/.test(question.label)) throw new Error(`Refusing to use sensitive recommendation: ${question.label}`);

  const traceStart = performance.now();
  report.sampling.startedAt = new Date().toISOString();
  report.interaction.clickedQuestion = question.label;
  report.interaction.clickedAt = new Date().toISOString();
  await clickPoint(client, question);

  const avatarStates = new Set();
  const visemes = new Set();
  const visemeTargets = new Set();
  const alignmentProviders = new Set();
  const blinkPhases = new Set();
  const expressions = new Set();
  const localRigs = new Set();
  let firstSpeakingAt = 0;
  let interruptAt = 0;
  let speakingScreenshotPromise = null;
  let speakingCropReady = false;
  const screenshotErrors = [];
  let lastState = null;
  const deadline = traceStart + SPEECH_AND_INTERRUPT_TIMEOUT_MS;

  while (performance.now() < deadline) {
    const state = await evaluate(client, READ_UI_STATE);
    lastState = state;
    const now = performance.now();
    const relativeMs = now - traceStart;
    report.sampling.samples.push(compactSample(state, relativeMs));

    if (state.conversation.present) {
      report.interaction.conversationReached = true;
      report.interaction.responseTitle = state.conversation.title;
      report.interaction.responseBody = state.conversation.body;
    }

    if (state.avatar?.state) avatarStates.add(state.avatar.state);
    if (state.avatar?.viseme) visemes.add(state.avatar.viseme);
    if (state.avatar?.visemeTarget) visemeTargets.add(state.avatar.visemeTarget);
    if (state.avatar?.alignment) alignmentProviders.add(state.avatar.alignment);
    if (state.avatar?.blinkPhase) blinkPhases.add(state.avatar.blinkPhase);
    if (state.avatar?.expression) expressions.add(state.avatar.expression);
    if (state.avatar?.localRig) localRigs.add(state.avatar.localRig);
    if (state.avatar?.rigReady === "true") report.sampling.rigReadyObserved = true;
    if (state.avatar?.rigError === "true") report.sampling.rigErrorObserved = true;
    if (state.avatar?.blinkProgress !== null && state.avatar?.blinkWaitMs !== null) report.sampling.blinkTelemetryObserved = true;
    report.sampling.maxJawOpen = Math.max(report.sampling.maxJawOpen, state.avatar?.jawOpen || 0);

    const speaking = state.avatar?.state === "speaking" && state.avatar?.dataSpeaking === "true";
    if (speaking && !firstSpeakingAt) {
      firstSpeakingAt = now;
      report.sampling.firstSpeakingMs = +relativeMs.toFixed(1);
      const captureRequestTelemetry = compactSample(state, relativeMs);
      const speakingMouthViewportRect = { ...state.avatar.mouthClip };
      speakingScreenshotPromise = (async () => {
        const capture = await captureFullPage(client, "10-speaking-full-page.png");
        report.screenshots.speakingFullPage = capture.outputPath;
        report.screenshots.openMouthCropSource = capture.outputPath;
        const cropped = await cropPngWithSystemDrawing({
          sourcePath: capture.outputPath,
          outputFilename: "10-speaking-mouth-closeup.png",
          viewportClip: speakingMouthViewportRect,
          capture,
          referencePath: report.screenshots.initialMouthReference,
        });
        report.screenshots.openMouthCloseup = cropped.outputPath;
        report.screenshots.openMouthCrop = cropped.crop;
        const comparison = cropped.crop.comparison || null;
        const meanDelta = Number(comparison?.meanAbsoluteRgbDelta);
        const changedRatio = Number(comparison?.changedSampleRatio);
        report.sampling.visualMouthGate.meanAbsoluteRgbDelta = Number.isFinite(meanDelta) ? +meanDelta.toFixed(4) : null;
        report.sampling.visualMouthGate.changedSampleRatio = Number.isFinite(changedRatio) ? +changedRatio.toFixed(4) : null;
        report.sampling.visualMouthGate.passed = Number.isFinite(meanDelta)
          && Number.isFinite(changedRatio)
          && meanDelta >= MIN_MOUTH_MEAN_RGB_DELTA
          && changedRatio >= MIN_MOUTH_CHANGED_SAMPLE_RATIO;
        report.sampling.speakingFrameEvidence = {
          captureRequestTelemetry,
          mouthViewportRect: speakingMouthViewportRect,
          mouthPageRect: cropped.crop.requestedCssRect || null,
          sourceFullPage: capture.outputPath,
          closeup: cropped.outputPath,
          pixelComparison: comparison,
        };
        speakingCropReady = true;
      })()
        .catch((error) => screenshotErrors.push(`speaking-full-page:${errorMessage(error)}`));
    }

    const jawOpen = state.avatar?.jawOpen || 0;
    const openViseme = state.avatar?.viseme && state.avatar.viseme !== "CLOSED";
    if (speaking && jawOpen >= OPEN_JAW_THRESHOLD && openViseme && !report.sampling.openMouthTelemetryEvidence) {
      report.sampling.openMouthTelemetryEvidence = compactSample(state, relativeMs);
    }

    const speakingElapsed = firstSpeakingAt ? now - firstSpeakingAt : 0;
    const enoughSpeechEvidence = speakingCropReady
      && report.sampling.openMouthTelemetryEvidence
      && (visemes.size >= 3 || speakingElapsed >= 1_800);
    if (!interruptAt && speaking && enoughSpeechEvidence && state.composer.micLabel === INTERRUPT_LABEL) {
      const point = await interruptPoint(client);
      if (!point || point.disabled || point.label !== INTERRUPT_LABEL) {
        report.failures.push("interrupt-control-unavailable-during-speech");
        break;
      }
      report.interrupt.stateBeforeClick = stateForReport(state);
      report.interrupt.clickedAt = new Date().toISOString();
      report.interrupt.clickedDuringSpeaking = true;
      await clickPoint(client, point);
      interruptAt = performance.now();
    }

    if (interruptAt) {
      const afterInterruptMs = now - interruptAt;
      const jawSettled = state.avatar?.state !== "speaking" && (state.avatar?.jawOpen ?? 1) <= JAW_ZERO_TOLERANCE;
      if (jawSettled && !report.interrupt.jawSettled) {
        report.interrupt.jawSettled = true;
        report.interrupt.jawReturnedToZero = true;
        report.interrupt.jawSettledAtMs = +afterInterruptMs.toFixed(1);
        report.interrupt.jawAfterRecovery = state.avatar?.jawOpen ?? null;
      }
      if (isListeningReady(state) && !report.interrupt.autoListeningRecovered) {
        report.interrupt.autoListeningRecovered = true;
        report.interrupt.recoveredAtMs = +afterInterruptMs.toFixed(1);
        report.interrupt.recoveredState = stateForReport(state);
      }
      if (report.interrupt.jawSettled && report.interrupt.autoListeningRecovered && afterInterruptMs >= 250) break;
    }

    await wait(SAMPLE_INTERVAL_MS);
  }

  await Promise.allSettled([speakingScreenshotPromise].filter(Boolean));
  for (const screenshotError of screenshotErrors) report.failures.push(`screenshot-failed:${screenshotError}`);
  const afterInterruptCapture = await captureFullPage(client, "20-after-interrupt-full-page.png");
  report.screenshots.afterInterruptFullPage = afterInterruptCapture.outputPath;
  report.sampling.finishedAt = new Date().toISOString();
  report.sampling.sampleCount = report.sampling.samples.length;
  report.sampling.durationMs = +(performance.now() - traceStart).toFixed(1);
  report.sampling.observedAvatarStates = [...avatarStates];
  report.sampling.observedVisemes = [...visemes];
  report.sampling.observedVisemeTargets = [...visemeTargets];
  report.sampling.observedAlignmentProviders = [...alignmentProviders];
  report.sampling.observedBlinkPhases = [...blinkPhases];
  report.sampling.observedExpressions = [...expressions];
  report.sampling.observedLocalRigs = [...localRigs];
  report.sampling.maxJawOpen = +report.sampling.maxJawOpen.toFixed(3);

  if (!report.interaction.conversationReached || !report.interaction.responseTitle || !report.interaction.responseBody) {
    report.failures.push("ordinary-recommendation-did-not-open-answer");
  }
  if (!firstSpeakingAt) report.failures.push("tts-speaking-state-not-observed");
  if (report.sampling.maxJawOpen < OPEN_JAW_THRESHOLD) report.failures.push(`jaw-did-not-open:max=${report.sampling.maxJawOpen}`);
  if (![...visemes].some((viseme) => viseme && viseme !== "CLOSED")) report.failures.push("open-viseme-not-observed");
  if (![...alignmentProviders].some((provider) => provider && provider !== "none")) report.failures.push("viseme-alignment-not-observed");
  if (!report.sampling.rigReadyObserved || !localRigs.has("local-mouth-chin-v2")) report.failures.push("local-rig-not-ready");
  if (report.sampling.rigErrorObserved) report.failures.push("local-rig-error-observed");
  if (!report.sampling.blinkTelemetryObserved) report.failures.push("blink-telemetry-missing");
  if (!blinkPhases.size) report.notes.push("No non-idle blink phase occurred in this short interaction; blink telemetry remained available.");
  if (!report.sampling.openMouthTelemetryEvidence) report.failures.push("open-mouth-jaw-viseme-telemetry-missing");
  if (!report.screenshots.initialMouthReference || !report.screenshots.initialMouthCrop) {
    report.failures.push("initial-closed-mouth-reference-incomplete");
  }
  if (!report.screenshots.speakingFullPage
    || report.screenshots.openMouthCropSource !== report.screenshots.speakingFullPage
    || !report.screenshots.openMouthCloseup
    || !report.screenshots.openMouthCrop
    || !report.sampling.speakingFrameEvidence) {
    report.failures.push("speaking-frame-crop-evidence-incomplete");
  }
  if (!report.sampling.visualMouthGate.passed) {
    report.failures.push(`speaking-frame-mouth-pixel-difference-too-low:mean=${report.sampling.visualMouthGate.meanAbsoluteRgbDelta ?? "missing"},ratio=${report.sampling.visualMouthGate.changedSampleRatio ?? "missing"}`);
  }
  if (!report.interrupt.clickedDuringSpeaking) report.failures.push("answer-was-not-interrupted-during-speech");
  if (!report.interrupt.jawSettled) {
    report.interrupt.jawAfterRecovery = lastState?.avatar?.jawOpen ?? null;
    report.failures.push(`jaw-did-not-settle-after-interrupt:last=${report.interrupt.jawAfterRecovery}`);
  }
  if (!report.interrupt.autoListeningRecovered) report.failures.push("auto-listening-did-not-recover-after-interrupt");
  if (report.console.errors.length || report.console.exceptions.length || report.console.crashes.length) {
    report.failures.push(`renderer-errors:${report.console.errors.length + report.console.exceptions.length + report.console.crashes.length}`);
  }

  report.result = report.failures.length ? "FAIL" : "PASS";
  exitCode = report.failures.length ? 1 : 0;
} catch (error) {
  report.fatalError = {
    message: errorMessage(error),
    stack: error instanceof Error ? error.stack || "" : "",
  };
  report.failures.push(`runner-error:${errorMessage(error)}`);
  report.result = "FAIL";
  exitCode = 1;
} finally {
  client?.close();
  try {
    await writeReport();
  } catch (error) {
    process.stderr.write(`Failed to write JSON report: ${errorMessage(error)}\n`);
    exitCode = 1;
  }
}

process.stdout.write(`${JSON.stringify({
  result: report.result,
  reportPath,
  failures: report.failures,
  warningCount: report.console.warnings.length,
  errorCount: report.console.errors.length + report.console.exceptions.length + report.console.crashes.length,
  sampleCount: report.sampling.sampleCount,
  screenshots: report.screenshots,
}, null, 2)}\n`);
process.exitCode = exitCode;
