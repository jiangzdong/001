import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv.find((item) => item.startsWith("--port="))?.split("=")[1] || 9340);
const outputDirectory = path.resolve(process.argv.find((item) => item.startsWith("--out="))?.slice(6) || "QA-EXTERNAL/virtual-senior-community/product-manager-launch");
await fs.mkdir(outputDirectory, { recursive: true });

async function targets() {
  return fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluation failed");
    return result.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { evaluate, send, socket, target };
}

async function waitFor(fn, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for product-manager launch state");
}

const initialTarget = (await targets()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!initialTarget) throw new Error("Initial Electron renderer target not found");
const initial = await connect(initialTarget);
await waitFor(() => initial.evaluate("document.readyState === 'complete'"));
const initialState = await initial.evaluate(`(() => ({
  testMode: Boolean(window.kioskBridge?.virtualSeniorAvailable),
  adminEntry: [...document.querySelectorAll('button')].some((item) => /终端管理|管理员连接/.test(item.innerText)),
}))()`);
if (initialState.testMode || !initialState.adminEntry) throw new Error("Initial app must be normal mode with a visible terminal-management entry");
await initial.evaluate("[...document.querySelectorAll('button')].find((item) => /终端管理|管理员连接/.test(item.innerText)).click(); true");
await waitFor(() => initial.evaluate("Boolean(document.querySelector('[data-testid=advisor-open-virtual-senior]'))"));
const launchLabel = await initial.evaluate("document.querySelector('[data-testid=advisor-open-virtual-senior]').innerText.trim()");
if (!launchLabel.includes("启动虚拟长者测试")) throw new Error(`Unexpected launch label: ${launchLabel}`);
await initial.evaluate("document.querySelector('[data-testid=advisor-open-virtual-senior]').click(); true");
const launched = await waitFor(async () => {
  const inlineState = await initial.evaluate(`(() => ({
    ready: document.readyState === 'complete',
    testMode: Boolean(document.querySelector('.virtual-senior-console')),
    controlSurface: false,
    consoleVisible: Boolean(document.querySelector('.virtual-senior-console')),
    bannerVisible: Boolean(document.querySelector('.advisor-test-mode-banner')),
  }))()`);
  if (inlineState.consoleVisible) return { connection: initial, state: inlineState };
  const pages = (await targets()).filter((item) => item.type === "page" && item.webSocketDebuggerUrl && item.webSocketDebuggerUrl !== initialTarget.webSocketDebuggerUrl);
  for (const page of pages) {
    const connection = await connect(page);
    const state = await connection.evaluate(`(() => ({
      ready: document.readyState === 'complete',
      testMode: Boolean(window.kioskBridge?.virtualSeniorAvailable),
      controlSurface: Boolean(window.kioskBridge?.virtualSeniorControlSurface),
      consoleVisible: Boolean(document.querySelector('.virtual-senior-console')),
      bannerVisible: Boolean(document.querySelector('.advisor-test-mode-banner')),
    }))()`);
    if (state.ready && state.testMode && state.consoleVisible) return { connection, state };
    connection.socket.close();
  }
  return null;
}, 45_000);

const capture = await launched.connection.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const screenshot = path.join(outputDirectory, "product-manager-launch.png");
await fs.writeFile(screenshot, Buffer.from(capture.data, "base64"));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  initialState,
  launchLabel,
  launchedState: launched.state,
  displayMode: launched.state.controlSurface ? "dual-screen-control" : "single-screen-embedded",
  screenshot,
  result: "PASS",
};
await fs.writeFile(path.join(outputDirectory, "product-manager-launch-report.json"), `${JSON.stringify(report, null, 2)}\n`);
launched.connection.socket.close();
process.stdout.write(`${JSON.stringify({ result: report.result, displayMode: report.displayMode, outputDirectory })}\n`);
