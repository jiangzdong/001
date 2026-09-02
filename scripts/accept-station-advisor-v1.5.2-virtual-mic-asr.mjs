import fs from "node:fs/promises";
import path from "node:path";

const EXPECTED_TITLE = "小安站点咨询顾问 V1.5.2";
const EXPECTED_VERSION = "1.5.2";
const EXPECTED_SPEECH_PROVIDER = "sherpa-onnx";
const INFERRED_FINAL_PROVIDER = "sherpa-onnx-sensevoice-local";
const DEFAULT_PORT = 9232;
const DEFAULT_OUTPUT_DIR = "qa/station-advisor-v1.5.2-virtual-mic-asr";
const DOM_TIMEOUT_MS = 15_000;
const FLOW_TIMEOUT_MS = 65_000;
const POLL_INTERVAL_MS = 40;
const AUDIT_KEY = "__xiaoanVirtualMicAsrAuditV152";

function printUsage() {
  process.stdout.write(`Usage: node scripts/accept-station-advisor-v1.5.2-virtual-mic-asr.mjs [options]\n\nOptions:\n  --port <port>             Existing packaged Electron CDP port (default: ${DEFAULT_PORT})\n  --output-dir <directory>  JSON and full-page screenshot directory\n  --help                    Show this help\n\nThe runner only connects to an existing Electron target. It reloads the page and never dispatches mouse, touch, or keyboard input.\n`);
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
    if (!argument.startsWith("--")) throw new Error(`Unexpected positional argument: ${argument}`);
    const name = argument.split("=", 1)[0];
    if (!known.has(name)) throw new Error(`Unknown option: ${name}`);
    if (!argument.includes("=")) index += 1;
  }
  const portText = readOption(argv, "--port") || String(DEFAULT_PORT);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid CDP port: ${portText}`);
  const outputDir = path.resolve(readOption(argv, "--output-dir") || DEFAULT_OUTPUT_DIR);
  return { help: false, port, outputDir };
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

const cdpUrl = `http://127.0.0.1:${options.port}`;
const reportPath = path.join(options.outputDir, "station-advisor-v1.5.2-virtual-mic-asr-report.json");
const screenshotPath = path.join(options.outputDir, "station-advisor-v1.5.2-virtual-mic-asr-full-page.png");
await fs.mkdir(options.outputDir, { recursive: true });

const report = {
  schemaVersion: 1,
  suite: "station-advisor-v1.5.2-packaged-electron-virtual-mic-asr",
  generatedAt: new Date().toISOString(),
  parameters: { port: options.port, cdpUrl, outputDir: options.outputDir },
  runnerPolicy: {
    startsElectron: false,
    reloadsTarget: true,
    dispatchesInputEvents: false,
    allowedCdpActions: ["Page.reload", "Runtime.evaluate", "Page.captureScreenshot"],
  },
  target: null,
  page: null,
  runtime: null,
  speech: null,
  mediaDevices: [],
  milestones: {
    autoListening: null,
    transcription: null,
    recognizing: null,
    countdown: null,
    answer: null,
  },
  flow: {
    transitions: [],
    trustedUserInputEvents: [],
    trustedClickCount: 0,
    trustedInputCount: 0,
    conversationEntryCount: 0,
    autoSubmitDelayMs: null,
    ordinaryText: null,
    noUserInteraction: false,
    offlineFinalAutoSent: false,
  },
  offlineEvidence: {
    packagedFilePage: false,
    localBridgeAvailable: false,
    speechReady: false,
    speechOffline: false,
    speechProvider: null,
    webSpeechOptIn: false,
    inferredFinalProvider: INFERRED_FINAL_PROVIDER,
    inference: "In the packaged file:// route, an ordinary result can enter countdown without a confidence score only through the trusted sherpa-onnx-sensevoice-local final-result contract.",
  },
  console: { warnings: [], errors: [], exceptions: [], crashes: [] },
  network: { requests: [], remoteSpeechRequests: [] },
  screenshots: { finalFullPage: null },
  failures: [],
  result: "RUNNING",
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const errorMessage = (error) => error instanceof Error ? error.message : String(error);

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
    if (typeof WebSocket !== "function") throw new Error("Node runtime must provide global WebSocket support");
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Electron CDP WebSocket")), timeoutMs);
      const finish = (callback) => (event) => { clearTimeout(timer); callback(event); };
      socket.addEventListener("open", finish(resolve), { once: true });
      socket.addEventListener("error", finish(() => reject(new Error("Electron CDP WebSocket connection failed"))), { once: true });
    });
    return new CdpClient(socket);
  }

  handleMessage(data) {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.id) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
      return;
    }
    for (const handler of this.listeners.get(message.method) || []) {
      try { handler(message.params || {}); } catch { /* Evidence listeners must not stop the flow. */ }
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
    try { this.socket.close(); } catch { /* The report remains useful if the target closed first. */ }
  }
}

