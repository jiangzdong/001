const { app, BrowserWindow, ipcMain, globalShortcut, safeStorage, screen } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createSpeechService } = require("./speech-service.cjs");
const { createAvatarService } = require("./avatar-service.cjs");
const { createSkillLoader } = require("./skill-loader.cjs");
const { normalizeDeepSeekChatResult } = require("./deepseek-stream.cjs");
const { streamDeepSeekChat: requestDeepSeekStream } = require("./deepseek-client.cjs");
const { createRuntimeTelemetry } = require("./telemetry.cjs");
const { parseSoakDuration, startSoakMonitor } = require("./soak-monitor.cjs");
const { createXiaoanHarness } = require("./harness/index.cjs");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "WebSpeechAPI");
// This is a dedicated second-screen kiosk. Windows may classify its renderer
// as occluded while the operator works in another app on the primary display;
// never collapse the avatar animation loop to the 1 Hz background cadence.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
// Some Windows kiosk panels expose touch as pointer input but Chromium keeps
// touch event synthesis in automatic mode. Force it on for the packaged app so
// physical finger taps reach React's pointer handlers as well as click events.
app.commandLine.appendSwitch("touch-events", "enabled");
// Keep the kiosk viewport and Windows pointer coordinates in the same physical-pixel space.
// This is required for portrait touch displays configured at 200% scale.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const allowMultipleInstances = process.argv.includes("--allow-multiple-instances");
const hasSingleInstanceLock = allowMultipleInstances || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const legacyUserDataPath = app.getPath("userData");
const stableUserDataPath = path.join(app.getPath("appData"), "XiaoAnHealthKiosk");
app.setPath("userData", stableUserDataPath);
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
if (allowMultipleInstances && userDataArgument) {
  app.setPath("userData", path.resolve(userDataArgument.slice("--user-data-dir=".length)));
}

let healthSkillLoader;
let runtimeTelemetry;
let mainWindow;
let stopSoakMonitor = () => {};
let agentHarness;

function isolateWindowsKioskRenderer(rendererPid) {
  if (process.platform !== "win32" || !Number.isInteger(rendererPid) || rendererPid <= 0) return;
  const logicalCpuCount = os.cpus()?.length || 0;
  // The target kiosk has a hybrid 12-thread CPU. Offline VITS only needs two
  // inference threads, while the 4K portrait renderer benefits from the first
  // (performance-core) processor group. Keep this conservative and skip masks
  // that would exceed PowerShell's reliable signed 32-bit affinity range.
  if (logicalCpuCount < 6 || logicalCpuCount > 30) return;
  const rendererCpuCount = Math.max(4, Math.ceil(logicalCpuCount * 2 / 3));
  const rendererMask = (1n << BigInt(rendererCpuCount)) - 1n;
  const allCpuMask = (1n << BigInt(logicalCpuCount)) - 1n;
  const mainMask = allCpuMask ^ rendererMask;
  const command = [
    "$ErrorActionPreference='Stop'",
    `$main=[Diagnostics.Process]::GetProcessById(${process.pid})`,
    `$renderer=[Diagnostics.Process]::GetProcessById(${rendererPid})`,
    `$main.ProcessorAffinity=[IntPtr]${mainMask}`,
    `$renderer.ProcessorAffinity=[IntPtr]${rendererMask}`,
  ].join(";");
  try {
    const helper = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle", "Hidden",
      "-Command", command,
    ], { windowsHide: true, stdio: "ignore" });
    helper.once("error", (error) => runtimeTelemetry?.record("runtime", "cpu_affinity_warning", {
      status: "warning",
      message: error?.message || String(error),
    }));
    helper.once("exit", (code) => runtimeTelemetry?.record("runtime", "cpu_affinity_configured", {
      status: code === 0 ? "ok" : "warning",
      code: Number(code) || 0,
      logicalCpuCount,
      mainMask: mainMask.toString(),
      rendererMask: rendererMask.toString(),
    }));
  } catch (error) {
    runtimeTelemetry?.record("runtime", "cpu_affinity_warning", { status: "warning", message: error?.message || String(error) });
  }
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
app.on("before-quit", () => { app.isQuitting = true; });
const activeDeepSeekRequests = new Map();

