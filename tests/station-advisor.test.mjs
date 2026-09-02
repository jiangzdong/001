import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  advisorAutoSendDelayMs,
  advisorTrustedOfflineAsrProvider,
  getAdvisorSubmissionPolicy,
  resolveAdvisorIntent,
} from "../src/stationAdvisorInput.js";

const advisorPath = new URL("../src/StationAdvisorApp.jsx", import.meta.url);
const stylesPath = new URL("../src/station-advisor.css", import.meta.url);
const mainPath = new URL("../src/main.jsx", import.meta.url);
const speechHookPath = new URL("../src/useStationAdvisorSpeech.js", import.meta.url);
const speechServicePath = new URL("../electron/speech-service.cjs", import.meta.url);
const electronMainPath = new URL("../electron/main.cjs", import.meta.url);
const preloadPath = new URL("../electron/preload.cjs", import.meta.url);
const vitePath = new URL("../vite.config.mjs", import.meta.url);

test("station advisor is the active local portrait demo", async () => {
  const [advisor, styles, main] = await Promise.all([
    readFile(advisorPath, "utf8"),
    readFile(stylesPath, "utf8"),
    readFile(mainPath, "utf8"),
  ]);

  assert.match(main, /import \{ StationAdvisorApp \}/);
  assert.match(main, /<StationAdvisorApp \/>/);
  assert.match(styles, /width: min\(100vw, 62\.5dvh\)/);
  assert.match(styles, /height: min\(100dvh, 160vw\)/);
  assert.match(advisor, /柳州康养服务站 · \{appVersion\}/);
  assert.match(advisor, /StationAdvisorDigitalHuman/);
  assert.match(advisor, /xiaoa-fullbody-extension-v1\.0\.0\.png/);
  assert.match(advisor, /advisor-screen-backdrop/);
  assert.match(styles, /\.advisor-screen-backdrop > img \{[\s\S]*object-fit: cover;[\s\S]*filter: blur/);
  assert.match(styles, /@media \(min-aspect-ratio: 5 \/ 8\)[\s\S]*mask-image: linear-gradient/);
  assert.match(advisor, /advisor-scene-flow/);
  assert.match(styles, /\.advisor-scene-flow \{[\s\S]*radial-gradient/);
  assert.doesNotMatch(styles, /\.advisor-home::before \{[\s\S]*border-radius: 50%/);
  assert.match(styles, /\.advisor-greeting::after/);
  assert.match(advisor, /useStationAdvisorSpeech/);
});

test("conversation keeps the full digital-human interaction skeleton instead of a compact avatar", async () => {
  const advisor = await readFile(advisorPath, "utf8");
  const conversation = advisor.match(
    /function ConversationScreen\([\s\S]*?\n\}\n\nfunction ConsentScreen/,
  )?.[0] || "";

  assert.match(conversation, /<main className="advisor-conversation">/);
  assert.match(conversation, /<AvatarStage(?:\s+home)?\s+\{\.\.\.avatarProps\}\s*\/>/);
  assert.doesNotMatch(conversation, /<AvatarStage\s+compact|\bis-compact\b/);
  assert.match(conversation, /advisor-chat-stream/);
  assert.match(conversation, /advisor-message--user/);
  assert.match(conversation, /advisor-message--assistant/);
  assert.match(conversation, /advisor-message__agents/);
  assert.match(conversation, /advisor-message--recognizing/);
  assert.doesNotMatch(conversation, /<AdvisorRecognition/);
  assert.match(conversation, /<AdvisorComposer \{\.\.\.composerProps\}/);
});

test("every secondary flow reuses the same full digital-human stage", async () => {
  const [advisor, styles] = await Promise.all([
    readFile(advisorPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  for (const component of ["ConsentScreen", "ScanScreen", "MemberScreen"]) {
    const start = advisor.indexOf(`function ${component}(`);
    const next = advisor.indexOf("\nfunction ", start + 1);
    const source = advisor.slice(start, next === -1 ? advisor.length : next);
    assert.match(source, /avatarProps/);
    assert.match(source, /<AvatarStage home \{\.\.\.avatarProps\} \/>/);
    assert.doesNotMatch(source, /<AdvisorComposer/);
  }

  assert.match(advisor, /<ConsentScreen avatarProps=\{avatarProps\}/);
  assert.match(advisor, /<ScanScreen avatarProps=\{avatarProps\}/);
  assert.match(advisor, /<MemberScreen avatarProps=\{avatarProps\}/);
  assert.match(styles, /\.advisor-secondary-content \{[\s\S]*?z-index: 6;[\s\S]*?max-height:[\s\S]*?overflow-y: auto;/);
  assert.doesNotMatch(styles, /\.advisor-secondary-content\s*\{[^}]*border-(?:left|right)/);
});

test("personal data path is consent-first and clears back to home", async () => {
  const advisor = await readFile(advisorPath, "utf8");

  assert.match(advisor, /setScreen\("consent"\)/);
  assert.match(advisor, /同意并开始身份确认/);
  assert.match(advisor, /不保存照片，不连接生产会员系统/);
  assert.match(advisor, /认证失败不会展示其他人的头像或姓名/);
  assert.match(advisor, /结束个人查询并清除信息/);
  assert.match(advisor, /const goHome = useCallback\(\(\) => \{/);
  assert.match(advisor, /clearAgentSession\?\.\("station-advisor"\)/);
  assert.match(advisor, /setAutoVoiceEnabled\(true\);[\s\S]*setDraft\(""\);[\s\S]*setResponseId\(""\);[\s\S]*setScreen\("home"\);/);
});

test("local fixtures provide deterministic activity and member values", async () => {
  const advisor = await readFile(advisorPath, "utf8");

  assert.match(advisor, /上午 9:30 有八段锦/);
  assert.match(advisor, />2,680</);
  assert.match(advisor, />¥ 126\.00</);
  assert.match(advisor, /积分数值由本地固定演示数据提供，小安不会自行计算/);
  assert.match(advisor, /fetch\("\/api\/speech\/status"/);
  assert.match(advisor, /fetch\("\/api\/speech\/recognize"/);
  assert.doesNotMatch(advisor, /axios|WebSocket|fetch\("https?:\/\//);
});

test("every non-empty final recognition result is sent immediately without confirmation", () => {
  assert.equal(advisorAutoSendDelayMs, 0);
  assert.deepEqual(getAdvisorSubmissionPolicy({ text: "今天站点有什么活动", confidence: 0.96 }), {
    mode: "auto", reason: "recognized-final", delayMs: 0,
  });
  assert.deepEqual(getAdvisorSubmissionPolicy({ text: "帮我查一下会员积分", confidence: 0.99 }), {
    mode: "auto", reason: "recognized-final", delayMs: 0,
  });
  assert.deepEqual(getAdvisorSubmissionPolicy({ text: "站点有什么服务", confidence: 0.48 }), {
    mode: "auto", reason: "recognized-final", delayMs: 0,
  });
  assert.deepEqual(getAdvisorSubmissionPolicy({ text: "" }), { mode: "blocked", reason: "empty" });
});

test("the UI finalization path sends in the same turn without a confirmation timer", async () => {
  const advisor = await readFile(advisorPath, "utf8");
  const finalizeRecognition = advisor.match(
    /const finalizeRecognition = useCallback\(\(text\) => \{[\s\S]*?\n  \}, \[cancelAutoSubmit, submitText\]\);/,
  )?.[0] || "";

  assert.match(finalizeRecognition, /setVoiceMessage\("识别完成，正在发送"\)/);
  assert.match(finalizeRecognition, /voiceStateRef\.current = "submitting";[\s\S]*submitText\(recognizedText\);/);
  assert.doesNotMatch(finalizeRecognition, /setTimeout|setInterval|SCHEDULE_AUTO_SUBMIT|AUTO_SUBMIT_DUE/);
  assert.doesNotMatch(advisor, /请确认识别内容|确认后发送|秒后自动发送|自动发送倒计时/);
});

test("confidence and provider metadata do not insert a second confirmation step", () => {
  for (const confidence of [undefined, null, 0, 0.48, 0.96, Number.NaN, Number.POSITIVE_INFINITY, "0.96"]) {
    assert.deepEqual(getAdvisorSubmissionPolicy({ text: "今天站点有什么活动", confidence }), {
      mode: "auto", reason: "recognized-final", delayMs: 0,
    });
  }
});

test("trusted offline and web speech final transcripts share direct-send policy", () => {
  assert.equal(advisorTrustedOfflineAsrProvider, "sherpa-onnx-sensevoice-local");
  for (const input of [
    { provider: advisorTrustedOfflineAsrProvider, trustedFinal: true },
    { provider: "web-speech", trustedFinal: false },
  ]) {
    assert.deepEqual(getAdvisorSubmissionPolicy({ text: "站点有什么服务", ...input }), {
      mode: "auto", reason: "recognized-final", delayMs: 0,
    });
  }
});

test("typed and recognized text share one deterministic intent router", () => {
  assert.equal(resolveAdvisorIntent("今天有八段锦吗？"), "activities");
  assert.equal(resolveAdvisorIntent("助餐服务几点开始"), "services");
  assert.equal(resolveAdvisorIntent("我的余额还有多少"), "points");
  assert.equal(resolveAdvisorIntent("我想问其他事情"), "generic");
});

test("station business questions use the Agent Harness with a safe fallback", async () => {
  const advisor = await readFile(advisorPath, "utf8");
  assert.match(advisor, /window\.kioskBridge\?\.agentTurn/);
  assert.match(advisor, /cancelAgentTurn\?\.\(agentRunRef\.current\)/);
  assert.match(advisor, /actor: \{ role: "anonymous", authLevel: "none", subjectToken: null, scopes: \[\] \}/);
  assert.match(advisor, /result\?\.status === "auth_required" \? responses\.points : responseFromHarness/);
});

test("voice and keyboard share one editable composer with privacy-safe fallback", async () => {
  const advisor = await readFile(advisorPath, "utf8");

  assert.match(advisor, /aria-label="站点咨询问题"/);
  assert.match(advisor, /enterKeyHint="send"/);
  assert.match(advisor, /event\.key !== "Enter" \|\| event\.nativeEvent\?\.isComposing/);
  assert.match(advisor, /支持自动识别，也可以点击输入/);
  assert.match(advisor, /window\.kioskBridge\?\.recognizePcm/);
  assert.match(advisor, /isLocalSpeechApiReady\(\)/);
  assert.match(advisor, /get\("allowWebSpeech"\) === "1"/);
  assert.doesNotMatch(advisor, /localStorage|sessionStorage|console\.(?:log|info|debug)/);
});

test("keyboard trigger enters an explicit stable mode with an in-app Chinese touch keyboard", async () => {
  const [advisor, keyboard, styles, electronMain, preload] = await Promise.all([
    readFile(advisorPath, "utf8"),
    readFile(new URL("../src/AdvisorChineseKeyboard.jsx", import.meta.url), "utf8"),
    readFile(stylesPath, "utf8"),
    readFile(electronMainPath, "utf8"),
    readFile(preloadPath, "utf8"),
  ]);

  assert.match(advisor, /data-testid="advisor-keyboard-trigger"/);
  assert.match(advisor, /aria-label="打开应用内中文键盘"/);
  assert.match(advisor, /inputMode="text"/);
  assert.match(advisor, /AdvisorChineseKeyboard/);
  assert.match(advisor, /keyboardMode[\s\S]*\? "键盘输入"/);
  assert.match(advisor, /setKeyboardMode\(true\)[\s\S]*stopVoice\(\{ discard: true \}\)/);
  assert.match(keyboard, /data-testid="advisor-soft-keyboard"/);
  assert.match(keyboard, /应用内中文拼音键盘/);
  assert.match(keyboard, /onPointerDown=\{\(event\) => \{[\s\S]*event\.pointerType === "touch"[\s\S]*event\.preventDefault\(\)/);
  assert.match(keyboard, /suppressCompatibilityClickUntil = performance\.now\(\) \+ 650/);
  assert.match(keyboard, /label="发送问题" onPress=\{onSubmit\}/);
  assert.match(advisor, /onClose=\{\(\) => \{[\s\S]*handleDraftChange\(""\);[\s\S]*setKeyboardMode\(false\);/);
  assert.match(advisor, /onSubmit=\{\(\) => submitText\(draftRef\.current\)\}/);
  assert.doesNotMatch(preload, /showSystemKeyboard|keyboard:show/);
  assert.doesNotMatch(electronMain, /showSystemKeyboard|keyboard:show|TabTip\.exe|osk\.exe/);

  const composerRule = styles.match(/\.advisor-composer \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(composerRule, /border: 0;/);
  assert.doesNotMatch(composerRule, /border-left|border-right|0 0 0/);
  assert.match(styles, /\.advisor-composer__actions \{[^}]*width: 10\.5cqw/);
  assert.match(styles, /\.advisor-composer__keyboard\.is-active/);
  assert.match(styles, /\.advisor-soft-keyboard \{/);
  assert.match(styles, /touch-action: manipulation/);
  assert.match(styles, /\.advisor-shell \{[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(styles, /\.advisor-answer-card \{[^}]*border-left/);
  assert.doesNotMatch(styles, /\.advisor-auth-notice \{[^}]*border-left/);
});

test("web speech only promotes a final transcript before direct send", async () => {
  const advisor = await readFile(advisorPath, "utf8");

  assert.match(advisor, /let latestFinalText = ""/);
  assert.match(advisor, /if \(!latestFinalText\)[\s\S]*没有获得完整识别结果[\s\S]*recoverable: true/);
  assert.match(advisor, /if \(finalText\.trim\(\)\) latestFinalText = finalText\.trim\(\)/);
  assert.match(advisor, /finalizeRecognition\(latestFinalText, \{[\s\S]*provider: "web-speech",[\s\S]*trustedFinal: false/);
});

test("only the final local offline recognition result carries trusted provenance", async () => {
  const [advisor, speechService] = await Promise.all([
    readFile(advisorPath, "utf8"),
    readFile(speechServicePath, "utf8"),
  ]);

  assert.match(speechService, /const finalOfflineAsrProvider = "sherpa-onnx-sensevoice-local"/);
  assert.match(speechService, /result\.text[\s\S]*provider: finalOfflineAsrProvider, trustedFinal: true/);
  const previewFunction = speechService.match(/async function recognizePreview[\s\S]*?\n  \}/u)?.[0] || "";
  assert.doesNotMatch(previewFunction, /provider: finalOfflineAsrProvider|trustedFinal/);
  assert.match(advisor, /finalizeRecognition\(result\?\.text, \{[\s\S]*provider: result\?\.provider,[\s\S]*trustedFinal: result\?\.trustedFinal/);
});

test("station answers use cancellable streaming TTS and abortable local requests", async () => {
  const [hook, vite] = await Promise.all([
    readFile(speechHookPath, "utf8"),
    readFile(vitePath, "utf8"),
  ]);

  assert.match(hook, /createSpeechChunkQueue/);
  assert.match(hook, /synthesizeSpeechStream\(segment/);
  assert.match(hook, /window\.kioskBridge\?\.synthesizeSpeechStream[\s\S]*\? \[text\][\s\S]*splitSpeechSegments/);
  assert.match(hook, /cancelSpeechTurn\?\.\(activeTurn\)/);
  assert.match(hook, /fetchAbortControllersRef[\s\S]*controller\.abort\(\)/);
  assert.match(hook, /context\.state && context\.state !== "running"/);
  assert.match(hook, /Math\.max\(2500, buffer\.duration \* 1000 \+ 1800\)/);
  assert.match(hook, /retainSpeaking:[\s\S]*prepared\.queue\.pending\(\) > 0/);
  assert.match(vite, /speechService\.synthesizeStream/);
  assert.match(vite, /response\.once\("close", cancelTurn\)/);
  assert.match(vite, /combineSpeechChunks/);
});

test("avatar QA speech isolates microphone capture from transition profiling", async () => {
  const advisor = await readFile(advisorPath, "utf8");
  const qaApi = advisor.match(/const qaApi = \{[\s\S]*?\n    \};/)?.[0] || "";

  assert.match(qaApi, /speakReference:[\s\S]*setAutoVoiceEnabled\(false\)[\s\S]*stopVoice\(\{ discard: true \}\)[\s\S]*return speak/);
  assert.match(qaApi, /stopSpeech:[\s\S]*setAutoVoiceEnabled\(false\)[\s\S]*stopSpeaking\(\)[\s\S]*stopVoice\(\{ discard: true \}\)/);
});

test("editing and navigation synchronously invalidate active recognition work", async () => {
  const advisor = await readFile(advisorPath, "utf8");

  assert.match(advisor, /const draftRevisionRef = useRef\(0\)/);
  assert.match(advisor, /const listeningOperationRef = useRef\(false\)/);
  assert.match(advisor, /const submittingRef = useRef\(false\)/);
  assert.match(advisor, /voiceStateRef\.current = "submitting";[\s\S]*submitText\(recognizedText\)/);
  assert.match(advisor, /onFocus:[\s\S]*stopVoice\(\{ discard: true \}\)/);
  assert.match(advisor, /const openExit = \(\) => \{[\s\S]*stopVoice\(\{ discard: true \}\)/);
});
