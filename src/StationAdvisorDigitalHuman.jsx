import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  advanceVisemeBlend,
  blendVisemeProfiles,
  createBlinkProfile,
  nextBlinkDelay,
  sampleBlinkEnvelope,
  sampleExpressionStrength,
  sampleJawPose,
  sampleMouthAperture,
  sampleSpeechProsody,
  sampleVisemeTimeline,
  smoothingAlpha,
  stabilizeVisemeLabel,
  updateVisemeGate,
} from "./avatarMotion.js";
import {
  buildLocalFaceActions,
  createStationHomeFaceMaster,
  loadLocalFaceRigImage,
  loadLocalFaceRigImages,
  prepareLocalFaceRigTextures,
  renderLocalFaceRig,
  stationHomeFullBodySource,
} from "./localFaceRig.js";
import "./station-advisor-digital-human.css";

const visemeProfiles = Object.freeze({
  CLOSED: { open: 0.01, width: 0.94, radius: "48%" },
  REST: { open: 0.18, width: 0.98, radius: "44%" },
  A: { open: 0.94, width: 1.01, radius: "42%" },
  E: { open: 0.38, width: 1.2, radius: "36%" },
  O: { open: 0.6, width: 0.92, radius: "47%" },
  U: { open: 0.27, width: 0.94, radius: "46%" },
  MBP: { open: 0.03, width: 0.91, radius: "46%" },
  F: { open: 0.22, width: 1.04, radius: "38%" },
  L: { open: 0.5, width: 1.02, radius: "42%" },
  NDT: { open: 0.14, width: 1, radius: "40%" },
  S: { open: 0.24, width: 1.12, radius: "34%" },
  SH: { open: 0.32, width: 0.96, radius: "44%" },
});

const avatarAssets = Object.freeze({
  master: "./assets/xiaoa-ditto-master-v1.0.3.png",
  smile: "./assets/xiaoa-expression-smile-v4.png",
  concern: "./assets/xiaoa-expression-concern-v4.png",
  encourage: "./assets/xiaoa-expression-encourage-v4.png",
  listening: "./assets/xiaoa-expression-listening-v4.png",
  blinkHalf: "./assets/xiaoa-blink-half-v6.png",
  blinkClosed: "./assets/xiaoa-blink-closed-v4.png",
});

const datasetKeys = [
  "viseme",
  "visemeTarget",
  "visemeCurrent",
  "visemeNext",
  "visemeBlend",
  "visemeCharacter",
  "visemeEvent",
  "visemeCharacterIndex",
  "visemeRole",
  "visemeAlignment",
  "jawOpen",
  "expression",
  "semanticExpression",
  "blinkPhase",
  "avatarState",
  "motionPhase",
  "motionSource",
  "blinkWaitMs",
  "localRig",
];

function approachByRate(current, target, deltaMs, unitsPerMs) {
  const difference = target - current;
  const maximumStep = Math.max(0, deltaMs) * unitsPerMs;
  return current + Math.max(-maximumStep, Math.min(maximumStep, difference));
}

function normalizeMood(value) {
  return ["smile", "concern", "encourage", "listening"].includes(value) ? value : "neutral";
}

