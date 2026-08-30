import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { advanceVisemeBlend, blendVisemeProfiles, createBlinkProfile, createSpeechProsodyTimeline, inferSpeechMood, nextBlinkDelay, sampleBlinkEnvelope, sampleExpressionStrength, sampleJawPose, sampleMouthAperture, sampleSpeechProsody, sampleUpperBodyPose, sampleVisemeTimeline, shouldUseAuthenticAvatar, smoothingAlpha, stabilizeVisemeLabel, updateVisemeGate } from "../src/avatarMotion.js";

test("normal symptom replies use the authentic avatar while safety messages stay immediate", () => {
  assert.equal(shouldUseAuthenticAvatar({ handled: true, type: "question", safetySignal: null }), true);
  assert.equal(shouldUseAuthenticAvatar({ handled: true, type: "result", safetySignal: null }), true);
  assert.equal(shouldUseAuthenticAvatar({ handled: true, type: "safety", safetySignal: { id: "danger" } }), false);
  assert.equal(shouldUseAuthenticAvatar({ handled: false }), false);
});

test("same-content real-speaker acceptance uses three high-confidence licensed clips", async () => {
  const manifest = JSON.parse(await readFile(new URL("../qa/reference/real-speech-suite.json", import.meta.url), "utf8"));
  assert.equal(manifest.license, "Creative Commons Attribution 3.0 Unported");
  assert.equal(manifest.cases.length, 3);
  assert.ok(manifest.cases.every((item) => item.text.length >= 20));
  assert.ok(manifest.cases.every((item) => item.detectionRate >= 0.95));
});

test("speech mood and phrase prosody remain restrained and semantic", () => {
  assert.equal(inferSpeechMood("建议您先记录血压，我们一起慢慢改善。"), "encourage");
  assert.equal(inferSpeechMood("如果疼痛加重，请及时就医。"), "concern");
  assert.equal(inferSpeechMood("您好，很高兴见到您。"), "smile");
  const timeline = createSpeechProsodyTimeline("先休息，再记录。", 2000);
  assert.equal(timeline.events.length, 2);
  const sample = sampleSpeechProsody(timeline, timeline.events[0].timeMs);
  assert.ok(sample.nod > 0.4 && sample.nod <= 1);
  assert.ok(Math.abs(sample.tilt) < 0.5);
  const blink = createBlinkProfile(0.5, { speaking: true });
  assert.ok(blink.closeMs >= 112 && blink.openMs > blink.closeMs);
});

test("visemes follow the audio clock and interpolate instead of hard switching", () => {
  const audioContext = { currentTime: 0.75 };
  const sample = sampleVisemeTimeline({
    visemes: ["CLOSED", "A", "E"],
    audioContext,
    startedAtContext: 0,
    startedAtPerformance: 9000,
    durationMs: 1000,
  }, 10000);
  assert.equal(sample.current, "A");
  assert.equal(sample.next, "E");
  assert.ok(sample.mix > 0.49 && sample.mix < 0.51);
  assert.ok(sample.progress > 0.74 && sample.progress < 0.76);
});

test("timestamped visemes use short anticipatory coarticulation while keeping one mouth label", () => {
  const audioContext = { currentTime: 0.34 };
  const sample = sampleVisemeTimeline({
    visemes: [
      { timeMs: 0, shape: "CLOSED" },
      { timeMs: 120, shape: "F" },
      { timeMs: 330, shape: "A" },
      { timeMs: 620, shape: "CLOSED" },
    ],
    audioContext,
    startedAtContext: 0,
    durationMs: 700,
  });
  assert.equal(sample.current, "A");
  assert.equal(sample.next, "CLOSED");
  assert.equal(sample.mix, 0);
  assert.equal(sample.discrete, false);
  assert.equal(blendVisemeProfiles({ CLOSED: { open: 0 }, REST: { open: 0 }, A: { open: 1 } }, sample).label, "A");
  audioContext.currentTime = 0.605;
  const anticipatory = sampleVisemeTimeline({
    visemes: [
      { timeMs: 0, shape: "CLOSED" },
      { timeMs: 120, shape: "F" },
      { timeMs: 330, shape: "A" },
      { timeMs: 620, shape: "CLOSED" },
    ],
    audioContext,
    startedAtContext: 0,
    durationMs: 700,
  });
  assert.ok(anticipatory.mix > 0.5);
  assert.equal(blendVisemeProfiles({ CLOSED: { open: 0 }, REST: { open: 0 }, A: { open: 1 } }, anticipatory).label, "CLOSED");
});