function remoteValuePreview(argument) {
  if (Object.prototype.hasOwnProperty.call(argument || {}, "value")) {
    try { return typeof argument.value === "string" ? argument.value : JSON.stringify(argument.value); }
    catch { return String(argument.value); }
  }
  return argument?.description || argument?.unserializableValue || argument?.type || "";
}

function addEvidenceListeners(client) {
  client.on("Runtime.consoleAPICalled", (event) => {
    if (!new Set(["warning", "error"]).has(event.type)) return;
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
    if (!entry || !new Set(["warning", "error"]).has(entry.level)) return;
    const destination = entry.level === "warning" ? report.console.warnings : report.console.errors;
    destination.push({ source: "Log.entryAdded", type: entry.level, timestamp: entry.timestamp || null, text: entry.text || "", url: entry.url || "", lineNumber: entry.lineNumber ?? null });
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
  client.on("Network.requestWillBeSent", ({ request, type, timestamp }) => {
    if (!request?.url || report.network.requests.length >= 500) return;
    const item = { timestamp: timestamp || null, type: type || "", method: request.method || "", url: request.url };
    report.network.requests.push(item);
    if (/^https?:/i.test(request.url) && /(speech|recogn|asr|transcri)/i.test(request.url)) report.network.remoteSpeechRequests.push(item);
  });
}

async function evaluate(client, expression, timeoutMs = 15_000) {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime.evaluate failed");
  return response.result?.value;
}

const READ_UI_STATE = `(() => {
  const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() || '';
  const shell = document.querySelector('.advisor-shell');
  const composer = document.querySelector('.advisor-composer');
  const mic = document.querySelector('.advisor-composer__mic');
  const input = document.querySelector('[aria-label="站点咨询问题"]');
  return {
    capturedAtEpochMs: Date.now(),
    readyState: document.readyState,
    title: document.title,
    url: location.href,
    protocol: location.protocol,
    search: location.search,
    shellPresent: Boolean(shell),
    screenClass: shell?.className || '',
    composerPresent: Boolean(composer),
    listeningClass: Boolean(composer?.classList.contains('is-listening')),
    micLabel: mic?.getAttribute('aria-label') || '',
    micPressed: mic?.getAttribute('aria-pressed') || '',
    mode: text('.advisor-composer__mode > strong'),
    status: text('.advisor-composer__field > small > span[aria-hidden="true"]'),
    inputValue: input?.value || '',
    inputFocused: document.activeElement === input,
    presenceLabel: text('.advisor-presence small'),
    presenceStatus: text('.advisor-presence strong'),
    conversation: {
      present: Boolean(document.querySelector('.advisor-conversation-panel')),
      title: text('.advisor-conversation-heading h1'),
      body: text('.advisor-answer-card p'),
    },
  };
})()`;

const INSTALL_AUDIT = `(() => {
  const key = ${JSON.stringify(AUDIT_KEY)};
  try { window[key]?.stop?.(); } catch {}
  const audit = {
    installedAtEpochMs: Date.now(),
    transitions: [],
    trustedUserInputEvents: [],
    lastSignature: '',
    stopped: false,
  };
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const text = (selector) => clean(document.querySelector(selector)?.textContent);
  const snapshot = (reason) => {
    const shell = document.querySelector('.advisor-shell');
    const composer = document.querySelector('.advisor-composer');
    const mic = document.querySelector('.advisor-composer__mic');
    const input = document.querySelector('[aria-label="站点咨询问题"]');
    const state = {
      atEpochMs: Date.now(), reason,
      readyState: document.readyState,
      screenClass: shell?.className || '',
      composerPresent: Boolean(composer),
      listeningClass: Boolean(composer?.classList.contains('is-listening')),
      micLabel: mic?.getAttribute('aria-label') || '',
      mode: text('.advisor-composer__mode > strong'),
      status: text('.advisor-composer__field > small > span[aria-hidden="true"]'),
      inputValue: input?.value || '',
      inputFocused: document.activeElement === input,
      conversationPresent: Boolean(document.querySelector('.advisor-conversation-panel')),
      answerTitle: text('.advisor-conversation-heading h1'),
      answerBody: text('.advisor-answer-card p'),
    };
    const signature = JSON.stringify({ ...state, atEpochMs: 0, reason: '' });
    if (signature === audit.lastSignature) return;
    audit.lastSignature = signature;
    if (audit.transitions.length < 2500) audit.transitions.push(state);
  };
  const inputTypes = ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown', 'input', 'change', 'submit'];
  const listeners = inputTypes.map((type) => {
    const listener = (event) => {
      if (!event.isTrusted || audit.trustedUserInputEvents.length >= 200) return;
      const target = event.target;
      audit.trustedUserInputEvents.push({
        atEpochMs: Date.now(), type: event.type,
        key: event.key || '', button: Number.isFinite(event.button) ? event.button : null,
        target: {
          tagName: target?.tagName || '', id: target?.id || '',
          className: typeof target?.className === 'string' ? target.className : '',
          ariaLabel: target?.getAttribute?.('aria-label') || '',
        },
      });
    };
    document.addEventListener(type, listener, true);
    return [type, listener];
  });
  const observer = new MutationObserver(() => queueMicrotask(() => snapshot('mutation')));
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const interval = setInterval(() => snapshot('interval'), ${POLL_INTERVAL_MS});
  const onReady = () => snapshot('DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', onReady, { once: true });
  audit.stop = () => {
    if (audit.stopped) return;
    audit.stopped = true;
    clearInterval(interval);
    observer.disconnect();
    document.removeEventListener('DOMContentLoaded', onReady);
    for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    snapshot('stopped');
  };
  Object.defineProperty(window, key, { value: audit, configurable: true });
  queueMicrotask(() => snapshot('installed'));
})()`;

const READ_AUDIT = `(() => {
  const audit = window[${JSON.stringify(AUDIT_KEY)}];
  return audit ? {
    installedAtEpochMs: audit.installedAtEpochMs,
    transitions: audit.transitions || [],
    trustedUserInputEvents: audit.trustedUserInputEvents || [],
  } : null;
})()`;

function isAutoListening(state) {
  return Boolean(state?.listeningClass)
    && state.micLabel === "暂停自动聆听"
    && state.mode.includes("自动聆听")
    && !state.status.includes("正在打开麦克风");
}

function isRecognizing(state) {
  return state?.mode.includes("正在识别") || state?.status.includes("正在识别");
}

function isCountdown(state) {
  return /秒后自动发送/.test(state?.status || "") && Boolean(state?.inputValue?.trim());
}

function isOrdinaryText(value) {
  const text = String(value || "").replace(/[，。！？、,.!?\s]/g, "");
  return Boolean(text) && !/(积分|余额|会员|账户|账号|本人信息)/.test(text);
}

function stateForReport(state) {
  if (!state) return null;
  return {
    capturedAtEpochMs: state.capturedAtEpochMs || state.atEpochMs || null,
    screenClass: state.screenClass || "",
    listeningClass: Boolean(state.listeningClass),
    micLabel: state.micLabel || "",
    mode: state.mode || "",
    status: state.status || "",
    inputValue: state.inputValue || "",
    conversation: state.conversation || {
      present: Boolean(state.conversationPresent),
      title: state.answerTitle || "",
      body: state.answerBody || "",
    },
  };
}

function firstMatching(states, predicate) {
  return states.find((state) => {
    try { return predicate(state); } catch { return false; }
  }) || null;
}

function deriveMilestones(transitions, pollingStates) {
  const states = [...transitions, ...pollingStates].sort((left, right) => (left.atEpochMs || left.capturedAtEpochMs || 0) - (right.atEpochMs || right.capturedAtEpochMs || 0));
  const autoListening = firstMatching(states, isAutoListening);
  const transcription = firstMatching(states, (state) => Boolean(state.inputValue?.trim()));
  const recognizing = firstMatching(states, isRecognizing);
  const countdown = firstMatching(states, isCountdown);
  const answer = firstMatching(states, (state) => Boolean((state.conversation?.present || state.conversationPresent) && (state.conversation?.title || state.answerTitle) && (state.conversation?.body || state.answerBody)));
  report.milestones.autoListening = stateForReport(autoListening);
  report.milestones.transcription = stateForReport(transcription);
  report.milestones.recognizing = stateForReport(recognizing);
  report.milestones.countdown = stateForReport(countdown);
  report.milestones.answer = stateForReport(answer);
  report.flow.ordinaryText = countdown?.inputValue?.trim() || transcription?.inputValue?.trim() || null;
  const countdownAt = countdown?.atEpochMs || countdown?.capturedAtEpochMs || null;
  const answerAt = answer?.atEpochMs || answer?.capturedAtEpochMs || null;
  report.flow.autoSubmitDelayMs = countdownAt && answerAt ? Math.max(0, answerAt - countdownAt) : null;
  let previousConversation = false;
  report.flow.conversationEntryCount = states.reduce((count, state) => {
    const current = Boolean(state.conversation?.present || state.conversationPresent);
    const entered = current && !previousConversation;
    previousConversation = current;
    return count + (entered ? 1 : 0);
  }, 0);
}

async function captureFullPage(client) {
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
  }, 25_000);
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshots.finalFullPage = screenshotPath;
}