function migrateLegacyUserData() {
  const activeUserDataPath = app.getPath("userData");
  fs.mkdirSync(activeUserDataPath, { recursive: true });
  const appDataPath = app.getPath("appData");
  const candidates = new Set([
    legacyUserDataPath,
    path.join(appDataPath, "小安数字健康管理师"),
    path.join(appDataPath, "health-kiosk-demo"),
  ]);
  try {
    for (const entry of fs.readdirSync(appDataPath, { withFileTypes: true })) {
      if (entry.isDirectory() && /^小安数字健康管理师 V\d+\.\d+\.\d+$/.test(entry.name)) candidates.add(path.join(appDataPath, entry.name));
    }
  } catch {}
  const ordered = [...candidates]
    .filter((directory) => path.resolve(directory) !== path.resolve(activeUserDataPath) && fs.existsSync(directory))
    .sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    });

  const credentialTarget = path.join(activeUserDataPath, "deepseek.credential");
  if (!fs.existsSync(credentialTarget)) {
    const credentialSource = ordered.map((directory) => path.join(directory, "deepseek.credential")).find((filename) => fs.existsSync(filename));
    if (credentialSource) {
      try { fs.copyFileSync(credentialSource, credentialTarget, fs.constants.COPYFILE_EXCL); } catch {}
    }
  }

  const cacheTarget = path.join(activeUserDataPath, "avatar-video-cache");
  fs.mkdirSync(cacheTarget, { recursive: true });
  const cachedVideos = [];
  for (const directory of ordered) {
    const cacheSource = path.join(directory, "avatar-video-cache");
    try {
      for (const name of fs.readdirSync(cacheSource)) {
        if (!/^[0-9a-f]{64}\.mp4$/.test(name)) continue;
        const filename = path.join(cacheSource, name);
        cachedVideos.push({ filename, name, mtime: fs.statSync(filename).mtimeMs });
      }
    } catch {}
  }
  cachedVideos.sort((a, b) => b.mtime - a.mtime);
  for (const entry of cachedVideos.slice(0, 96)) {
    const target = path.join(cacheTarget, entry.name);
    if (fs.existsSync(target)) continue;
    try { fs.copyFileSync(entry.filename, target, fs.constants.COPYFILE_EXCL); } catch {}
  }
}

function readPcm16Wave(filename) {
  const data = fs.readFileSync(filename);
  const sampleRate = data.readUInt32LE(24);
  const channels = data.readUInt16LE(22);
  const bitsPerSample = data.readUInt16LE(34);
  let offset = 12;
  while (offset + 8 <= data.length && data.toString("ascii", offset, offset + 4) !== "data") {
    offset += 8 + data.readUInt32LE(offset + 4);
  }
  if (offset + 8 > data.length || bitsPerSample !== 16) throw new Error("自检 WAV 必须是 PCM16 格式");
  const byteLength = data.readUInt32LE(offset + 4);
  const frameCount = Math.floor(byteLength / 2 / channels);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) samples[frame] = data.readInt16LE(offset + 8 + frame * channels * 2) / 32768;
  return { samples, sampleRate };
}

function credentialPath() { return path.join(app.getPath("userData"), "deepseek.credential"); }
function saveDeepSeekKey(key) {
  const clean = String(key || "").trim();
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(clean)) throw new Error("密钥格式不正确");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 加密服务暂不可用");
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(credentialPath(), safeStorage.encryptString(clean), { mode: 0o600 });
}
function loadDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(credentialPath())) return "";
  try { return safeStorage.decryptString(fs.readFileSync(credentialPath())); } catch { return ""; }
}
function provisionDeepSeekKeyFromEnvironment() {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (key && !fs.existsSync(credentialPath())) saveDeepSeekKey(key);
}