test("time-based mouth smoothing is stable at different frame rates", () => {
  const settle = (frames, delta) => {
    let value = 0;
    for (let index = 0; index < frames; index += 1) value += (1 - value) * smoothingAlpha(delta, 80);
    return value;
  };
  assert.ok(Math.abs(settle(10, 16) - settle(5, 32)) < 1e-9);
  assert.ok(smoothingAlpha(1000, 80) < 0.64, "a delayed frame must not snap the mouth fully open");
});

test("timestamped mouth aperture survives PCM valleys while fallback remains energy reactive", () => {
  const quietAligned = sampleMouthAperture({ profileOpen: 0.8, energy: 0, timelineDriven: true, speaking: true });
  const loudAligned = sampleMouthAperture({ profileOpen: 0.8, energy: 1, timelineDriven: true, speaking: true });
  assert.ok(quietAligned > 0.55, "an aligned vowel must not collapse during a waveform valley");
  assert.ok(loudAligned - quietAligned < 0.2, "PCM energy must remain a restrained accent on aligned visemes");
  const quietFallback = sampleMouthAperture({ profileOpen: 0.8, energy: 0, timelineDriven: false, speaking: true });
  const loudFallback = sampleMouthAperture({ profileOpen: 0.8, energy: 1, timelineDriven: false, speaking: true });
  assert.ok(loudFallback - quietFallback > 0.65, "non-timestamped fallback should still follow speech energy");
  assert.equal(sampleMouthAperture({ profileOpen: 1, energy: 1, timelineDriven: true, speaking: false }), 0);
});

test("speech energy gate holds through short inter-syllable valleys", () => {
  let gate = updateVisemeGate(null, 0.12, 100, true);
  assert.equal(gate.open, true);
  gate = updateVisemeGate(gate, 0.01, 180, true);
  assert.equal(gate.open, true);
  gate = updateVisemeGate(gate, 0.01, 231, true);
  assert.equal(gate.open, false);
  assert.equal(updateVisemeGate(gate, 1, 240, false).open, false);
});

test("viseme label stabilizer rejects one-frame chatter and limits switch rate", () => {
  let state = stabilizeVisemeLabel(null, "A", 0, true);
  state = stabilizeVisemeLabel(state, "A", 16, true);
  assert.equal(state.displayed, "CLOSED");
  state = stabilizeVisemeLabel(state, "A", 88, true);
  assert.equal(state.displayed, "A");
  state = stabilizeVisemeLabel(state, "E", 96, true);
  state = stabilizeVisemeLabel(state, "A", 112, true);
  assert.equal(state.displayed, "A");
  state = stabilizeVisemeLabel(state, "E", 144, true);
  state = stabilizeVisemeLabel(state, "E", 228, true);
  assert.equal(state.displayed, "E");
  assert.equal(stabilizeVisemeLabel(state, "E", 140, false).displayed, "CLOSED");
});

test("timestamped visemes preserve aligned events without adding a second visible lag", () => {
  let state = stabilizeVisemeLabel(null, "A", 0, true, { timestamped: true });
  state = stabilizeVisemeLabel(state, "A", 16, true, { timestamped: true });
  assert.equal(state.displayed, "CLOSED");
  state = stabilizeVisemeLabel(state, "A", 88, true, { timestamped: true });
  assert.equal(state.displayed, "A");
  state = stabilizeVisemeLabel(state, "O", 172, true, { timestamped: true });
  state = stabilizeVisemeLabel(state, "O", 188, true, { timestamped: true });
  assert.equal(state.displayed, "O");
});

