import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || process.env.XIAOAN_CDP_PORT || 9234);
const outputDir = path.resolve(process.argv[3] || "qa/station-advisor-v1.5.3-keyboard-layout-electron-dev");
const cdpBase = `http://127.0.0.1:${port}`;
const reportPath = path.join(outputDir, "station-advisor-v1.5.3-keyboard-layout-report.json");
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
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function screenshot(client, name) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
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
  const rect = (element) => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
  };
  const borderWidths = (style) => style ? {
    top: style.borderTopWidth,
    right: style.borderRightWidth,
    bottom: style.borderBottomWidth,
    left: style.borderLeftWidth,
  } : null;
  const shell = q('.advisor-shell');
  const panel = q('[data-testid="advisor-home-bottom"]');
  const composer = q('[data-testid="advisor-input-module"]');
  const inputSurface = q('.advisor-composer__input-surface');
  const keyboard = q('[data-testid="advisor-keyboard-trigger"]');
  const input = q('#advisor-question-input');
  const shellStyle = shell && getComputedStyle(shell);
  const panelStyle = panel && getComputedStyle(panel);
  const composerStyle = composer && getComputedStyle(composer);
  const inputSurfaceStyle = inputSurface && getComputedStyle(inputSurface);
  const bodyStyle = document.body && getComputedStyle(document.body);
  const rootElement = q('#root');
  const rootStyle = rootElement && getComputedStyle(rootElement);
  return {
    title: document.title,
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    body: { background: bodyStyle?.backgroundImage || '' },
    root: { background: rootStyle?.backgroundImage || '' },
    shell: { rect: rect(shell), boxShadow: shellStyle?.boxShadow || '', borders: borderWidths(shellStyle) },
    panel: { rect: rect(panel), borders: borderWidths(panelStyle), boxShadow: panelStyle?.boxShadow || '' },
    composer: { rect: rect(composer), classes: composer?.className || '', borders: borderWidths(composerStyle), boxShadow: composerStyle?.boxShadow || '' },
    inputSurface: { rect: rect(inputSurface), borders: borderWidths(inputSurfaceStyle), boxShadow: inputSurfaceStyle?.boxShadow || '' },
    keyboard: { rect: rect(keyboard), pressed: keyboard?.getAttribute('aria-pressed') || '', label: keyboard?.getAttribute('aria-label') || '' },
    input: { rect: rect(input), value: input?.value || '', active: document.activeElement === input, inputMode: input?.inputMode || '' },
    mode: q('.advisor-composer__status > strong')?.textContent?.trim() || '',
    listening: composer?.classList.contains('is-listening') || false,
    keyboardMode: composer?.classList.contains('is-keyboard') || false,
    sendVisible: Boolean(q('.advisor-composer__send')),
    quickQuestions: q('[data-testid="advisor-quick-question-module"]')?.getBoundingClientRect().bottom || null,
    scroll: { width: document.documentElement?.scrollWidth || 0, height: document.documentElement?.scrollHeight || 0 },
  };
})()`;

const report = {
  suite: "station-advisor-v1.5.3-keyboard-layout-electron",
  generatedAt: new Date().toISOString(),
  target: null,
  runtime: null,
  initial: null,
  keyboard: null,
  typed: null,
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
  await Promise.all([
    client.send("Runtime.enable"),
    client.send("Page.enable"),
    client.send("Inspector.enable"),
  ]);
  await client.send("Page.bringToFront");
  await client.send("Page.reload", { ignoreCache: true });

  const readyDeadline = Date.now() + 12_000;
  while (Date.now() < readyDeadline) {
    report.initial = await evaluate(client, READ_STATE);
    if (report.initial?.composer?.rect && report.initial?.keyboard?.rect) break;
    await wait(100);
  }
  if (!report.initial?.composer?.rect || !report.initial?.keyboard?.rect) throw new Error("Station advisor keyboard UI did not become ready");
  report.runtime = await evaluate(client, `(async () => {
    try { return await window.kioskBridge?.runtimeStatus?.(); }
    catch (error) { return { error: error?.message || String(error) }; }
  })()`);
  report.screenshots.initial = await screenshot(client, "00-initial-full-page.png");

  const center = {
    x: report.initial.keyboard.rect.x + report.initial.keyboard.rect.width / 2,
    y: report.initial.keyboard.rect.y + report.initial.keyboard.rect.height / 2,
  };
  await click(client, center);
  await wait(700);
  report.keyboard = await evaluate(client, READ_STATE);
  report.screenshots.keyboard = await screenshot(client, "10-keyboard-mode-full-page.png");

  await client.send("Input.insertText", { text: "请问今天几点可以做健康评估" });
  await wait(1_900);
  report.typed = await evaluate(client, READ_STATE);
  report.screenshots.typed = await screenshot(client, "20-keyboard-typed-full-page.png");

  const zeroBorders = (borders) => borders && Object.values(borders).every((value) => value === "0px");
  if (report.initial.title !== "小安站点咨询顾问 V1.5.3") report.failures.push(`unexpected-title:${report.initial.title}`);
  if (report.runtime?.packaged !== true) report.failures.push("runtime-not-packaged");
  if (report.runtime?.version !== "1.5.3") report.failures.push(`unexpected-runtime-version:${report.runtime?.version || "missing"}`);
  if (report.keyboard.input.active !== true) report.failures.push("keyboard-click-did-not-focus-input");
  if (report.keyboard.keyboardMode !== true || report.keyboard.keyboard.pressed !== "true") report.failures.push("explicit-keyboard-mode-not-active");
  if (report.keyboard.mode !== "键盘输入") report.failures.push(`unexpected-keyboard-mode-label:${report.keyboard.mode}`);
  if (report.keyboard.listening) report.failures.push("automatic-listening-remained-active-in-keyboard-mode");
  if (report.keyboard.input.inputMode !== "text") report.failures.push(`unexpected-input-mode:${report.keyboard.input.inputMode}`);
  if (report.typed.input.value !== "请问今天几点可以做健康评估") report.failures.push(`typed-value-mismatch:${report.typed.input.value}`);
  if (!report.typed.sendVisible) report.failures.push("send-action-did-not-replace-keyboard-action");
  if (report.typed.url !== report.keyboard.url) report.failures.push("draft-was-auto-submitted");
  if (!zeroBorders(report.initial.composer.borders)) report.failures.push("composer-has-hard-border");
  if (!zeroBorders(report.initial.panel.borders)) report.failures.push("bottom-panel-has-hard-border");
  if (report.initial.shell.boxShadow !== "none") report.failures.push(`shell-side-shadow:${report.initial.shell.boxShadow}`);
  if (report.initial.shell.rect.x < 0 || report.initial.shell.rect.right > report.initial.viewport.width) report.failures.push("shell-overflows-viewport");
  if (report.initial.quickQuestions > report.initial.viewport.height + 1) report.failures.push("quick-questions-clipped");
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

process.stdout.write(`${JSON.stringify({ result: report.result, failures: report.failures, reportPath, screenshots: report.screenshots }, null, 2)}\n`);
process.exitCode = report.result === "PASS" ? 0 : 1;
