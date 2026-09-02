import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || 9333);
const outputDir = path.resolve(process.argv[3] || "qa/harness-electron");
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timeout")), 8000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); }, { once: true });
    });
    return new CdpClient(socket);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
}

await fs.mkdir(outputDir, { recursive: true });
let targets = [];
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { targets = await fetch(`${base}/json/list`).then((response) => response.json()); } catch {}
  if (targets.some((target) => target.type === "page")) break;
  await wait(250);
}
const target = targets.find((item) => item.type === "page" && /站点咨询顾问/.test(item.title || "")) || targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("没有找到小安 Electron 页面");
const client = await CdpClient.connect(target.webSocketDebuggerUrl);
const report = { result: "RUNNING", failures: [], target: { title: target.title, url: target.url } };
try {
  report.status = await evaluate(client, "window.kioskBridge.agentStatus()");
  report.directTurn = await evaluate(client, "window.kioskBridge.agentTurn({runId:'accept-direct',text:'健康讲堂讲什么'})");
  report.ui = await evaluate(client, `(async () => {
    const input = document.querySelector('#advisor-question-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '助餐服务几点开始');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.querySelector('.advisor-composer__send')?.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const text = document.body.innerText;
      if (text.includes('十一点半到十三点') && text.includes('一楼助餐区')) return { pass: true, text };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { pass: false, text: document.body.innerText };
  })()`);
  report.sessionMemory = await evaluate(client, "window.kioskBridge.agentMemory('station-advisor')");
  report.sessionClear = await evaluate(client, "window.kioskBridge.clearAgentSession('station-advisor')");
  report.sessionAfterClear = await evaluate(client, "window.kioskBridge.agentMemory('station-advisor')");
  if (!report.status?.ready || report.status.tools?.length !== 4) report.failures.push("harness-status-invalid");
  if (report.directTurn?.status !== "completed" || !report.directTurn?.answer?.speechText?.includes("慢病管理")) report.failures.push("direct-agent-turn-failed");
  if (!report.ui?.pass) report.failures.push("ui-agent-turn-failed");
  if (report.sessionMemory?.turns?.length !== 1 || report.sessionMemory.turns[0]?.userText !== "助餐服务几点开始") report.failures.push("ui-session-memory-failed");
  if (!report.sessionClear?.cleared || report.sessionAfterClear?.turns?.length !== 0) report.failures.push("ui-session-clear-failed");
  const shot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  report.screenshot = path.join(outputDir, "harness-meal-answer.png");
  await fs.writeFile(report.screenshot, Buffer.from(shot.data, "base64"));
  report.result = report.failures.length ? "FAIL" : "PASS";
} catch (error) {
  report.failures.push(error?.message || String(error));
  report.result = "FAIL";
} finally {
  client.close();
}
report.reportPath = path.join(outputDir, "report.json");
await fs.writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ result: report.result, failures: report.failures, reportPath: report.reportPath, screenshot: report.screenshot })}\n`);
if (report.failures.length) process.exitCode = 1;