test("semantic expression eases in and stays below a rigid full-frame hold", () => {
  assert.equal(sampleExpressionStrength({ mood: "neutral", speaking: true, elapsedMs: 1000, energy: 1 }), 0);
  const onset = sampleExpressionStrength({ mood: "concern", speaking: true, elapsedMs: 80, energy: 0.6 });
  const settled = sampleExpressionStrength({ mood: "concern", speaking: true, elapsedMs: 900, energy: 0.6 });
  assert.ok(onset > 0 && onset < settled);
  assert.ok(settled > 0.5 && settled < 0.8);
  assert.ok(sampleExpressionStrength({ mood: "listening", speaking: false }) < 0.55);
  const quiet = sampleExpressionStrength({ mood: "concern", speaking: true, elapsedMs: 1600, energy: 0.05 });
  const loud = sampleExpressionStrength({ mood: "concern", speaking: true, elapsedMs: 1600, energy: 0.95 });
  assert.ok(loud - quiet < 0.025, "eyebrows must not pump with syllable energy");
});

test("upper body pose keeps the neck quiet while chest breathing remains visible", () => {
  const samples = [];
  for (let elapsedMs = 0; elapsedMs <= 12_000; elapsedMs += 16) {
    samples.push(sampleUpperBodyPose({ elapsedMs, speaking: true, motion: 0.94, energy: 0.45 }));
  }
  const range = (key) => Math.max(...samples.map((sample) => sample[key])) - Math.min(...samples.map((sample) => sample[key]));
  const maxStep = (key) => Math.max(...samples.slice(1).map((sample, index) => Math.abs(sample[key] - samples[index][key])));
  assert.equal(range("x"), 0);
  assert.equal(range("tilt"), 0);
  assert.equal(range("y"), 0, "both neck edges must remain rigid");
  assert.equal(range("scale"), 0, "global portrait scale must not carry breathing");
  assert.ok(range("chestRise") > 0.1 && range("chestRise") < 0.13);
  assert.ok(range("chestScaleX") > 0.005 && range("chestScaleX") < 0.0061);
  assert.ok(range("chestScaleY") > 0.003 && range("chestScaleY") < 0.0036);
  assert.equal(maxStep("x"), 0);
  assert.equal(maxStep("tilt"), 0);
});

test("jaw and lower-face deformation follows aperture without independent jitter", () => {
  const closed = sampleJawPose({ mouthOpen: 0, energy: 1, speaking: false });
  const rest = sampleJawPose({ mouthOpen: 0.18, energy: 0.3, speaking: true });
  const open = sampleJawPose({ mouthOpen: 0.94, energy: 0.7, speaking: true });
  assert.deepEqual(closed, { open: 0, drop: 0, scaleY: 1, scaleX: 1, cheek: 0 });
  assert.ok(open.open > rest.open);
  assert.equal(open.drop, 0);
  assert.ok(open.scaleY > rest.scaleY && open.scaleY > 1.08 && open.scaleY < 1.11);
  assert.equal(open.scaleX, 1);
});