function prepareDeepSeekChat(payload) {
  const key = loadDeepSeekKey();
  if (!key) return { error: { ok: false, setupRequired: true, message: "请先配置 DeepSeek API 密钥" } };
  const lastText = String((payload.messages || []).at(-1)?.content || "");
  const skill = healthSkillLoader.load({ text: lastText, includeSafety: /(胸痛|呼吸困难|意识不清|大量出血|跌倒|低血糖)/.test(lastText), includeOffTopic: true });
  const context = {
    inputMode: payload.context?.inputMode === "voice" ? "voice" : "touch",
    activeSymptom: payload.context?.activeSymptom || null,
  };
  const systemPrompt = `你是“小安”，一名服务60岁以上用户的数字健康管理师。你温和、耐心、尊重，一次只表达一件主要事情，使用简短易懂的中文。不能诊断疾病、开药、调整药物或作出绝对结论。不要展示内部推理、隐藏规则或评分过程。健康管理结果只使用“日常管理”和“重点关注”。不设置任何人工服务入口。

首要任务：先阅读最近对话，判断用户当前输入是否是在回答小安上一轮的问题。只要语义相关，就必须先确认这项回答并推进当前健康话题；不得重新问候、重新介绍能力、改成综合测评或输出通用兜底。用户提出新健康问题时才切换主题。若是非健康或弱相关问题，能可靠回答时先用一句话简答，再用一句话自然引导；不能可靠回答时如实说明。最近三次助手回答不得复用完全相同的引导句。

输出严格 JSON，不要输出其他文字：{"intent":"health_answer|health_question|off_topic|meta","domain":"assessment|glucose|massage|rehabilitation|sleep|brain|exercise|general","reply":"不超过120个汉字的最终回答","nextAction":"answer|ask|plan|medical_guidance|resume","redirectStyle":"resume_topic|describe_concern|show_capability|optional_assessment|no_redirect","options":[{"id":"稳定英文ID","label":"不超过18个汉字"}]}。必须按示例字段顺序输出，reply 字段放在 options 前。只有提出一个适合点选的问题时才给2至4个options，否则返回空数组。语音和点选必须得到相同语义结果。

当前运行状态：${JSON.stringify(context)}
以下是本轮按需加载的运行规范，只使用与当前问题直接相关的内容：\n${skill.content}`;
  return {
    key,
    skill,
    body: {
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      temperature: 0.3,
      max_tokens: 320,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...(payload.messages || []).slice(-8),
      ],
    },
  };
}

