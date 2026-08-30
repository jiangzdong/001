import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop build uses file-compatible relative asset paths", async () => {
  const [viteConfig, appSource] = await Promise.all([
    readFile(new URL("../vite.config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(viteConfig, /base:\s*["']\.\/["']/);
  assert.doesNotMatch(appSource, /(?:src|href)=["']\/assets\//);
});

test("2D digital human uses a real Ditto intro and a complete identity-locked offline viseme library", async () => {
  const visemeFiles = ["rest-v3", "a-v3", "e-v3", "o-v3", "u-v3", "f-v3", "l-v3", "s-v3", "sh-v3"];
  const expressionFiles = ["smile-v2", "concern-v2", "encourage-v2", "listening-v2"];
  const [appSource, styles, portrait, blinkHalf, blinkClosed, dittoVideo, ...visualFrames] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/xiaoa-ditto-master-v1.0.2.png", import.meta.url)),
    readFile(new URL("../public/assets/xiaoa-blink-half-v4.png", import.meta.url)),
    readFile(new URL("../public/assets/xiaoa-blink-closed-v2.png", import.meta.url)),
    readFile(new URL("../public/assets/xiaoa-ditto-welcome-v1.mp4", import.meta.url)),
    ...visemeFiles.map((name) => readFile(new URL(`../public/assets/xiaoa-viseme-${name}.png`, import.meta.url))),
    ...expressionFiles.map((name) => readFile(new URL(`../public/assets/xiaoa-expression-${name}.png`, import.meta.url))),
  ]);

  assert.match(appSource, /createAnalyser\(\)/);
  assert.match(appSource, /const visemeProfiles =/);
  assert.match(appSource, /dataset\.viseme/);
  assert.equal((appSource.match(/xiaoa-ditto-master-v1\.0\.2\.png/g) ?? []).length, 1);
  assert.doesNotMatch(appSource, /avatarClipByText|heygen-welcome-v1/);
  assert.match(appSource, /xiaoa-ditto-welcome-v1\.mp4/);
  assert.match(appSource, /onEnded=\{finishVideo\}/);
  assert.match(appSource, /onError=\{failVideo\}/);
  assert.match(appSource, /onLoadedData=\{confirmVideoFrame\}/);
  assert.match(appSource, /fallbackFromDittoIntro/);
  assert.match(styles, /\.digital-human\.has-ready-video \.digital-human__video\{visibility:visible\}/);
  assert.match(styles, /\.screen-talk \.digital-human__video,[\s\S]*object-position:50% 0/);
  assert.equal((appSource.match(/<img[^>]+digital-human__mouth-frame/g) ?? []).length, 9);
  for (const name of visemeFiles) assert.match(appSource, new RegExp(`xiaoa-viseme-${name}\\.png`));
  assert.doesNotMatch(appSource, /xiaoa-mouth-atlas-v1\.png|digital-human__mouth-sprite/);
  for (const shape of ["REST", "A", "E", "O", "U", "F", "L", "S", "SH"]) assert.match(styles, new RegExp(`data-viseme="${shape}"`));
  assert.match(styles, /ellipse 9\.6cqw 4\.1cqw at 50cqw 50\.85cqw/);
  assert.doesNotMatch(styles, /digital-human__mouth-cavity/);
  assert.match(appSource, /xiaoa-blink-half-v4\.png/);
  assert.match(appSource, /xiaoa-blink-closed-v2\.png/);
  assert.match(appSource, /digital-human__blink-frame--screen-right/);
  assert.match(styles, /digital-human__blink-frame--screen-right \{[\s\S]*ellipse 5\.65cqw 1\.9cqw at 56cqw/);
  assert.equal((appSource.match(/<img[^>]+digital-human__expression-frame/g) ?? []).length, 4);
  for (const name of expressionFiles) assert.match(appSource, new RegExp(`xiaoa-expression-${name}\\.png`));
  assert.match(styles, /data-semantic-expression="encourage"[\s\S]*digital-human__expression-frame--encourage/);
  assert.doesNotMatch(styles, /\.digital-human\[data-expression="blink"\] \.digital-human__expression-frame/);
  assert.match(appSource, /dataset\.semanticExpression = displayedMood/);
  assert.match(styles, /data-blink-phase="half"[\s\S]*digital-human__blink-frame--half/);
  assert.match(styles, /data-blink-phase="closed"[\s\S]*digital-human__blink-frame--closed/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.ok(portrait.length > 1_000_000);
  const visemes = visualFrames.slice(0, visemeFiles.length);
  const expressions = visualFrames.slice(visemeFiles.length);
  for (const viseme of visemes) assert.ok(viseme.length > 1_000_000);
  assert.ok(blinkHalf.length > 1_000_000);
  assert.ok(blinkClosed.length > 1_000_000);
  for (const expression of expressions) assert.ok(expression.length > 1_000_000);
  assert.match(appSource, /videoActive=\{\(screen === "welcome" \|\| screen === "talk"\)/);
  assert.match(appSource, /frameActive=\{screen === "talk" && dittoFrameActive\}/);
  assert.ok(dittoVideo.length > 500_000);
});

test("dynamic replies request a cloud Ditto render and fall back to local speech safely", async () => {
  const [appSource, preloadSource, mainSource, viteConfig] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /streamAvatar/);
  assert.match(appSource, /dittoFrameSinkRef/);
  assert.match(appSource, /startAuthenticFrameStream/);
  assert.match(appSource, /authentic: true, streaming: true/);
  assert.match(appSource, /createSpeechTurnId/);
  assert.match(preloadSource, /cancelAvatarTurn/);
  assert.match(preloadSource, /cancelSpeechTurn/);
  assert.match(mainSource, /ipcMain\.handle\("avatar:cancel"/);
  assert.match(mainSource, /ipcMain\.handle\("speech:cancel"/);
  assert.match(appSource, /正在连接实时嘴型/);
  assert.match(appSource, /dittoSpeechSrc/);
  assert.match(preloadSource, /avatarStatus/);
  assert.match(preloadSource, /avatar:render-stream/);
  assert.match(mainSource, /ipcMain\.handle\("avatar:render-stream"/);
  assert.match(viteConfig, /\/api\/avatar\/status/);
  assert.match(viteConfig, /\/api\/avatar\/render/);
});

test("desktop speech exposes only the fixed default female voice", async () => {
  const [appSource, serviceSource, workerSource, packageSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/speech-service.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/speech-worker.cjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /defaultVoiceId = "zh-ll-2"/);
  assert.doesNotMatch(appSource, /voiceOptions|选择并试听音色|voice-settings-dialog/);
  assert.doesNotMatch(serviceSource, /melo|zh-ll-[0134]/);
  assert.match(serviceSource, /voiceId/);
  assert.match(workerSource, /engine\.numSpeakers/);
  assert.match(workerSource, /type === "warmup"/);
  assert.match(serviceSource, /function warmup\(voiceId = defaultVoiceId\)/);
  assert.match(packageSource, /models\/sherpa-onnx-vits-zh-ll/);
  assert.doesNotMatch(packageSource, /models\/vits-melo-tts-zh_en/);
});

test("speech preparation, visemes and retries stay off the renderer critical path", async () => {
  const [appSource, serviceSource, workerSource, preloadSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/speech-service.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/speech-worker.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /speechPreparing/);
  assert.match(appSource, /正在准备声音/);
  assert.match(appSource, /口型试听：啊啊，诶诶，哦哦，呜呜/);
  assert.match(appSource, /createGain\(\)/);
  assert.match(appSource, /selectedVoice = \{ id: defaultVoiceId/);
  assert.doesNotMatch(appSource, /voicePreviewTimerRef|showVoiceSetup/);
  assert.doesNotMatch(serviceSource, /readFileSync\(path\.join\(directory, "lexicon\.txt"\)/);
  assert.match(workerSource, /function createVisemeSequence/);
  assert.match(workerSource, /createTimedVisemes/);
  assert.match(workerSource, /minimumChunkSamples = Math\.round\(engine\.sampleRate \* 0\.62\)/);
  assert.match(workerSource, /flushPendingChunk\(true\)/);
  assert.match(workerSource, /readFileSync\(path\.join\(directory, "lexicon\.txt"\)/);
  assert.match(serviceSource, /SenseVoice character timestamps \+ VITS lexicon/);
  assert.match(preloadSource, /receivedChunks[\s\S]*expectedChunks[\s\S]*resolveDrainIfComplete/);
});

test("admin dialog is keyboard accessible and AI calls degrade safely", async () => {
  const [appSource, mainSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /function useModalFocus/);
  assert.match(appSource, /event\.key === "Escape"/);
  assert.match(appSource, /aria-describedby="setup-help"/);
  assert.doesNotMatch(appSource, /voice-settings-dialog/);
  assert.match(appSource, /finally \{ setAiBusy\(false\); \}/);
  assert.match(mainSource, /new AbortController\(\)/);
  assert.match(mainSource, /controller\.abort\(\), 20000/);
  assert.match(mainSource, /setPermissionRequestHandler/);
  assert.match(mainSource, /backgroundThrottling:\s*false/);
  assert.match(mainSource, /screen\.getAllDisplays\(\)/);
  assert.match(mainSource, /display\.bounds\.height > display\.bounds\.width/);
  assert.match(mainSource, /appendSwitch\("force-device-scale-factor", "1"\)/);
  assert.match(mainSource, /width: 1200, height: 1920, contentRotation: 0/);
  assert.match(mainSource, /安全信号/);
  assert.doesNotMatch(mainSource, /联系工作人员/);
});

test("secondary screens remain visually stable during continuous voice turns", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.equal((appSource.match(/xiaoa-ditto-master-v1\.0\.2\.png/g) ?? []).length, 1);
  assert.match(appSource, /startListening\(\{ automatic: true \}\)/);
  assert.match(appSource, /listeningOperationRef/);
  assert.match(appSource, /autoListenAllowedRef/);
  assert.match(styles, /\.digital-human\{animation:none;transition:none\}/);
  assert.match(styles, /\.digital-human\.is-speaking\{animation:none\}/);
  assert.match(styles, /\.voice-aura\{display:none\}/);
  assert.match(styles, /\.panel-enter\{animation:none\}/);
  assert.match(styles, /\.kiosk-shell \{[^}]*box-shadow:none/);
  assert.match(styles, /\.kiosk-shell\.runtime-electron \{[^}]*left:50%; top:50%;[^}]*width:min\(100vw,calc\(100dvh \* \.625\)\); height:min\(100dvh,calc\(100vw \* 1\.6\)\);[^}]*translate:-50% -50%/);
  assert.match(styles, /\.digital-human \{[^}]*pointer-events:none/);
  assert.match(styles, /\.portrait-stage::before \{[^}]*pointer-events:none/);
  assert.doesNotMatch(styles, /rotate:(?:-)?90deg/);
  assert.match(styles, /body \{[^}]*background:#0b2732/);
});

test("voice controls use click-to-toggle recognition", async () => {
  const [appSource, recorderSource, viteConfig] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/speechRecorder.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.mjs", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(appSource, /按住说话/);
  assert.match(appSource, /直接和小安说话/);
  assert.match(appSource, /const toggleListening/);
  assert.match(appSource, /startListening\(\);/);
  assert.match(recorderSource, /signal\?\.addEventListener\("abort", finish/);
  assert.match(recorderSource, /context\.state === "suspended"/);
  assert.match(recorderSource, /onSpeechStart/);
  assert.match(appSource, /正在识别，请稍等/);
  assert.match(appSource, /speech-transcript/);
  assert.match(appSource, /\\p\{L\}\\p\{N\}/);
  assert.doesNotMatch(appSource, /无需按住/);
  assert.match(appSource, /fetch\("\/api\/speech\/recognize"/);
  assert.match(viteConfig, /xiaoan-local-speech-api/);
});

test("talk history scroll and the hidden forehead trigger remain operable", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /role="log"/);
  assert.match(appSource, /tabIndex=\{0\}/);
  assert.match(appSource, /stream\.scrollTop = stream\.scrollHeight/);
  assert.match(appSource, /forehead-admin-trigger[\s\S]*onPointerDown=/);
  assert.match(appSource, /recentTaps\.length < 5/);
  assert.match(styles, /\.screen-talk \.chat-stream \{[^}]*overflow-y: scroll/);
  assert.match(styles, /\.screen-talk \.chat-stream \{[^}]*touch-action: pan-y pinch-zoom/);
  assert.match(styles, /\.screen-talk \.forehead-admin-trigger,[\s\S]*top: 16%/);
});

test("senior dialogue layout uses readable answer cards and only voice answers require confirmation", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /className="message__label"/);
  assert.match(appSource, /onClick=\{\(\) => submitAnswer\(option\)\}/);
  assert.match(appSource, /localInterpretAssessment/);
  assert.match(appSource, /interpretAssessment/);
  assert.match(appSource, /请确认刚才的语音内容/);
  assert.match(styles, /\.screen-talk \.message\{[^}]*font-size:3\.25cqw/);
  assert.match(styles, /\.screen-talk \.prompt-row button\{[^}]*min-height:8\.8cqw[^}]*font-size:2\.75cqw/);
});

test("portrait talk mode keeps one shared stage boundary and independent top controls", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /function TopControlButton/);
  assert.doesNotMatch(appSource, /className={`dock-button/);
  assert.match(appSource, /icon=\{muted \? SpeakerSimpleSlash : SpeakerSimpleHigh\}/);
  assert.match(appSource, /icon=\{Speedometer\} label="慢速"/);
  assert.doesNotMatch(appSource, /icon=\{Waveform\}[^>]*label="慢速"/);
  assert.match(appSource, /className="topbar-home"/);
  assert.doesNotMatch(appSource, /talk-stage-controls|home-return|talk-stage-module/);
  assert.match(styles, /V1\.0\.5[\s\S]*\.screen-talk \.portrait-stage,[\s\S]*\.screen-analyzing \.portrait-stage \{\s*height: 46%;/);
  assert.match(styles, /\.screen-talk \.content-layer,[\s\S]*\.screen-analyzing \.content-layer \{\s*top: 46%;\s*bottom: 0;/);
  assert.match(styles, /\.top-control-button \{[\s\S]*?min-height: 7\.4cqw;[\s\S]*?grid-template-columns: 3\.7cqw/);
  assert.match(styles, /\.topbar-home \{[\s\S]*?min-height: 7\.4cqw/);
});

test("V1.4.10 keeps one avatar camera baseline, fits the portrait canvas to the display height, exposes the version, and packages all skills", async () => {
  const [appSource, styles, packageSource, indexSource, viteSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(packageSource, /"version": "1\.4\.10"/);
  assert.match(packageSource, /"productName": "小安数字健康管理师 V1\.4\.10"/);
  assert.match(packageSource, /skills\/health-management-v1/);
  assert.match(packageSource, /skills\/health-management-multidomain-v2/);
  assert.match(packageSource, /skills\/health-management-adaptive-dialogue-v3/);
  assert.match(indexSource, /<title>小安数字健康管理师 V1\.4\.10<\/title>/);
  assert.match(viteSource, /__APP_VERSION__/);
  assert.match(packageSource, /"artifactName": "XiaoAn-Health-Kiosk-\$\{version\}-\$\{arch\}\.\$\{ext\}"/);
  assert.match(appSource, /className="app-version"/);
  assert.match(appSource, /useEffect\(\(\) => \{\s*setShowVolumeControl\(false\);\s*\}, \[screen\]\);/);
  assert.match(styles, /camera lock:[\s\S]*\.screen-welcome \.digital-human__image[\s\S]*object-position: 50% 0;/);
  assert.match(styles, /V1\.0\.5[\s\S]*\.screen-talk \.portrait-stage,[\s\S]*\.screen-analyzing \.portrait-stage \{\s*height: 46%;/);
  assert.match(styles, /\.screen-talk \.digital-human,[\s\S]*\.screen-analyzing \.digital-human \{\s*transform: none;/);
  assert.match(styles, /\.screen-talk \.content-layer,[\s\S]*\.screen-analyzing \.content-layer \{\s*top: 46%;\s*bottom: 0;/);
  assert.doesNotMatch(appSource, /talk-stage-controls|home-return|talk-stage-module/);
});