test("viseme frames crossfade without exposing two dominant mouths", () => {
  let blend = advanceVisemeBlend(null, "CLOSED", 0);
  blend = advanceVisemeBlend(blend, "A", 10);
  blend = advanceVisemeBlend(blend, "A", 58);
  assert.equal(blend.dominant, "A");
  assert.ok(blend.weights.A > 0.5 && blend.weights.A <= 1);
  blend = advanceVisemeBlend(blend, "E", 120);
  blend = advanceVisemeBlend(blend, "E", 174);
  const dominantWeights = Object.values(blend.weights).filter((weight) => weight > 0.5);
  assert.equal(dominantWeights.length, 1);
  assert.ok(Math.abs(Object.values(blend.weights).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9);
  blend = advanceVisemeBlend(blend, "CLOSED", 240);
  blend = advanceVisemeBlend(blend, "CLOSED", 362);
  assert.equal(blend.dominant, "CLOSED");
  assert.deepEqual(blend.weights, {});
});

test("blink closes quickly, holds briefly, and opens more softly", () => {
  assert.equal(sampleBlinkEnvelope(0).amount, 0);
  assert.ok(sampleBlinkEnvelope(130).amount > 0.98);
  assert.equal(sampleBlinkEnvelope(175).amount, 1);
  assert.ok(sampleBlinkEnvelope(295).amount > 0.1 && sampleBlinkEnvelope(295).amount < 0.7);
  assert.deepEqual(sampleBlinkEnvelope(405), { amount: 0, complete: true, totalMs: 405 });
});

test("blink cadence varies by semantic mood and supports a restrained double blink", () => {
  assert.ok(nextBlinkDelay(0, { mood: "listening" }) < nextBlinkDelay(0, { mood: "neutral" }));
  assert.ok(nextBlinkDelay(0.5, { speaking: true }) > nextBlinkDelay(0.5));
  assert.ok(nextBlinkDelay(0, { doubleBlink: true }) >= 135);
  assert.ok(nextBlinkDelay(1, { doubleBlink: true }) <= 200);
});

test("renderer keeps one continuous motion loop, protects speech callbacks, and softens video exit", async () => {
  const [appSource, styles, speechService, speechWorker] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../electron/speech-service.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/speech-worker.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /shouldUseAuthenticAvatar\(nextSymptomState\)/);
  assert.match(appSource, /isCurrentTurn[\s\S]*ticket === speechTicketRef\.current[\s\S]*activeSpeechTurnRef\.current === turnId/);
  assert.match(appSource, /splitSpeechSegments\(text, \{ minChars: 8, maxChars: 22 \}\)[\s\S]*prepared = segments\.map\(prepareNativeSegment\)/);
  assert.match(appSource, /startedAtContext:[\s\S]*source\.start\(startAtContext\)/);
  assert.match(appSource, /sampleBlinkEnvelope\(timestamp - blinkStartedAt, blinkProfile\)/);
  assert.match(appSource, /updateVisemeGate\(gateState, smoothedLevel, timestamp, offlineSpeaking\)[\s\S]*stabilizeVisemeLabel\(visemeState, desiredViseme, timestamp, offlineSpeaking, \{ timestamped: timelineDriven \}\)/);
  assert.match(appSource, /timelineDriven = Boolean[\s\S]*timelineDriven \|\| gateState\.open[\s\S]*profile\.label/);
  assert.match(appSource, /pendingMood = desiredMood[\s\S]*blinkPhase === "closed" && pendingMood[\s\S]*displayedMood = pendingMood/);
  assert.match(appSource, /if \(!videoActiveRef\.current\)[\s\S]*nextBlinkDelay\(Math\.random\(\), \{ mood: moodRef\.current, speaking: speakingRef\.current \}\)/);
  assert.match(appSource, /createBiquadFilter\(\)[\s\S]*createDynamicsCompressor\(\)/);
  assert.match(appSource, /preparedSpeech = segments\.map\(prepareNativeSegment\)[\s\S]*streamAvatar\(text[\s\S]*for \(const preparedSegment of preparedSpeech\)[\s\S]*playPreparedSegment\(preparedSegment[\s\S]*cancelAvatarTurn/);
  assert.match(appSource, /createSpeechChunkQueue\(\)[\s\S]*synthesizeSpeechStream\(segment/);
  assert.match(appSource, /playNativeSegment\(\{ ok: true, \.\.\.chunk \}/);
  assert.doesNotMatch(appSource, /alignSpeech\(segmentText/);
  assert.match(appSource, /dedicated alignment worker has already tied exact text timestamps[\s\S]*without running ASR on the animation thread/);
  assert.match(speechService, /const ttsWorkerCount = 2[\s\S]*parallelPrefetch: ttsWorkerCount[\s\S]*synthesisTails\[slot\]/);
  assert.match(speechService, /alignAndDispatch[\s\S]*await alignmentTail/);
  assert.match(speechWorker, /ttsThreads\) \|\| 3/);
  assert.match(speechWorker, /splitTtsProgressText\(text, 2\)/);
  assert.match(speechWorker, /text: chunkText/);
  assert.match(speechWorker, /minimumChunkSamples = Math\.round\(engine\.sampleRate \* 0\.62\)[\s\S]*flushPendingChunk\(false\)[\s\S]*flushPendingChunk\(true\)/);
  assert.match(appSource, /dataset\.semanticExpression = displayedMood/);
  assert.match(appSource, /sampleExpressionStrength[\s\S]*--expression-strength/);
  assert.match(appSource, /sampleJawPose[\s\S]*--jaw-drop[\s\S]*--jaw-scale-y/);
  assert.match(appSource, /digital-human__local-rig/);
  assert.doesNotMatch(appSource, /digital-human__mouth-frame/);
  assert.doesNotMatch(styles, /digital-human__mouth-frame/);
  assert.doesNotMatch(appSource, /digital-human__jaw-frame/);
  assert.match(appSource, /pendingFrame = event[\s\S]*pumpLatestFrame\(\)/);
  assert.match(appSource, /frameTimestampMs \+ 180 < playbackElapsedMs/);
  assert.doesNotMatch(appSource, /const bufferedFrames = frames\.splice\(0\)/);
  assert.match(appSource, /--blink-progress/);
  assert.match(appSource, /xiaoa-blink-half-v5\.png/);
  assert.match(appSource, /blinkStartedAt >= 0 && !blinkBodyPose[\s\S]*renderedBodyPose = blinkBodyPose/);
  assert.match(appSource, /timestamp - pendingMoodSince >= 180/);
  assert.match(appSource, /moodPoseAlpha = smoothingAlpha\(deltaMs, 460\)/);
  assert.match(appSource, /sampleUpperBodyPose[\s\S]*--body-x[\s\S]*--body-tilt[\s\S]*--chest-rise[\s\S]*--chest-scale-x/);
  assert.doesNotMatch(appSource, /mouthFrameNodes|node\.style\.opacity/);
  assert.match(appSource, /Photographic mouth sprites must never be alpha-blended[\s\S]*dominant = timelineMix < 0\.5 \? sample\.current : sample\.next[\s\S]*\{ \[dominant\]: 1 \}/);
  assert.doesNotMatch(appSource, /outgoingWeight = 1 - timelineMix[\s\S]*incomingWeight = timelineMix/);
  assert.match(appSource, /xiaoa-blink-closed-v3\.png/);
  assert.match(styles, /identity-locked blink frame[\s\S]*data-blink-phase="half"[\s\S]*data-blink-phase="closed"/);
  assert.doesNotMatch(styles, /\.digital-human__blink-frame\s*\{\s*display:\s*none;/);
  assert.match(styles, /data-expression="blink"\] \.digital-human__expression-frame \{ transition:none; \}/);
  assert.match(styles, /\.screen-welcome \.digital-human__expression-sprite,[\s\S]*\.screen-analyzing \.digital-human__expression-sprite \{\s*top: 24\.8cqw;/);
  assert.match(appSource, /setVideoSettling\(true\)[\s\S]*}, 320\)/);
  assert.match(appSource, /\}, \[analyserRef, avatarMode, localRigReady, visemeTimelineRef\]\)/);
  assert.match(styles, /V1\.0\.6:[\s\S]*transform: none;[\s\S]*is-video-settling[\s\S]*opacity 320ms/);
  assert.doesNotMatch(styles, /45\.8cqw/);
});

test("avatar cache and encrypted provider configuration use a version-stable data path", async () => {
  const mainSource = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(mainSource, /stableUserDataPath = path\.join\(app\.getPath\("appData"\), "XiaoAnHealthKiosk"\)/);
  assert.match(mainSource, /app\.setPath\("userData", stableUserDataPath\)/);
  assert.match(mainSource, /migrateLegacyUserData\(\)/);
  assert.match(mainSource, /path\.join\(appDataPath, "小安数字健康管理师"\)/);
  assert.match(mainSource, /path\.join\(appDataPath, "health-kiosk-demo"\)/);
  assert.match(mainSource, /avatar-video-cache/);
  assert.match(mainSource, /deepseek\.credential/);
});