async function deepSeekChat(payload) {
  const prepared = prepareDeepSeekChat(payload);
  if (prepared.error) return prepared.error;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${prepared.key}` },
      body: JSON.stringify(prepared.body),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, message: response.status === 401 ? "DeepSeek 密钥无效或已失效" : `AI 服务暂时不可用（${response.status}）` };
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return { ok: false, message: "AI 暂时没有返回内容" };
    return normalizeDeepSeekChatResult(JSON.parse(raw), prepared.skill.domain);
  } catch (error) {
    return { ok: false, message: error?.name === "AbortError" ? "智能对话响应超时，已切换为本地健康助手" : "网络暂时不可用，已切换为本地健康助手" };
  } finally { clearTimeout(timeout); }
}

async function deepSeekChatStream(sender, payload) {
  const prepared = prepareDeepSeekChat(payload);
  if (prepared.error) return prepared.error;
  const requestId = String(payload.requestId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!requestId) return { ok: false, message: "流式请求缺少 requestId" };
  activeDeepSeekRequests.get(requestId)?.abort();
  const controller = new AbortController();
  activeDeepSeekRequests.set(requestId, controller);
  const emit = (message) => {
    if (!sender.isDestroyed()) sender.send("deepseek:chunk", { requestId, ...message });
  };
  try {
    return await requestDeepSeekStream({
      key: prepared.key,
      body: prepared.body,
      domain: prepared.skill.domain,
      requestId,
      controller,
      onEvent: emit,
    });
  } catch (error) {
    return { ok: false, message: error?.message || "网络暂时不可用，已切换为本地健康助手" };
  } finally {
    if (activeDeepSeekRequests.get(requestId) === controller) activeDeepSeekRequests.delete(requestId);
  }
}

function cancelDeepSeekRequest(requestId) {
  const key = String(requestId || "").trim();
  const controller = activeDeepSeekRequests.get(key);
  if (!controller) return false;
  controller.abort("cancelled");
  activeDeepSeekRequests.delete(key);
  return true;
}

async function interpretSymptom(payload) {
  const key = loadDeepSeekKey();
  if (!key) return { ok: false, setupRequired: true, message: "未配置智能理解，已使用本地安全规则" };
  const question = payload.question || {};
  const options = Array.isArray(payload.options) ? payload.options.slice(0, 4) : [];
  const optionIds = new Set(options.map((item) => item.id));
  const answer = String(payload.text || "").trim();
  if (!question.id || !answer || optionIds.size < 2) return { ok: false, message: "症状问答输入不完整" };
  const skill = healthSkillLoader.load({ text: `${payload.symptom || ""} ${answer}`, includeSafety: true });
  const systemPrompt = `你负责理解60岁以上用户对当前症状问题的自然语音回答。根据完整语义把回答映射到最接近的选项ID；“没有”“都没有”等简短回答要结合当前问题理解，不能当作无关内容。先识别危险信号。不得诊断、评分、改写问题或生成新选项。输出严格 JSON：{"optionId":"选项ID或null","confidence":0.0,"acknowledgement":"不超过20个汉字、针对本次回答的自然确认","safetySignal":false}。只可使用给定选项ID。\n${skill.content}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        temperature: 0.1,
        max_tokens: 180,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ question: { id: question.id, text: question.text }, options, answer }) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, message: `症状智能理解暂时不可用（${response.status}）` };
    const data = await response.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    if (parsed.safetySignal) {
      return { ok: true, safetySignal: { type: "ai-detected", message: "请立即停止当前问答并立即就医；不要自行驾车，也不要继续等待测评结果。" } };
    }
    const optionId = optionIds.has(parsed.optionId) ? parsed.optionId : null;
    return {
      ok: true,
      optionId: Number(parsed.confidence) >= 0.55 ? optionId : null,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      acknowledgement: String(parsed.acknowledgement || "").trim().slice(0, 20),
    };
  } catch (error) {
    return { ok: false, message: error?.name === "AbortError" ? "症状智能理解超时" : "症状智能理解暂时不可用" };
  } finally { clearTimeout(timeout); }
}

