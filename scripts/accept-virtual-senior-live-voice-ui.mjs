import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv.find((item) => item.startsWith("--port="))?.split("=")[1] || 9352);
const outputDirectory = path.resolve(process.argv.find((item) => item.startsWith("--out="))?.slice(6) || "QA-EXTERNAL/virtual-senior-community/live-voice-ui-current");
await fs.mkdir(outputDirectory, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targets = () => fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "renderer exception");
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") errors.push((message.params.args || []).map((item) => item.value || item.description || "").join(" "));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
    return result.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { socket, send, evaluate, errors, target };
}

async function waitFor(fn, timeoutMs = 45_000, label = "界面状态") {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const value = await fn(); if (value) return value; } catch { /* Retry until the bounded deadline. */ }
    await delay(200);
  }
  throw new Error(`等待${label}超时`);
}

async function capture(client, name, width = 1440, height = 1024) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(outputDirectory, name);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  return file;
}

const initialTarget = (await targets()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!initialTarget) throw new Error("没有找到当前源码 App 页面");
const initial = await connect(initialTarget);
await waitFor(() => initial.evaluate("document.readyState === 'complete'"), 30_000, "App 首屏");
await initial.evaluate("document.querySelector('[aria-label=\"打开终端设置\"]')?.click(); true");
await waitFor(() => initial.evaluate("Boolean(document.querySelector('.advisor-terminal-settings-dialog'))"), 10_000, "终端设置");
await initial.evaluate("[...document.querySelectorAll('.advisor-terminal-setting')].find((item) => item.innerText.includes('虚拟长者测试'))?.click(); true");
await waitFor(() => initial.evaluate("Boolean(document.querySelector('[data-testid=advisor-open-virtual-senior]'))"), 10_000, "测试启动入口");
await initial.evaluate("document.querySelector('[data-testid=advisor-open-virtual-senior]').click(); true");

const control = await waitFor(async () => {
  for (const target of await targets()) {
    if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
    const candidate = target.id === initialTarget.id ? initial : await connect(target);
    const ready = await candidate.evaluate("Boolean(document.querySelector('.virtual-senior-console, .live-observer'))");
    if (ready) return candidate;
    if (candidate !== initial) candidate.socket.close();
  }
  return null;
}, 60_000, "虚拟长者测试中心");

if (!await control.evaluate("Boolean(document.querySelector('.live-observer'))")) await control.evaluate("[...document.querySelectorAll('button')].find((item) => item.innerText.includes('单人观察'))?.click(); true");
await waitFor(() => control.evaluate("Boolean(document.querySelector('.live-observer'))"), 10_000, "单人观察工作台");
const initialScreenshot = await capture(control, "01-live-observer-initial-1440x1024.png");

const initialAudit = await control.evaluate(`(() => {
  const root = document.querySelector('.live-observer');
  const names = [...root.querySelectorAll('.live-resident strong')].map((item) => item.childNodes[0]?.textContent?.trim()).filter(Boolean);
  const oneSided = [...root.querySelectorAll('*')].filter((item) => {
    const style = getComputedStyle(item);
    const left = parseFloat(style.borderLeftWidth) || 0;
    const right = parseFloat(style.borderRightWidth) || 0;
    return Math.abs(left - right) > .1 && (left > 0 || right > 0);
  }).length;
  const smallControls = [...root.querySelectorAll('button,input,select')].filter((item) => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.height < 44; }).length;
  return { names, namesAreChinese: names.length > 0 && names.every((name) => /^[\\u4e00-\\u9fff]{3}$/.test(name)), oneSided, smallControls, overflow: root.scrollWidth > root.clientWidth };
})()`);

