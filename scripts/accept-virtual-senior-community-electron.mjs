import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv.find((item) => item.startsWith("--port="))?.split("=")[1] || 9331);
const outputDirectory = path.resolve(process.argv.find((item) => item.startsWith("--out="))?.slice(6) || "QA-EXTERNAL/virtual-senior-community/electron-current");
await fs.mkdir(outputDirectory, { recursive: true });

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!target) throw new Error("Electron renderer target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
});
let sequence = 0;
const pending = new Map();
const consoleErrors = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(String(data));
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params?.exceptionDetails?.text || "exception");
  if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") consoleErrors.push((message.params.args || []).map((item) => item.value || item.description || "").join(" "));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluation failed");
  return result.result?.value;
}
async function waitFor(expression, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function screenshot(name, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(outputDirectory, name);
  await fs.writeFile(file, Buffer.from(capture.data, "base64"));
  return file;
}
async function focusSnapshot() {
  return evaluate(`(() => {
    const root = document.querySelector('.virtual-senior-console');
    const item = document.activeElement;
    const style = getComputedStyle(item);
    const className = typeof item.className === 'string' ? item.className : '';
    const label = item.getAttribute('aria-label') || item.innerText?.trim() || item.closest('label')?.innerText?.trim() || item.name || item.id || item.tagName;
    const kind = item.matches('.virtual-senior-header button[aria-label="退出测试模式"]') ? 'close'
      : item.matches('.virtual-senior-run-profile button') ? 'run-profile'
        : item.matches('.virtual-senior-cohort select') ? 'cohort-filter'
          : item.matches('.virtual-senior-coverage__group > button') ? 'mcp-expand'
            : item.matches('.virtual-senior-job-action button') ? 'job-action'
              : item.matches('.virtual-senior-footer > button') ? 'footer-main'
                : 'other';
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const visibleFocus = (style.outlineStyle !== 'none' && outlineWidth > 0) || style.boxShadow !== 'none';
    return { tag: item.tagName, className, label: String(label).replace(/\\s+/g, ' ').slice(0, 160), kind, insideConsole: Boolean(root?.contains(item)), outline: style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor, boxShadow: style.boxShadow, visibleFocus };
  })()`);
}
async function focusAuditConsole() {
  await send('Page.bringToFront');
  await evaluate("document.querySelector('.virtual-senior-header button[aria-label=\\\"退出测试模式\\\"]')?.focus(); true");
  const sequence = [];
  for (let index = 0; index < 56; index += 1) {
    sequence.push(await focusSnapshot());
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const requiredKinds = ['close', 'run-profile', 'cohort-filter', 'mcp-expand', 'job-action', 'footer-main'];
  // The initial close focus is positioned programmatically only to establish
  // a deterministic starting point. Prefer its later CDP-Tab visit so the
  // stored representative proves the keyboard-visible focus treatment.
  const representatives = Object.fromEntries(requiredKinds.map((kind) => [kind, sequence.find((item) => item.kind === kind && item.visibleFocus) || sequence.find((item) => item.kind === kind) || null]));
  const reached = Object.values(representatives).every(Boolean);
  const visible = Object.values(representatives).every((item) => item?.visibleFocus === true);
  const firstRepeat = sequence.findIndex((item, index) => index > 0 && item.kind === 'close');
  const lastRequired = Math.max(...requiredKinds.map((kind) => sequence.findIndex((item) => item.kind === kind)));
  const firstOutside = sequence.findIndex((item, index) => index > lastRequired && !item.insideConsole);
  const returnedToConsole = firstOutside === -1 || sequence.slice(firstOutside + 1).some((item) => item.kind === 'close' && item.insideConsole);
  const noTrap = reached && (firstRepeat === -1 || firstRepeat > lastRequired) && returnedToConsole;
  return { sequence, representatives, reached, visible, noTrap, firstOutside, returnedToConsole, passed: reached && visible && noTrap };
}
async function reducedMotionAuditConsole() {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const reduced = await evaluate(`(() => { const style = getComputedStyle(document.querySelector('.virtual-senior-console')); return { animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration }; })()`);
  await send('Emulation.setEmulatedMedia', { features: [] });
  const passed = reduced.animationName === 'none' || reduced.animationDuration.split(',').every((value) => Number.parseFloat(value) === 0);
  return { requested: 'reduce', reduced, passed, restored: true };
}

await send("Runtime.enable");
await send("Page.enable");
await waitFor("document.readyState === 'complete'");
if (await evaluate("Boolean(document.querySelector('.virtual-senior-console'))")) {
  await evaluate("document.querySelector('.virtual-senior-header button[aria-label=\"退出测试模式\"]')?.click(); true");
  await waitFor("!document.querySelector('.virtual-senior-console')");
}
process.stdout.write(`${JSON.stringify(await evaluate("({ body: document.body?.innerText?.slice(0, 1000), buttons: [...document.querySelectorAll('button')].map((item) => ({ text: item.innerText, label: item.getAttribute('aria-label'), testid: item.dataset.testid })) })"))}\n`);
await waitFor("[...document.querySelectorAll('button')].some((item) => /终端管理|管理员连接/.test(item.innerText))");
await evaluate("[...document.querySelectorAll('button')].find((item) => /终端管理|管理员连接/.test(item.innerText)).click(); true");
await waitFor("Boolean(document.querySelector('[data-testid=advisor-open-virtual-senior]'))");
await evaluate("document.querySelector('[data-testid=advisor-open-virtual-senior]').click(); true");
await waitFor("Boolean(document.querySelector('.virtual-senior-console'))");
if (!await evaluate("Boolean(document.querySelector('.virtual-senior-run-profile'))")) {
  await evaluate("[...document.querySelectorAll('.virtual-senior-tabs button')].find((item) => item.innerText.includes('场景'))?.click(); true");
  await waitFor("Boolean(document.querySelector('.virtual-senior-run-profile'))");
}

const initial750 = await screenshot("virtual-senior-initial-750x1200.png", 750, 1200);
const auditConsole = () => evaluate(`(() => {
  const root = document.querySelector('.virtual-senior-console');
  const buttons = [...root.querySelectorAll('button')].filter((item) => item.offsetParent !== null);
  const undersized = buttons.map((item) => ({ label: item.innerText.trim() || item.getAttribute('aria-label'), rect: item.getBoundingClientRect().toJSON() })).filter((item) => item.rect.width < 52 || item.rect.height < 52);
  const oneSided = [...root.querySelectorAll('*')].filter((item) => item.offsetParent !== null).map((item) => { const style = getComputedStyle(item); const widths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(parseFloat); return { tag: item.tagName, className: item.className, widths }; }).filter((item) => item.widths.filter((value) => value > 0).length === 1);
  const parents = new Set(); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) { const parent = node.parentElement; if (parent?.offsetParent !== null && /[\\p{L}\\p{N}]/u.test(node.textContent || '')) parents.add(parent); }
  const textElements = [...parents].map((item) => ({ tag: item.tagName, className: typeof item.className === 'string' ? item.className : '', text: item.textContent.trim().slice(0, 120), fontSizePx: Number.parseFloat(getComputedStyle(item).fontSize) })).filter((item) => Number.isFinite(item.fontSizePx));
  const tooSmallText = textElements.filter((item) => item.fontSizePx < 12);
  const textAudit = { inspected: textElements.length, minFontSizePx: textElements.length ? Math.min(...textElements.map((item) => item.fontSizePx)) : null, below12px: tooSmallText.slice(0, 100) };
  return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, undersized, oneSided, textAudit, text: root.innerText.slice(0, 5000) };
})()`);
const initialAudit = await auditConsole();
const focusAudit = await focusAuditConsole();
const reducedMotionAudit = await reducedMotionAuditConsole();

await evaluate(`(() => {
  const button = [...document.querySelectorAll('.virtual-senior-run-profile button')].find((item) => item.innerText.includes('冒烟'));
  button.click();
  const select = document.querySelector('.virtual-senior-cohort select');
  select.value = '70-79';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('.virtual-senior-coverage__group > button').click();
  return true;
})()`);
await waitFor("document.querySelector('.virtual-senior-cohort header strong')?.innerText !== '0 人'");
const filtered750 = await screenshot("virtual-senior-filtered-750x1200.png", 750, 1200);
await evaluate("document.querySelector('.virtual-senior-job-action button').click(); true");
await waitFor("window.kioskBridge.virtualSeniorCommunityStatus().then((value) => value.job?.status === 'completed')", 60_000);
const completed750 = await screenshot("virtual-senior-completed-750x1200.png", 750, 1200);
await evaluate("[...document.querySelectorAll('.virtual-senior-tabs button')].find((item) => item.innerText.includes('统计分析')).click(); true");
await waitFor("Boolean(document.querySelector('.virtual-senior-analysis'))");
const analysis750 = await screenshot("virtual-senior-analysis-750x1200.png", 750, 1200);
const analysis2400 = await screenshot("virtual-senior-analysis-2400x3840.png", 2400, 3840);
const finalAudit = await auditConsole();
await evaluate("document.querySelector('.virtual-senior-header button[aria-label=\"退出测试模式\"]').click(); true");
await waitFor("!document.querySelector('.virtual-senior-console')");

const report = {
  schemaVersion: 1,
  appTitle: target.title,
  targetUrl: target.url,
  generatedAt: new Date().toISOString(),
  viewport750: initialAudit,
  targetViewport: finalAudit,
  focusAudit,
  reducedMotionAudit,
  consoleErrors,
  screenshots: { initial750, filtered750, completed750, analysis750, analysis2400 },
  result: initialAudit.scrollWidth <= initialAudit.clientWidth
    && finalAudit.scrollWidth <= finalAudit.clientWidth
    && consoleErrors.length === 0
    && initialAudit.undersized.length === 0
    && initialAudit.oneSided.length === 0
    && finalAudit.undersized.length === 0
    && finalAudit.oneSided.length === 0
    && initialAudit.textAudit.below12px.length === 0
    && finalAudit.textAudit.below12px.length === 0
    && focusAudit.passed
    && reducedMotionAudit.passed
    ? "PASS"
    : "FAIL",
};
await fs.writeFile(path.join(outputDirectory, "electron-ui-report.json"), `${JSON.stringify(report, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify({ result: report.result, outputDirectory, consoleErrors: consoleErrors.length, undersized: initialAudit.undersized.length + finalAudit.undersized.length, oneSided: initialAudit.oneSided.length + finalAudit.oneSided.length, minimumFontSizePx: Math.min(initialAudit.textAudit.minFontSizePx ?? Infinity, finalAudit.textAudit.minFontSizePx ?? Infinity), below12px: initialAudit.textAudit.below12px.length + finalAudit.textAudit.below12px.length, focus: focusAudit.passed, reducedMotion: reducedMotionAudit.passed })}\n`);