async function interpretAssessment(payload) {
  const key = loadDeepSeekKey();
  if (!key) return { ok: false, setupRequired: true, message: "未配置智能理解，已使用本地理解" };
  const question = payload.question || {};
  const optionIds = new Set((question.options || []).map((option) => option.id));
  if (!question.id || !optionIds.size || !String(payload.text || "").trim()) return { ok: false, message: "测评输入不完整" };
  const skill = healthSkillLoader.load({ domain: "assessment", text: payload.text, includeSafety: true });
  const systemPrompt = `你负责理解60岁以上用户对当前健康测评题的口语回答。先识别安全信号，再根据语义、否定、程度和数字表达映射到给定选项。你不能评分，不能改变题序，不能诊断或调整药物。输出严格 JSON，不要输出其他文字。格式示例：{"answerId":"选项ID或null","confidence":0.92,"needsClarification":false,"candidates":[{"answerId":"选项ID","confidence":0.92}],"clarificationPrompt":"需要时的一句追问","safetySignal":null,"rationale":"简短依据"}。中等置信度最多给2个候选；低置信度围绕当前题追问。安全信号格式为 {"type":"类别","message":"检测到需要优先关注的安全信号，本题暂不记录。请先停止测评，并按您已有的医疗联系安排处理。"}。只可使用题目提供的选项ID。\n${skill.content}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        temperature: 0.1,
        max_tokens: 260,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ question, answer: String(payload.text) }) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, message: `智能理解暂时不可用（${response.status}），已使用本地理解` };
    const data = await response.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : []).filter((item) => optionIds.has(item?.answerId)).slice(0, 2);
    const answerId = optionIds.has(parsed.answerId) ? parsed.answerId : null;
    return { ok: true, result: { ...parsed, answerId, candidates, confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)) } };
  } catch (error) {
    return { ok: false, message: error?.name === "AbortError" ? "智能理解响应超时，已使用本地理解" : "智能理解暂时不可用，已使用本地理解" };
  } finally { clearTimeout(timeout); }
}

function createWindow() {
  const displays = screen.getAllDisplays();
  const targetDisplay = displays
    .filter((display) => display.bounds.height > display.bounds.width)
    .sort((left, right) => (right.bounds.width * right.bounds.height) - (left.bounds.width * left.bounds.height))[0]
    || screen.getPrimaryDisplay();
  const targetBounds = targetDisplay.bounds;
  const windowed = process.argv.includes("--windowed");
  const windowWidth = windowed ? Math.min(750, targetBounds.width) : targetBounds.width;
  const windowHeight = windowed ? Math.min(1200, targetBounds.height) : targetBounds.height;
  const win = new BrowserWindow({
    x: targetBounds.x + Math.floor((targetBounds.width - windowWidth) / 2),
    y: targetBounds.y + Math.floor((targetBounds.height - windowHeight) / 2),
    width: windowWidth, height: windowHeight, minWidth: 600, minHeight: 960,
    backgroundColor: "#eaf7fa", autoHideMenuBar: true, frame: false,
    fullscreen: !windowed, kiosk: process.argv.includes("--kiosk"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: process.argv.includes("--qa-avatar") ? ["--qa-avatar"] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep audio-clock mouth motion and natural blinking alive when an
      // operator briefly focuses another window beside the portrait kiosk.
      backgroundThrottling: false,
    },
  });
  const appSession = win.webContents.session;
  appSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => permission === "media" && (details?.mediaType === "audio" || details?.mediaTypes?.includes?.("audio")));
  appSession.setPermissionRequestHandler((_webContents, permission, callback, details) => callback(permission === "media" && (details?.mediaTypes?.includes?.("audio") || !details?.mediaTypes?.length)));
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl); else win.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("did-finish-load", () => {
    // Offline VITS runs on worker threads in the main process. Give the 4K
    // portrait renderer scheduling precedence so PCM generation cannot starve
    // requestAnimationFrame during visible mouth and jaw transitions.
    try {
      const rendererPid = win.webContents.getOSProcessId();
      if (rendererPid > 0) {
        os.setPriority(rendererPid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
        isolateWindowsKioskRenderer(rendererPid);
      }
    } catch (error) {
      runtimeTelemetry?.record("runtime", "renderer_priority_warning", { status: "warning", message: error?.message || String(error) });
    }
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    runtimeTelemetry?.record("runtime", "renderer_gone", { status: "error", exitCode: Number(details?.exitCode) || 0 });
    if (!win.isDestroyed() && !app.isQuitting) setTimeout(() => win.reload(), 1200);
  });
  win.webContents.on("unresponsive", () => runtimeTelemetry?.record("runtime", "unresponsive", { status: "error" }));
  win.webContents.on("responsive", () => runtimeTelemetry?.record("runtime", "responsive", { status: "ok" }));
  win.webContents.on("did-fail-load", (_event, errorCode) => runtimeTelemetry?.record("runtime", "load_error", { status: "error", errorCode: Number(errorCode) || 0 }));
  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11") { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if (input.control && input.shift && input.key.toLowerCase() === "q") app.quit();
  });
  return win;
}

app.whenReady().then(async () => {
  migrateLegacyUserData();
  provisionDeepSeekKeyFromEnvironment();
  const speech = createSpeechService({ app });
  const avatar = createAvatarService({ cacheDir: path.join(app.getPath("userData"), "avatar-video-cache") });
  runtimeTelemetry = createRuntimeTelemetry({ directory: path.join(app.getPath("userData"), "telemetry") });
  try {
    // VITS workers share the Electron main process. Keep that CPU work below
    // the visible 4K renderer, which is promoted separately after page load.
    os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (error) {
    runtimeTelemetry.record("runtime", "main_priority_warning", { status: "warning", message: error?.message || String(error) });
  }
  healthSkillLoader = createSkillLoader({ app });
  agentHarness = createXiaoanHarness();
  if (process.argv.includes("--harness-self-test")) {
    const checks = await Promise.all([
      agentHarness.run({ runId: "selftest-meal", sessionId: "selftest", text: "助餐服务几点开始" }),
      agentHarness.run({ runId: "selftest-lecture", sessionId: "selftest", text: "健康讲堂讲什么" }),
      agentHarness.run({ runId: "selftest-member", sessionId: "selftest", text: "查询我的积分", actor: { role: "anonymous", authLevel: "none", scopes: [] } }),
    ]);
    const memory = agentHarness.memory("selftest");
    const sensitiveMemory = memory.turns.find((turn) => turn.sensitive);
    const report = {
      ok: checks[0]?.status === "completed" && checks[1]?.status === "completed" && checks[2]?.status === "auth_required" && memory.turns.length === 3 && sensitiveMemory?.userText === null && sensitiveMemory?.assistantText === null,
      packaged: app.isPackaged,
      tools: agentHarness.status().tools.map((tool) => tool.name),
      memory: { ...agentHarness.status().memory, turns: memory.turns.length, sensitiveRedacted: sensitiveMemory?.userText === null && sensitiveMemory?.assistantText === null },
      checks: checks.map((result) => ({ runId: result.runId, status: result.status, intent: result.intent, trace: result.trace?.map((event) => event.type) })),
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    speech.close(); app.exit(report.ok ? 0 : 1); return;
  }
  if (process.argv.includes("--speech-self-test")) {
    try {
      const modelsRoot = app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(app.getAppPath(), "models");
      const wav = readPcm16Wave(path.join(modelsRoot, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17", "test_wavs", "zh.wav"));
      const asr = await speech.recognize({ samples: wav.samples, sampleRate: wav.sampleRate });
      const tts = await speech.synthesize({ text: "小安离线语音自检通过。", speed: 1, voiceId: "zh-ll-2" });
      if (!asr.ok || !tts.ok || !tts.samples?.length) throw new Error(asr.message || tts.message || "语音自检没有返回结果");
      process.stdout.write(`Speech self-test OK: ${asr.text}\n`);
      speech.close(); app.exit(0); return;
    } catch (error) {
      process.stderr.write(`Speech self-test failed: ${error?.stack || error}\n`);
      speech.close(); app.exit(1); return;
    }
  }
  if (process.argv.includes("--diagnostics-json")) {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const modelsRoot = app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(app.getAppPath(), "models");
      const requiredModels = [
        "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
        "sherpa-onnx-vits-zh-ll",
      ];
      const report = {
        ok: requiredModels.every((name) => fs.existsSync(path.join(modelsRoot, name))),
        version: app.getVersion(),
        packaged: app.isPackaged,
        expectedKioskViewport: { width: 1200, height: 1920, contentRotation: 0 },
        display: { rotation: primaryDisplay.rotation, scaleFactor: primaryDisplay.scaleFactor, bounds: primaryDisplay.bounds, workArea: primaryDisplay.workArea },
        models: Object.fromEntries(requiredModels.map((name) => [name, fs.existsSync(path.join(modelsRoot, name))])),
        speech: speech.status(),
        aiConfigured: Boolean(loadDeepSeekKey()),
        userDataPath: app.getPath("userData"),
      };
      const diagnosticsFile = path.join(app.getPath("userData"), "diagnostics-latest.json");
      fs.mkdirSync(app.getPath("userData"), { recursive: true });
      fs.writeFileSync(diagnosticsFile, `${JSON.stringify({ ...report, diagnosticsFile }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      process.stdout.write(`${JSON.stringify(report)}\n`);
      speech.close(); app.exit(report.ok ? 0 : 1); return;
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ ok: false, message: error?.message || String(error) })}\n`);
      speech.close(); app.exit(1); return;
    }
  }
  ipcMain.handle("speech:status", () => speech.status());
  ipcMain.handle("speech:recognize", async (_event, payload) => {
    const started = performance.now();
    const result = await speech.recognize(payload || {});
    runtimeTelemetry.record("asr", result?.ok ? "complete" : "error", { durationMs: performance.now() - started, ok: Boolean(result?.ok), sampleRate: Number(payload?.sampleRate) || 0 });
    return result;
  });
  ipcMain.handle("speech:recognize-preview", (_event, payload) => speech.recognizePreview(payload || {}));
  ipcMain.handle("speech:synthesize", async (_event, payload) => {
    const started = performance.now();
    const result = await speech.synthesize(payload || {});
    runtimeTelemetry.record("tts", result?.ok ? "complete" : result?.cancelled ? "cancelled" : "error", { durationMs: performance.now() - started, ok: Boolean(result?.ok), cancelled: Boolean(result?.cancelled) });
    return result;
  });
  ipcMain.handle("speech:synthesize-stream", async (event, payload) => {
    const started = performance.now();
    const turnId = String(payload?.turnId || "").trim().slice(0, 120);
    const streamId = String(payload?.streamId || "").trim().slice(0, 120);
    const result = await speech.synthesizeStream(payload || {}, (chunk) => {
      if (!event.sender.isDestroyed()) event.sender.send("speech:stream-event", { type: "chunk", turnId, streamId, ...chunk });
    });
    runtimeTelemetry.record("tts", result?.ok ? "stream_complete" : result?.cancelled ? "stream_cancelled" : "stream_error", {
      durationMs: performance.now() - started,
      firstChunkMs: Number(result?.firstChunkMs) || 0,
      chunkCount: Number(result?.chunkCount) || 0,
      ok: Boolean(result?.ok),
      cancelled: Boolean(result?.cancelled),
    });
    return result;
  });
  ipcMain.handle("speech:align", async (_event, payload) => {
    const started = performance.now();
    const result = await speech.align(payload || {});
    runtimeTelemetry.record("lip_alignment", result?.ok ? "complete" : result?.cancelled ? "cancelled" : "error", {
      durationMs: performance.now() - started,
      ok: Boolean(result?.ok),
      cancelled: Boolean(result?.cancelled),
      cached: Boolean(result?.cached),
      provider: result?.alignment?.provider || "unavailable",
      eventCount: Array.isArray(result?.visemes) ? result.visemes.length : 0,
    });
    return result;
  });
  ipcMain.handle("speech:cancel", (_event, turnId) => ({ ok: true, cancelled: speech.cancelTurn(turnId) }));
  ipcMain.handle("avatar:status", () => avatar.status());
  ipcMain.handle("avatar:render", async (_event, payload) => {
    const started = performance.now();
    const result = await avatar.renderText({ ...(payload || {}), synthesize: (options) => speech.synthesize(options) });
    runtimeTelemetry.record("avatar", result?.ok ? "complete" : result?.cancelled ? "cancelled" : "error", { durationMs: performance.now() - started, ok: Boolean(result?.ok), cancelled: Boolean(result?.cancelled), cacheHit: Boolean(result?.cacheHit), renderSeconds: Number(result?.renderSeconds) || 0, queueSeconds: Number(result?.queueSeconds) || 0 });
    return result;
  });
  ipcMain.handle("avatar:render-stream", async (event, payload) => {
    const started = performance.now();
    const turnId = String(payload?.turnId || "").trim().slice(0, 120);
    const result = await avatar.streamText({
      ...(payload || {}),
      turnId,
      synthesize: (options) => speech.synthesize(options),
      onEvent: (message) => {
        if (!event.sender.isDestroyed()) event.sender.send("avatar:stream-event", { turnId, ...message });
      },
    });
    runtimeTelemetry.record("avatar-frame-stream", result?.ok ? "complete" : result?.cancelled ? "cancelled" : "error", {
      durationMs: performance.now() - started,
      ok: Boolean(result?.ok),
      cancelled: Boolean(result?.cancelled),
      frameCount: Number(result?.frameCount) || 0,
      firstFrameMs: Number(result?.firstFrameMs) || 0,
    });
    return result;
  });
  ipcMain.handle("avatar:cancel", (_event, turnId) => ({ ok: true, cancelled: avatar.cancelTurn(turnId) }));
  ipcMain.handle("deepseek:status", () => ({ configured: Boolean(loadDeepSeekKey()) }));
  ipcMain.handle("deepseek:save-key", (_event, key) => { saveDeepSeekKey(key); return { ok: true }; });
  ipcMain.handle("deepseek:clear-key", () => { if (fs.existsSync(credentialPath())) fs.rmSync(credentialPath()); return { ok: true }; });
  ipcMain.handle("deepseek:chat", (_event, payload) => deepSeekChat(payload || {}));
  ipcMain.handle("deepseek:chat-stream", async (event, payload) => {
    const result = await deepSeekChatStream(event.sender, payload || {});
    runtimeTelemetry.record("deepseek", result?.ok ? "complete" : result?.cancelled ? "cancelled" : "error", { ok: Boolean(result?.ok), cancelled: Boolean(result?.cancelled), firstTokenMs: result?.timings?.firstTokenMs ?? null, firstReplyMs: result?.timings?.firstReplyMs ?? null, totalMs: result?.timings?.totalMs ?? null });
    return result;
  });
  ipcMain.handle("deepseek:cancel", (_event, requestId) => ({ ok: true, cancelled: cancelDeepSeekRequest(requestId) }));
  ipcMain.handle("deepseek:interpret-assessment", (_event, payload) => interpretAssessment(payload || {}));
  ipcMain.handle("deepseek:interpret-symptom", (_event, payload) => interpretSymptom(payload || {}));
  ipcMain.handle("agent:turn", (_event, payload) => agentHarness.run(payload || {}));
  ipcMain.handle("agent:cancel", (_event, runId) => ({ ok: true, cancelled: agentHarness.cancel(runId) }));
  ipcMain.handle("agent:memory", (_event, sessionId) => agentHarness.memory(sessionId));
  ipcMain.handle("agent:clear-session", (_event, sessionId) => ({ ok: true, cleared: agentHarness.clearSession(sessionId) }));
  ipcMain.handle("agent:status", () => agentHarness.status());
  ipcMain.handle("runtime:status", async () => {
    const [speechStatus, avatarStatus] = await Promise.all([speech.status(), avatar.status()]);
    const windowBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const display = windowBounds ? screen.getDisplayMatching(windowBounds) : screen.getPrimaryDisplay();
    return {
      ok: Boolean(speechStatus?.ready),
      version: app.getVersion(),
      packaged: app.isPackaged,
      aiConfigured: Boolean(loadDeepSeekKey()),
      speech: speechStatus,
      avatar: avatarStatus,
      activeAiRequests: activeDeepSeekRequests.size,
      window: windowBounds,
      display: display ? { id: display.id, rotation: display.rotation, scaleFactor: display.scaleFactor, bounds: display.bounds, workArea: display.workArea } : null,
      expectedKioskViewport: { width: 1200, height: 1920, contentRotation: 0 },
      recentMetrics: runtimeTelemetry.snapshot().slice(-20),
      harness: agentHarness.status(),
    };
  });
  ipcMain.handle("app:exit", () => app.quit());
  mainWindow = createWindow();
  const speechWarmupStarted = performance.now();
  speech.warmup("zh-ll-2").then((result) => {
    runtimeTelemetry.record("tts", result?.ok ? "warmup_complete" : "warmup_error", { durationMs: performance.now() - speechWarmupStarted, ok: Boolean(result?.ok), modelId: result?.modelId || "zh-ll" });
  }).catch((error) => {
    runtimeTelemetry.record("tts", "warmup_error", { durationMs: performance.now() - speechWarmupStarted, ok: false, message: error?.message || String(error) });
  });
  const soakDurationMs = parseSoakDuration(process.argv);
  if (soakDurationMs > 0) {
    stopSoakMonitor = startSoakMonitor({
      app,
      screen,
      window: mainWindow,
      speechReady: speech.status().ready,
      durationMs: soakDurationMs,
      onComplete: (report) => {
        const reportFile = path.join(app.getPath("userData"), "soak-latest.json");
        fs.mkdirSync(app.getPath("userData"), { recursive: true });
        fs.writeFileSync(reportFile, `${JSON.stringify({ ...report, reportFile }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        process.stdout.write(`${JSON.stringify({ ...report, reportFile })}\n`);
        speech.close();
        app.exit(report.ok ? 0 : 1);
      },
    });
  }
  globalShortcut.register("CommandOrControl+Shift+Q", () => app.quit());
  app.once("will-quit", () => {
    stopSoakMonitor();
    for (const controller of activeDeepSeekRequests.values()) controller.abort("shutdown");
    activeDeepSeekRequests.clear();
    speech.close();
  });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => globalShortcut.unregisterAll());