function resetAvatarState(avatar, canvas) {
  if (!avatar) return;
  const properties = {
    "--mouth-open": "0",
    "--mouth-shift": "0cqw",
    "--mouth-opacity": "0",
    "--mouth-width": "1",
    "--mouth-radius": "48%",
    "--jaw-open": "0",
    "--jaw-drop": "0cqw",
    "--jaw-scale-y": "1",
    "--jaw-scale-x": "1",
    "--cheek-release": "0",
    "--body-x": "0cqw",
    "--body-y": "0cqw",
    "--body-tilt": "0deg",
    "--body-scale": "1",
    "--breath-phase": "0",
    "--chest-rise": "0cqw",
    "--chest-scale-x": "1",
    "--chest-scale-y": "1",
    "--head-x": "0cqw",
    "--head-y": "0cqw",
    "--head-tilt": "0deg",
    "--head-scale": "1",
    "--blink-progress": "0",
    "--expression-strength": "0",
  };
  for (const [name, value] of Object.entries(properties)) avatar.style.setProperty(name, value);
  for (const key of datasetKeys) delete avatar.dataset[key];
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Local photographic avatar renderer shared by the station-advisor screens.
 *
 * `analyserRef.current` may contain the AnalyserNode attached to the currently
 * playing TTS source. `visemeTimelineRef.current` uses the same contract as the
 * legacy App.jsx player: { visemes, durationMs, audioContext,
 * startedAtContext, startedAtPerformance, prosody, alignment }.
 */
export const StationAdvisorDigitalHuman = forwardRef(function StationAdvisorDigitalHuman({
  speaking = false,
  listening = false,
  mood = "neutral",
  analyserRef,
  visemeTimelineRef,
  className = "",
  alt = "写实站点咨询顾问小安",
  onRigReady,
  onRigError,
}, forwardedRef) {
  const avatarRef = useRef(null);
  const localRigCanvasRef = useRef(null);
  const localRigImagesRef = useRef(null);
  const fallbackAnalyserRef = useRef(null);
  const fallbackTimelineRef = useRef(null);
  const speakingRef = useRef(Boolean(speaking));
  const moodRef = useRef(normalizeMood(listening && mood === "neutral" ? "listening" : mood));
  const onRigReadyRef = useRef(onRigReady);
  const onRigErrorRef = useRef(onRigError);
  const [localRigReady, setLocalRigReady] = useState(false);
  const [localRigError, setLocalRigError] = useState("");
  const activeAnalyserRef = analyserRef || fallbackAnalyserRef;
  const activeTimelineRef = visemeTimelineRef || fallbackTimelineRef;

  speakingRef.current = Boolean(speaking);
  moodRef.current = normalizeMood(listening && mood === "neutral" ? "listening" : mood);
  onRigReadyRef.current = onRigReady;
  onRigErrorRef.current = onRigError;
  useImperativeHandle(forwardedRef, () => avatarRef.current, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadLocalFaceRigImages(),
      loadLocalFaceRigImage(stationHomeFullBodySource),
    ])
      .then(([sourceImages, fullBodyImage]) => {
        if (cancelled) return;
        const canvas = localRigCanvasRef.current;
        const master = createStationHomeFaceMaster(canvas, fullBodyImage);
        if (!master) throw new Error("站点首页人物母版坐标映射失败");
        // Keep the authored CLOSED portrait as the colour/shape reference for
        // per-viseme delta transfer before replacing CLOSED with the station's
        // exact full-body projection.
        master.__localFaceRigReferenceClosed = sourceImages.get("CLOSED");
        const images = new Map(sourceImages);
        images.set("CLOSED", master);
        localRigImagesRef.current = images;
        if (canvas && master) prepareLocalFaceRigTextures(canvas, images);
        setLocalRigError("");
        setLocalRigReady(true);
        onRigReadyRef.current?.({ provider: "local-mouth-chin-v34", images });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error?.message || "本地口型资源加载失败";
        localRigImagesRef.current = null;
        setLocalRigReady(false);
        setLocalRigError(message);
        onRigErrorRef.current?.(error instanceof Error ? error : new Error(message));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar) return undefined;
    let frame = 0;
    let lastTimestamp = performance.now();
    let smoothedLevel = 0;
    let smoothedOpen = 0;
    let smoothedWidth = 1;
    let smoothedJawOpen = 0;
    let smoothedExpressionStrength = 0;
    let adaptivePeak = 0.06;
    let timeDomain = null;
    let gateState = { open: false, closeAt: lastTimestamp };
    let visemeState = { displayed: "CLOSED", candidate: "CLOSED", candidateSince: lastTimestamp, changedAt: lastTimestamp };
    let visemeBlend = advanceVisemeBlend(null, "CLOSED", lastTimestamp);
    let renderedMouthWeights = {};
    let lastRigPaintAt = 0;
    let lastRigSignature = "";
    let wasSpeaking = false;
    let speechStartedAt = -1;
    let settleUntil = 0;
    let blinkStartedAt = -1;
    let nextBlinkAt = lastTimestamp + nextBlinkDelay(Math.random(), { mood: moodRef.current });
    let pendingDoubleBlink = false;
    let blinkStrength = 1;
    let blinkProfile = createBlinkProfile(Math.random());
    let displayedMood = normalizeMood(moodRef.current);
    let pendingMood = null;
    let pendingMoodSince = 0;
    let smoothedMoodTilt = 0;
    let smoothedMoodY = 0;
    let lastFaceTelemetryAt = 0;
    let lastBlinkTelemetryAt = 0;
    const setDataset = (name, value) => {
      const normalized = String(value);
      if (avatar.dataset[name] !== normalized) avatar.dataset[name] = normalized;
    };
    const setStyleProperty = (name, value) => {
      if (avatar.style.getPropertyValue(name) !== value) avatar.style.setProperty(name, value);
    };
    setDataset("motionSource", "local");

    const animate = (timestamp) => {
      const deltaMs = Math.max(1, Math.min(80, timestamp - lastTimestamp));
      const facialDeltaMs = Math.min(34, deltaMs);
      lastTimestamp = timestamp;
      const isSpeaking = Boolean(speakingRef.current);
      if (isSpeaking && !wasSpeaking) {
        speechStartedAt = timestamp;
        renderedMouthWeights = {};
      }
      if (wasSpeaking && !isSpeaking) settleUntil = timestamp + 520;
      if (!isSpeaking && timestamp >= settleUntil) speechStartedAt = -1;
      wasSpeaking = isSpeaking;
      const settling = !isSpeaking && timestamp < settleUntil;
      const analyser = isSpeaking ? activeAnalyserRef.current : null;
      let targetLevel = 0;
      if (isSpeaking && analyser) {
        if (!timeDomain || timeDomain.length !== analyser.fftSize) timeDomain = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(timeDomain);
        let energy = 0;
        for (const sample of timeDomain) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        const rms = Math.sqrt(energy / timeDomain.length);
        adaptivePeak = Math.max(rms, adaptivePeak * Math.exp(-deltaMs / 1450), 0.025);
        const normalized = Math.max(0, (rms - 0.0035) / Math.max(0.018, adaptivePeak - 0.0035));
        targetLevel = Math.min(1, Math.pow(normalized, 0.72));
      } else if (isSpeaking) {
        const syllable = Math.max(0, Math.sin(timestamp * 0.027));
        const cadence = Math.sin(timestamp * 0.006) > -0.72 ? 1 : 0.08;
        targetLevel = Math.min(0.82, (syllable * 0.58 + Math.max(0, Math.sin(timestamp * 0.043)) * 0.24) * cadence);
      }

      const fallbackViseme = ["REST", "A", "E", "CLOSED", "O", "E", "U", "REST"][Math.floor(timestamp / 118) % 8];
      const timeline = activeTimelineRef.current;
      const timelineDriven = Boolean(isSpeaking && timeline?.visemes?.length);
      const sample = timelineDriven
        ? sampleVisemeTimeline(timeline, performance.now())
        : { current: fallbackViseme, next: fallbackViseme, mix: 0, progress: 0 };
      const profile = blendVisemeProfiles(visemeProfiles, sample);
      const timelineElapsedMs = sample.progress * (Number(timeline?.durationMs) || 0);
      const prosody = isSpeaking ? sampleSpeechProsody(timeline?.prosody, timelineElapsedMs) : { nod: 0, tilt: 0 };
      smoothedLevel += (targetLevel - smoothedLevel) * smoothingAlpha(deltaMs, targetLevel > smoothedLevel ? 34 : 72);
      gateState = updateVisemeGate(gateState, smoothedLevel, timestamp, isSpeaking);
      const desiredOpen = sampleMouthAperture({
        profileOpen: profile.open,
        energy: smoothedLevel,
        timelineDriven,
        speaking: isSpeaking,
      });
      const openTime = isSpeaking ? (desiredOpen > smoothedOpen ? 48 : 88) : settling ? 150 : 240;
      const openCandidate = smoothedOpen + (desiredOpen - smoothedOpen) * smoothingAlpha(facialDeltaMs, openTime);
      smoothedOpen = approachByRate(smoothedOpen, openCandidate, facialDeltaMs, desiredOpen > smoothedOpen ? 0.0055 : 0.0042);
      const desiredWidth = isSpeaking ? profile.width : 1;
      smoothedWidth += (desiredWidth - smoothedWidth) * smoothingAlpha(facialDeltaMs, isSpeaking ? 72 : 320);

      const authoredJawAperture = isSpeaking
        ? Math.max(0, profile.open - visemeProfiles.CLOSED.open) * (0.62 + smoothedLevel * 0.18)
        : 0;
      const jawTarget = sampleJawPose({ mouthOpen: Math.max(smoothedOpen, authoredJawAperture), energy: smoothedLevel, speaking: isSpeaking });
      const jawDeltaMs = Math.min(facialDeltaMs, 32);
      const jawCandidate = smoothedJawOpen + (jawTarget.open - smoothedJawOpen) * smoothingAlpha(jawDeltaMs, jawTarget.open > smoothedJawOpen ? 64 : settling ? 98 : 104);
      // Short timestamped vowels still need enough physical travel for the chin
      // to stay synchronized with the authored lower lip in packaged playback.
      smoothedJawOpen = approachByRate(smoothedJawOpen, jawCandidate, jawDeltaMs, jawTarget.open > smoothedJawOpen ? 0.006 : 0.0032);

      const desiredViseme = isSpeaking && (timelineDriven || gateState.open) ? profile.label : "CLOSED";
      visemeState = stabilizeVisemeLabel(visemeState, desiredViseme, timestamp, isSpeaking, { timestamped: timelineDriven });
      // Keep the timestamped label, but pass it through one time-based visual
      // transition. The previous midpoint texture swap was audio-aligned yet
      // looked unnaturally fast on a photographic face.
      visemeBlend = advanceVisemeBlend(visemeBlend, visemeState.displayed, timestamp);
      renderedMouthWeights = visemeBlend.weights;
      const activeEventIndex = Math.min(
        Math.max(0, Number(sample.eventIndex) || 0) + (Number(sample.mix) >= 0.5 ? 1 : 0),
        Math.max(0, (timeline?.visemes?.length || 1) - 1),
      );
      if (lastFaceTelemetryAt === 0 || timestamp - lastFaceTelemetryAt >= 30) {
        setDataset("jawOpen", smoothedJawOpen.toFixed(3));
        setDataset("viseme", visemeBlend.dominant);
        setDataset("visemeTarget", timelineDriven ? profile.label : visemeState.displayed);
        setDataset("visemeCurrent", sample.current || "CLOSED");
        setDataset("visemeNext", sample.next || sample.current || "CLOSED");
        setDataset("visemeBlend", visemeBlend.mix.toFixed(3));
        setDataset("visemeCharacter", timelineDriven ? timeline?.visemes?.[activeEventIndex]?.character || "" : "");
        setDataset("visemeEvent", timelineDriven ? String(activeEventIndex) : "");
        setDataset("visemeCharacterIndex", timelineDriven ? String(timeline?.visemes?.[activeEventIndex]?.characterIndex ?? "") : "");
        setDataset("visemeRole", timelineDriven ? timeline?.visemes?.[activeEventIndex]?.role || "" : "");
        setDataset("visemeAlignment", timeline?.alignment?.provider || "none");
        setDataset("avatarState", isSpeaking ? "speaking" : settling ? "settling" : "idle");
        lastFaceTelemetryAt = timestamp;
      }

      const desiredMood = normalizeMood(moodRef.current);
      if (desiredMood !== displayedMood && desiredMood !== pendingMood) {
        pendingMood = desiredMood;
        pendingMoodSince = timestamp;
      }
      if (pendingMood && timestamp - pendingMoodSince >= 180) {
        displayedMood = pendingMood;
        pendingMood = null;
        pendingMoodSince = 0;
      }
      const targetMoodTilt = displayedMood === "listening" ? 0.11 : displayedMood === "concern" ? -0.09 : displayedMood === "encourage" ? -0.04 : 0;
      const targetMoodY = displayedMood === "concern" ? 0.045 : displayedMood === "encourage" ? -0.035 : 0;
      const moodPoseAlpha = smoothingAlpha(deltaMs, 460);
      smoothedMoodTilt += (targetMoodTilt - smoothedMoodTilt) * moodPoseAlpha;
      smoothedMoodY += (targetMoodY - smoothedMoodY) * moodPoseAlpha;
      const expressionTarget = sampleExpressionStrength({
        mood: displayedMood,
        speaking: isSpeaking,
        elapsedMs: speechStartedAt >= 0 ? timestamp - speechStartedAt : 0,
        energy: smoothedLevel,
        prosody,
      });
      smoothedExpressionStrength += (expressionTarget - smoothedExpressionStrength) * smoothingAlpha(facialDeltaMs, expressionTarget > smoothedExpressionStrength ? 760 : 960);
      setStyleProperty("--expression-strength", smoothedExpressionStrength.toFixed(2));
      setDataset("semanticExpression", displayedMood);

      const localFaceActions = buildLocalFaceActions({
        viseme: isSpeaking ? visemeBlend.dominant : "CLOSED",
        mouthOpen: smoothedJawOpen,
        mouthWidth: smoothedWidth,
        expression: displayedMood,
        expressionStrength: smoothedExpressionStrength,
        mouthBlend: visemeBlend,
      });
      const rigSignature = `${localFaceActions.viseme}|${localFaceActions.mouthBlend.from}>${localFaceActions.mouthBlend.to}@${localFaceActions.mouthBlend.mix.toFixed(3)}|${localFaceActions.jawOpen.toFixed(3)}|${localFaceActions.mouthStretchLeft.toFixed(3)}|${localFaceActions.mouthPucker.toFixed(3)}`;
      // The compact lower-face canvas costs about 1-2 ms per paint on the
      // target kiosk. Keep it display-paced (up to 60 fps) so jaw easing does
      // not visibly step at the former 30 fps throttle.
      if (localRigReady && rigSignature !== lastRigSignature && (lastRigSignature === "" || timestamp - lastRigPaintAt >= 15)) {
        if (renderLocalFaceRig(localRigCanvasRef.current, localRigImagesRef.current, localFaceActions)) {
          lastRigPaintAt = timestamp;
          lastRigSignature = rigSignature;
          avatar.dataset.localRig = "local-mouth-chin-v34";
        }
      }

      const motionPhase = isSpeaking ? "speaking" : settling ? "settling" : "idle";
      setDataset("motionPhase", motionPhase);
      if (timestamp - lastBlinkTelemetryAt >= 250) {
        setDataset("blinkWaitMs", Math.max(0, Math.round(nextBlinkAt - timestamp)));
        lastBlinkTelemetryAt = timestamp;
      }

      if (blinkStartedAt < 0 && timestamp >= nextBlinkAt) {
        if (isSpeaking && smoothedLevel > 0.18) nextBlinkAt = timestamp + 120;
        else {
          blinkStartedAt = timestamp;
          blinkProfile = createBlinkProfile(Math.random(), { speaking: isSpeaking, doubleBlink: pendingDoubleBlink });
        }
      }
      if (blinkStartedAt >= 0) {
        const blink = sampleBlinkEnvelope(timestamp - blinkStartedAt, blinkProfile);
        const blinkAmount = blink.amount * blinkStrength;
        const blinkPhase = blinkAmount >= 0.88 ? "closed" : blinkAmount > 0.08 ? "half" : "";
        if (blinkPhase === "closed" && pendingMood) {
          displayedMood = pendingMood;
          pendingMood = null;
          pendingMoodSince = 0;
        }
        setDataset("blinkPhase", blinkPhase);
        setDataset("expression", blinkPhase ? "blink" : displayedMood);
        if (blink.complete) {
          blinkStartedAt = -1;
          if (pendingDoubleBlink) {
            pendingDoubleBlink = false;
            blinkStrength = 1;
            nextBlinkAt = timestamp + nextBlinkDelay(Math.random(), { mood: moodRef.current, speaking: speakingRef.current });
          } else if (Math.random() < 0.06) {
            pendingDoubleBlink = true;
            blinkStrength = 0.82;
            nextBlinkAt = timestamp + nextBlinkDelay(Math.random(), { doubleBlink: true });
          } else nextBlinkAt = timestamp + nextBlinkDelay(Math.random(), { mood: moodRef.current, speaking: speakingRef.current });
        }
      } else {
        setDataset("blinkPhase", "");
        setDataset("expression", displayedMood);
      }

      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      resetAvatarState(avatar, localRigCanvasRef.current);
    };
  }, [activeAnalyserRef, activeTimelineRef, localRigReady]);

  const stateMood = normalizeMood(listening && mood === "neutral" ? "listening" : mood);
  return (
    <div
      ref={avatarRef}
      className={`station-advisor-digital-human ${speaking ? "is-speaking" : ""} ${localRigReady ? "has-local-rig" : ""} ${className}`.trim()}
      data-avatar-mode="local"
      data-mood={stateMood}
      data-rig-ready={localRigReady ? "true" : "false"}
      data-rig-error={localRigError ? "true" : "false"}
      data-rig-error-message={localRigError}
      data-speaking={speaking ? "true" : "false"}
    >
      <img src={avatarAssets.master} alt={alt} className="station-advisor-digital-human__image" />
      <img src={avatarAssets.master} alt="" className="station-advisor-digital-human__breath-frame" aria-hidden="true" />
      <canvas ref={localRigCanvasRef} className="station-advisor-digital-human__local-rig" aria-hidden="true" />
      <img src={avatarAssets.smile} alt="" className="station-advisor-digital-human__expression-frame station-advisor-digital-human__expression-frame--smile" aria-hidden="true" />
      <img src={avatarAssets.concern} alt="" className="station-advisor-digital-human__expression-frame station-advisor-digital-human__expression-frame--concern" aria-hidden="true" />
      <img src={avatarAssets.encourage} alt="" className="station-advisor-digital-human__expression-frame station-advisor-digital-human__expression-frame--encourage" aria-hidden="true" />
      <img src={avatarAssets.listening} alt="" className="station-advisor-digital-human__expression-frame station-advisor-digital-human__expression-frame--listening" aria-hidden="true" />
      <img src={avatarAssets.blinkHalf} alt="" className="station-advisor-digital-human__blink-frame station-advisor-digital-human__blink-frame--half station-advisor-digital-human__blink-frame--screen-left" aria-hidden="true" />
      <img src={avatarAssets.blinkHalf} alt="" className="station-advisor-digital-human__blink-frame station-advisor-digital-human__blink-frame--half station-advisor-digital-human__blink-frame--screen-right" aria-hidden="true" />
      <img src={avatarAssets.blinkClosed} alt="" className="station-advisor-digital-human__blink-frame station-advisor-digital-human__blink-frame--closed station-advisor-digital-human__blink-frame--screen-left" aria-hidden="true" />
      <img src={avatarAssets.blinkClosed} alt="" className="station-advisor-digital-human__blink-frame station-advisor-digital-human__blink-frame--closed station-advisor-digital-human__blink-frame--screen-right" aria-hidden="true" />
    </div>
  );
});

StationAdvisorDigitalHuman.displayName = "StationAdvisorDigitalHuman";