await control.evaluate(`(() => { const input = document.querySelector('.live-search input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'SYN-00231'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await waitFor(() => control.evaluate("document.querySelectorAll('.live-resident').length === 1"), 10_000, "居民搜索结果");
await control.evaluate("document.querySelector('.live-resident').click(); true");
await waitFor(() => control.evaluate("document.querySelector('.live-selected')?.innerText.includes('合成画像')"), 10_000, "选中居民资料");
await control.evaluate("document.querySelector('.live-rounds-summary').click(); true");
await waitFor(() => control.evaluate("document.querySelectorAll('.live-round-list input').length === 22"), 10_000, "22 项轮次");
await control.evaluate(`(() => {
  for (const row of document.querySelectorAll('.live-round-list label')) {
    const input = row.querySelector('input');
    if (input.checked && !row.innerText.includes('最新体征')) input.click();
  }
  return true;
})()`);
await waitFor(() => control.evaluate("document.querySelector('.live-rounds-summary')?.innerText.includes('已选 1 项')"), 10_000, "单项选择");
const selectionAudit = await control.evaluate(`(() => ({
  totalRounds: document.querySelectorAll('.live-round-list input').length,
  checkedRounds: document.querySelectorAll('.live-round-list input:checked').length,
  summary: document.querySelector('.live-rounds-summary')?.innerText.replace(/\\s+/g, ' ').trim(),
  selectedResident: document.querySelector('.live-selected')?.innerText.replace(/\\s+/g, ' ').trim(),
}))()`);
const selectionScreenshot = await capture(control, "02-single-round-selection-1440x1024.png");

await control.evaluate("document.querySelector('.live-primary').click(); true");
await waitFor(() => control.evaluate("document.querySelector('.live-section-heading .is-running')?.innerText.includes('运行中')"), 10_000, "单项语音测试启动");
await delay(1200);
const runningScreenshot = await capture(control, "03-live-voice-running-1440x1024.png");
await waitFor(() => control.evaluate("Boolean([...document.querySelectorAll('.live-observer-note button')].find((item) => item.innerText.includes('查看本次结果')))"), 180_000, "单项语音测试结束");
const finalState = await control.evaluate(`(() => ({
  status: document.querySelector('.live-actions [role=status]')?.innerText,
  voice: document.querySelector('.live-observer-note')?.innerText.replace(/\\s+/g, ' ').trim(),
  messages: document.querySelectorAll('[data-observed-message-id]').length,
  noteClass: document.querySelector('.live-observer-note')?.className,
}))()`);
await control.evaluate("[...document.querySelectorAll('.live-observer-note button')].find((item) => item.innerText.includes('查看本次结果')).click(); true");
await waitFor(() => control.evaluate("Boolean(document.querySelector('.live-result-banner'))"), 10_000, "测试结果详情");
const resultAudit = await control.evaluate(`(() => ({
  bannerClass: document.querySelector('.live-result-banner')?.className,
  bannerText: document.querySelector('.live-result-banner')?.innerText.replace(/\\s+/g, ' ').trim(),
  retryVisible: [...document.querySelectorAll('.live-result-banner button')].some((item) => item.innerText.includes('重新测试')),
  resultRows: document.querySelectorAll('table[aria-label="逐轮测试结果"] tbody tr').length,
  resultText: document.querySelector('dialog.live-detail')?.innerText.replace(/\\s+/g, ' ').slice(0, 2000),
}))()`);
const resultScreenshot = await capture(control, "04-live-voice-result-1440x1024.png");

const narrowScreenshot = await capture(control, "05-live-result-750x1200.png", 750, 1200);
const narrowAudit = await control.evaluate(`(() => { const root = document.querySelector('.live-observer'); return { overflow: root.scrollWidth > root.clientWidth, mobileTabs: getComputedStyle(document.querySelector('.live-mobile-tabs')).display, dialogWidth: document.querySelector('dialog.live-detail')?.getBoundingClientRect().width }; })()`);

await control.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1024, deviceScaleFactor: 1, mobile: false });
await control.evaluate("document.querySelector('.live-result-banner button')?.click(); true");
await waitFor(() => control.evaluate("document.querySelector('.live-primary')?.innerText.includes('停止测试') && !document.querySelector('.live-primary')?.disabled"), 10_000, "历史记录重测启动");
await control.evaluate("document.querySelector('.live-primary').click(); true");
await waitFor(() => control.evaluate("Boolean([...document.querySelectorAll('.live-observer-note button')].find((item) => item.innerText.includes('查看本次结果'))) && !document.querySelector('.live-primary')?.innerText.includes('停止测试')"), 30_000, "重测停止记录");
await control.evaluate("[...document.querySelectorAll('.live-observer-note button')].find((item) => item.innerText.includes('查看本次结果')).click(); true");
await waitFor(() => control.evaluate("Boolean(document.querySelector('.live-result-banner'))"), 10_000, "重测结果详情");
const retryAudit = await control.evaluate(`(() => ({
  bannerClass: document.querySelector('.live-result-banner')?.className,
  text: document.querySelector('dialog.live-detail')?.innerText.replace(/\\s+/g, ' ').slice(0, 800),
  hasSourceLink: document.querySelector('dialog.live-detail')?.innerText.includes('来源 live-'),
}))()`);
const retryScreenshot = await capture(control, "06-retry-linked-blocked-1440x1024.png");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "source Electron GUI, synthetic single resident, one selected round, local speech loopback",
  initialAudit,
  selectionAudit,
  finalState,
  resultAudit,
  narrowAudit,
  retryAudit,
  consoleErrors: control.errors,
  screenshots: { initialScreenshot, selectionScreenshot, runningScreenshot, resultScreenshot, narrowScreenshot, retryScreenshot },
};
report.result = initialAudit.namesAreChinese && initialAudit.oneSided === 0 && initialAudit.smallControls === 0 && !initialAudit.overflow && selectionAudit.totalRounds === 22 && selectionAudit.checkedRounds === 1 && resultAudit.retryVisible && resultAudit.resultRows === 1 && /is-passed|is-blocked|is-failed/.test(resultAudit.bannerClass || "") && !narrowAudit.overflow && retryAudit.hasSourceLink && /is-passed|is-blocked|is-failed/.test(retryAudit.bannerClass || "") && control.errors.length === 0 ? "PASS" : "FAIL";
await fs.writeFile(path.join(outputDirectory, "live-voice-ui-report.json"), `${JSON.stringify(report, null, 2)}\n`);
initial.socket.close();
if (control !== initial) control.socket.close();
process.stdout.write(`${JSON.stringify({ result: report.result, finalState, outputDirectory })}\n`);
if (report.result !== "PASS") process.exitCode = 1;