async function writeReport() {
  report.generatedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

let client;
let scriptIdentifier;
let pageReady = false;
let exitCode = 0;
const pollingStates = [];
try {
  const targets = await fetchJson(`${cdpUrl}/json/list`);
  const pages = Array.isArray(targets) ? targets.filter((target) => target.type === "page") : [];
  const target = pages.find((candidate) => /站点咨询顾问/.test(candidate.title || ""))
    || pages.find((candidate) => /^file:/i.test(candidate.url || ""))
    || pages[0];
  if (!target?.webSocketDebuggerUrl) throw new Error(`No packaged Electron page target found at ${cdpUrl}`);
  report.target = { id: target.id || "", title: target.title || "", url: target.url || "", type: target.type || "" };

  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  addEvidenceListeners(client);
  await Promise.all([
    client.send("Runtime.enable"),
    client.send("Log.enable"),
    client.send("Page.enable"),
    client.send("Inspector.enable"),
    client.send("Network.enable"),
  ]);
  const installed = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTALL_AUDIT });
  scriptIdentifier = installed.identifier;
  await client.send("Page.reload", { ignoreCache: true });

  const domDeadline = performance.now() + DOM_TIMEOUT_MS;
  let state = null;
  while (performance.now() < domDeadline) {
    state = await evaluate(client, READ_UI_STATE);
    pollingStates.push(state);
    if (state?.readyState === "complete" && state.shellPresent && state.composerPresent) break;
    await wait(80);
  }
  if (!state?.shellPresent || !state?.composerPresent) throw new Error("StationAdvisor DOM did not become ready after reload");
  pageReady = true;

  const bridge = await evaluate(client, `(async () => {
    const runtime = await window.kioskBridge?.runtimeStatus?.().catch((error) => ({ error: error?.message || String(error) }));
    const speech = await window.kioskBridge?.speechStatus?.().catch((error) => ({ error: error?.message || String(error) }));
    const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
    return {
      runtime: runtime || null,
      speech: speech || null,
      capabilities: {
        recognizePcm: typeof window.kioskBridge?.recognizePcm === 'function',
        recognizePreviewPcm: typeof window.kioskBridge?.recognizePreviewPcm === 'function',
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
      },
      mediaDevices: (devices || []).filter((device) => device.kind === 'audioinput').map((device) => ({ kind: device.kind, label: device.label || '' })),
    };
  })()`, 20_000);
  report.runtime = bridge?.runtime || null;
  report.speech = bridge?.speech || null;
  report.mediaDevices = bridge?.mediaDevices || [];
  report.page = { title: state.title, url: state.url, protocol: state.protocol, search: state.search, readyState: state.readyState, capabilities: bridge?.capabilities || null };
  report.offlineEvidence.packagedFilePage = state.protocol === "file:" && bridge?.runtime?.packaged === true;
  report.offlineEvidence.localBridgeAvailable = bridge?.capabilities?.recognizePcm === true;
  report.offlineEvidence.speechReady = bridge?.speech?.ready === true;
  report.offlineEvidence.speechOffline = bridge?.speech?.offline === true;
  report.offlineEvidence.speechProvider = bridge?.speech?.provider || null;
  report.offlineEvidence.webSpeechOptIn = new URLSearchParams(state.search || "").get("allowWebSpeech") === "1";

  const flowDeadline = performance.now() + FLOW_TIMEOUT_MS;
  while (performance.now() < flowDeadline) {
    state = await evaluate(client, READ_UI_STATE);
    pollingStates.push(state);
    if (state?.conversation?.present && state.conversation.title && state.conversation.body) break;
    await wait(POLL_INTERVAL_MS);
  }

  const audit = await evaluate(client, READ_AUDIT);
  report.flow.transitions = audit?.transitions || [];
  report.flow.trustedUserInputEvents = audit?.trustedUserInputEvents || [];
  report.flow.trustedClickCount = report.flow.trustedUserInputEvents.filter((event) => ["pointerdown", "mousedown", "click", "touchstart"].includes(event.type)).length;
  report.flow.trustedInputCount = report.flow.trustedUserInputEvents.length;
  report.flow.noUserInteraction = report.flow.trustedInputCount === 0;
  deriveMilestones(report.flow.transitions, pollingStates);

  report.flow.offlineFinalAutoSent = report.offlineEvidence.packagedFilePage
    && report.offlineEvidence.localBridgeAvailable
    && report.offlineEvidence.speechReady
    && report.offlineEvidence.speechOffline
    && report.offlineEvidence.speechProvider === EXPECTED_SPEECH_PROVIDER
    && !report.offlineEvidence.webSpeechOptIn
    && report.flow.noUserInteraction
    && Boolean(report.milestones.autoListening)
    && Boolean(report.milestones.transcription)
    && Boolean(report.milestones.recognizing)
    && Boolean(report.milestones.countdown)
    && isOrdinaryText(report.flow.ordinaryText)
    && Boolean(report.milestones.answer)
    && report.flow.conversationEntryCount === 1;

  if (state.title !== EXPECTED_TITLE) report.failures.push(`unexpected-title:${state.title || "missing"}`);
  if (bridge?.runtime?.version !== EXPECTED_VERSION) report.failures.push(`unexpected-runtime-version:${bridge?.runtime?.version || "missing"}`);
  if (!report.offlineEvidence.packagedFilePage) report.failures.push("target-is-not-packaged-file-page");
  if (!report.offlineEvidence.localBridgeAvailable) report.failures.push("packaged-recognizePcm-bridge-missing");
  if (!report.offlineEvidence.speechReady || !report.offlineEvidence.speechOffline) report.failures.push("offline-speech-not-ready");
  if (report.offlineEvidence.speechProvider !== EXPECTED_SPEECH_PROVIDER) report.failures.push(`unexpected-speech-provider:${report.offlineEvidence.speechProvider || "missing"}`);
  if (report.offlineEvidence.webSpeechOptIn) report.failures.push("browser-web-speech-opt-in-is-enabled");
  if (!report.milestones.autoListening) report.failures.push("auto-listening-not-observed-after-reload");
  if (!report.milestones.transcription) report.failures.push("transcription-not-observed");
  if (!report.milestones.recognizing) report.failures.push("recognizing-state-not-observed");
  if (!report.milestones.countdown) report.failures.push("ordinary-countdown-not-observed");
  if (!isOrdinaryText(report.flow.ordinaryText)) report.failures.push(`recognized-text-is-not-ordinary:${report.flow.ordinaryText || "missing"}`);
  if (!report.milestones.answer) report.failures.push("answer-page-not-observed");
  if (report.flow.conversationEntryCount !== 1) report.failures.push(`unexpected-conversation-entry-count:${report.flow.conversationEntryCount}`);
  if (!report.flow.noUserInteraction) report.failures.push(`trusted-user-input-observed:${report.flow.trustedInputCount}`);
  if (report.network.remoteSpeechRequests.length) report.failures.push(`remote-speech-request-observed:${report.network.remoteSpeechRequests.length}`);
  if (report.console.errors.length || report.console.exceptions.length || report.console.crashes.length) {
    report.failures.push(`renderer-errors:${report.console.errors.length + report.console.exceptions.length + report.console.crashes.length}`);
  }
  if (!report.flow.offlineFinalAutoSent) report.failures.push("offline-final-was-not-proven-to-auto-send");

  await captureFullPage(client);
  report.result = report.failures.length ? "FAIL" : "PASS";
  exitCode = report.failures.length ? 1 : 0;
} catch (error) {
  report.fatalError = { message: errorMessage(error), stack: error instanceof Error ? error.stack || "" : "" };
  report.failures.push(`runner-error:${errorMessage(error)}`);
  report.result = "FAIL";
  exitCode = 1;
} finally {
  if (client && pageReady && !report.screenshots.finalFullPage) {
    try { await captureFullPage(client); }
    catch (error) { report.failures.push(`full-page-screenshot-failed:${errorMessage(error)}`); }
  }
  if (client) {
    try { await evaluate(client, `window[${JSON.stringify(AUDIT_KEY)}]?.stop?.()`); } catch {}
    if (scriptIdentifier) {
      try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptIdentifier }); } catch {}
    }
    client.close();
  }
  if (report.result === "RUNNING") report.result = report.failures.length ? "FAIL" : "PASS";
  if (report.failures.length) exitCode = 1;
  try { await writeReport(); }
  catch (error) {
    process.stderr.write(`Failed to write JSON report: ${errorMessage(error)}\n`);
    exitCode = 1;
  }
}

process.stdout.write(`${JSON.stringify({
  result: report.result,
  reportPath,
  screenshotPath: report.screenshots.finalFullPage,
  failures: report.failures,
  noUserInteraction: report.flow.noUserInteraction,
  offlineFinalAutoSent: report.flow.offlineFinalAutoSent,
  ordinaryText: report.flow.ordinaryText,
  autoSubmitDelayMs: report.flow.autoSubmitDelayMs,
  consoleErrorCount: report.console.errors.length + report.console.exceptions.length + report.console.crashes.length,
}, null, 2)}\n`);
process.exitCode = exitCode;
