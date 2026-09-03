import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv.find((item) => item.startsWith("--port="))?.split("=")[1] || 9332);
const mode = process.argv.find((item) => item.startsWith("--mode="))?.split("=")[1] || "controls";
const outputDirectory = path.resolve(process.argv.find((item) => item.startsWith("--out="))?.slice(6) || `QA-EXTERNAL/virtual-senior-community/electron-lifecycle-${mode}`);
if (!["controls", "failed-rerun"].includes(mode)) throw new Error("--mode must be controls or failed-rerun");
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
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
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
async function waitFor(expression, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function screenshot(name) {
  await send("Emulation.setDeviceMetricsOverride", { width: 750, height: 1200, deviceScaleFactor: 1, mobile: false });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(outputDirectory, name);
  await fs.writeFile(file, Buffer.from(capture.data, "base64"));
  return file;
}
async function focusCommunityAction() {
  await evaluate("document.querySelector('.virtual-senior-job-action')?.scrollIntoView({ block: 'center' }); true");
  await new Promise((resolve) => setTimeout(resolve, 250));
}
async function job() { return evaluate("window.kioskBridge.virtualSeniorCommunityStatus().then((value) => value.job)"); }
async function waitJob(status, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await job();
    if (current?.status === status) return current;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for community job ${status}`);
}
function checkpoint(value) {
  return {
    jobId: value?.jobId,
    status: value?.status,
    stage: value?.stage,
    completedStages: value?.completedStages || [],
    stageAttempts: value?.stageAttempts || {},
    failedStage: value?.failedStage || null,
    reportDirectory: value?.reportDirectory || null,
    reports: value?.reports || {},
    errors: value?.errors || [],
  };
}
async function clickText(text) {
  const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('.virtual-senior-console button')].find((item) => item.offsetParent !== null && item.innerText.includes(${JSON.stringify(text)})); if (!button) return false; button.click(); return true; })()`);
  if (!clicked) throw new Error(`Visible console button not found: ${text}`);
}
async function selectProfile(label) {
  const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('.virtual-senior-run-profile button')].find((item) => item.innerText.includes(${JSON.stringify(label)})); if (!button) return false; button.click(); return true; })()`);
  if (!clicked) throw new Error(`Profile button not found: ${label}`);
}
async function openConsole() {
  await send("Runtime.enable"); await send("Page.enable");
  await waitFor("document.readyState === 'complete'");
  if (await evaluate("Boolean(document.querySelector('.virtual-senior-console'))")) {
    await evaluate("document.querySelector('.virtual-senior-header button[aria-label=\\\"退出测试模式\\\"]')?.click(); true");
    await waitFor("!document.querySelector('.virtual-senior-console')");
  }
  await waitFor("[...document.querySelectorAll('button')].some((item) => /终端管理|管理员连接/.test(item.innerText))");
  await evaluate("[...document.querySelectorAll('button')].find((item) => /终端管理|管理员连接/.test(item.innerText)).click(); true");
  await waitFor("Boolean(document.querySelector('[data-testid=advisor-open-virtual-senior]'))");
  await evaluate("document.querySelector('[data-testid=advisor-open-virtual-senior]').click(); true");
  await waitFor("Boolean(document.querySelector('.virtual-senior-console'))");
  if (!await evaluate("Boolean(document.querySelector('.virtual-senior-run-profile'))")) {
    await clickText("场景");
    await waitFor("Boolean(document.querySelector('.virtual-senior-run-profile'))");
  }
}
async function startFromUi(profileLabel) {
  await selectProfile(profileLabel);
  await waitFor(`document.querySelector('.virtual-senior-run-profile button[aria-pressed=true]')?.innerText.includes(${JSON.stringify(profileLabel)})`);
  await clickText("生成并验证");
  return waitJob("running", 15_000);
}

await openConsole();
const lifecycle = [];
const screenshots = {};
try {
  if (mode === "controls") {
    const startedPause = await startFromUi("日常回归");
    lifecycle.push({ action: "start-for-pause", button: "生成并验证", job: checkpoint(startedPause) });
    await clickText("阶段后暂停");
    const paused = await waitJob("paused");
    lifecycle.push({ action: "pause-after-current-unit", button: "阶段后暂停", job: checkpoint(paused) });
    await focusCommunityAction();
    screenshots.paused = await screenshot("community-paused-750x1200.png");
    await waitFor("[...document.querySelectorAll('.virtual-senior-console button')].some((item) => item.offsetParent !== null && item.innerText.includes('从检查点恢复'))");
    await clickText("从检查点恢复");
    const resumedRunning = await waitJob("running", 15_000);
    lifecycle.push({ action: "resume-from-paused", button: "从检查点恢复", job: checkpoint(resumedRunning) });
    const resumed = await waitJob("completed");
    lifecycle.push({ action: "completed-after-pause", button: "polling", job: checkpoint(resumed), reusedCompletedStages: paused.completedStages.every((stage) => resumed.completedStages.includes(stage)), reusedDatasetManifest: paused.reports?.datasetManifest === resumed.reports?.datasetManifest });
    screenshots.completedAfterPause = await screenshot("community-resumed-completed-750x1200.png");

    const startedCancel = await startFromUi("日常回归");
    lifecycle.push({ action: "start-for-cancel", button: "生成并验证", job: checkpoint(startedCancel) });
    await clickText("取消");
    const cancelled = await waitJob("cancelled");
    lifecycle.push({ action: "cancel-with-checkpoint", button: "取消", job: checkpoint(cancelled) });
    await focusCommunityAction();
    screenshots.cancelled = await screenshot("community-cancelled-750x1200.png");
    await waitFor("[...document.querySelectorAll('.virtual-senior-console button')].some((item) => item.offsetParent !== null && item.innerText.includes('从检查点恢复'))");
    await clickText("从检查点恢复");
    const cancelResumedRunning = await waitJob("running", 15_000);
    lifecycle.push({ action: "resume-cancelled", button: "从检查点恢复", job: checkpoint(cancelResumedRunning) });
    const cancelResumed = await waitJob("completed");
    lifecycle.push({ action: "completed-after-cancel", button: "polling", job: checkpoint(cancelResumed), preservedCompletedStages: cancelled.completedStages.every((stage) => cancelResumed.completedStages.includes(stage)) });
    screenshots.completedAfterCancel = await screenshot("community-cancel-resumed-completed-750x1200.png");
  } else {
    const started = await startFromUi("冒烟");
    lifecycle.push({ action: "start-fault-injected-job", button: "生成并验证", job: checkpoint(started) });
    const failed = await waitJob("failed");
    lifecycle.push({ action: "failed-in-test-mode", button: "polling", job: checkpoint(failed), injectedFault: failed.errors?.some((item) => item.code === "QA_INJECTED_STAGE_FAILURE") });
    await focusCommunityAction();
    screenshots.failed = await screenshot("community-failed-750x1200.png");
    await waitFor("[...document.querySelectorAll('.virtual-senior-console button')].some((item) => item.offsetParent !== null && item.innerText.includes('仅重跑失败阶段'))");
    await clickText("仅重跑失败阶段");
    const rerunRunning = await waitJob("running", 15_000);
    lifecycle.push({ action: "rerun-failed-only", button: "仅重跑失败阶段", job: checkpoint(rerunRunning) });
    const rerun = await waitJob("completed");
    lifecycle.push({ action: "completed-after-failed-rerun", button: "polling", job: checkpoint(rerun), preservedCompletedStages: failed.completedStages.every((stage) => rerun.completedStages.includes(stage)), reusedDatasetManifest: failed.reports?.datasetManifest === rerun.reports?.datasetManifest, reusedValidationReport: failed.reports?.validation === rerun.reports?.validation });
    screenshots.rerunCompleted = await screenshot("community-failed-rerun-completed-750x1200.png");
  }
} finally {
  if (await evaluate("Boolean(document.querySelector('.virtual-senior-console'))")) {
    await evaluate("document.querySelector('.virtual-senior-header button[aria-label=\\\"退出测试模式\\\"]')?.click(); true");
    await waitFor("!document.querySelector('.virtual-senior-console')");
  }
}
const byAction = Object.fromEntries(lifecycle.map((step) => [step.action, step]));
const assertions = mode === "controls" ? {
  pauseReachedAfterCurrentUnit: byAction["pause-after-current-unit"]?.job?.status === "paused" && byAction["pause-after-current-unit"]?.job?.completedStages?.length > 0,
  pauseResumeCompleted: byAction["completed-after-pause"]?.job?.status === "completed",
  pauseResumeDidNotRepeatCompletedStage: byAction["completed-after-pause"]?.reusedCompletedStages === true && byAction["completed-after-pause"]?.reusedDatasetManifest === true,
  cancelPersistedCheckpoint: byAction["cancel-with-checkpoint"]?.job?.status === "cancelled" && Boolean(byAction["cancel-with-checkpoint"]?.job?.reportDirectory),
  cancelResumeCompleted: byAction["completed-after-cancel"]?.job?.status === "completed",
} : {
  injectedFailureReachedRequestedStage: byAction["failed-in-test-mode"]?.job?.status === "failed" && byAction["failed-in-test-mode"]?.job?.failedStage === "sweeping" && byAction["failed-in-test-mode"]?.injectedFault === true,
  failedOnlyButtonReranStage: byAction["rerun-failed-only"]?.job?.stage === "sweeping" && byAction["rerun-failed-only"]?.job?.completedStages?.join(",") === "generating,validating",
  failedOnlyRerunCompleted: byAction["completed-after-failed-rerun"]?.job?.status === "completed",
  failedOnlyRerunPreservedPriorOutputs: byAction["completed-after-failed-rerun"]?.preservedCompletedStages === true && byAction["completed-after-failed-rerun"]?.reusedDatasetManifest === true && byAction["completed-after-failed-rerun"]?.reusedValidationReport === true,
};
const report = { schemaVersion: 1, mode, generatedAt: new Date().toISOString(), appTitle: target.title, targetUrl: target.url, lifecycle, assertions, consoleErrors, screenshots, result: consoleErrors.length === 0 && Object.values(assertions).every(Boolean) ? "PASS" : "FAIL" };
await fs.writeFile(path.join(outputDirectory, "electron-community-lifecycle-report.json"), `${JSON.stringify(report, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify({ result: report.result, mode, outputDirectory, steps: lifecycle.length, consoleErrors: consoleErrors.length })}\n`);
