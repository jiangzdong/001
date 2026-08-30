import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle, EarSlash, Heartbeat, HouseLine, Info,
  ClipboardText, CloudCheck, GearSix, Key, ListChecks, LockKey, Microphone, Minus, PaperPlaneTilt, PersonSimpleWalk, Plus, ShieldCheck,
  SpeakerSimpleHigh, SpeakerSimpleSlash, Speedometer, StopCircle, TextAa, Waveform,
} from "@phosphor-icons/react";
import { recordSpeech } from "./speechRecorder.js";
import { assessmentQuestions as questions } from "./skills/healthAssessment.js";
import { detectSafetySignal, localInterpretAssessment, resolveOption, validateInterpretation } from "./assessmentUnderstanding.js";
import { advanceAssessment } from "./assessmentFlow.js";
import { advanceVisemeBlend, blendVisemeProfiles, createBlinkProfile, createSpeechProsodyTimeline, inferSpeechMood, nextBlinkDelay, sampleBlinkEnvelope, sampleExpressionStrength, sampleJawPose, sampleMouthAperture, sampleSpeechProsody, sampleUpperBodyPose, sampleVisemeTimeline, shouldUseAuthenticAvatar, smoothingAlpha, stabilizeVisemeLabel, updateVisemeGate } from "./avatarMotion.js";
import { buildPersonalizedHealthPlan } from "./skills/personalizedHealthPlan.js";
import { advanceSymptomConversation, resetSymptomConversation, startSymptomConversation } from "./symptomConversation.js";
import { buildOffTopicReply } from "./offTopicReply.js";
import { createIncrementalSpeechSegmenter, createSpeechChunkQueue, createSpeechTurnId, splitSpeechSegments } from "./streamingSpeech.js";
import { buildLocalFaceActions, loadLocalFaceRigImages, renderLocalFaceRig } from "./localFaceRig.js";

const quickPrompts = ["我最近有点头痛", "最近睡眠不太好", "我想做健康测评"];
const appVersion = `V${__APP_VERSION__}`;
const nativeSpeechOutputGain = 2.8;
const defaultVoiceId = "zh-ll-2";
const cloudGpuAvailable = false;
const selectedVoice = { id: defaultVoiceId, label: "小安默认女声", spokenLabel: "小安默认女声", detail: "普通话女声" };
const visemeProfiles = {
  CLOSED: { open: 0.01, width: 0.94, radius: "48%" },
  REST: { open: 0.18, width: 0.98, radius: "44%" },
  A: { open: 0.94, width: 1.01, radius: "42%" },
  E: { open: 0.38, width: 1.2, radius: "36%" },
  O: { open: 0.68, width: 0.82, radius: "50%" },
  U: { open: 0.4, width: 0.72, radius: "50%" },
  F: { open: 0.22, width: 1.04, radius: "38%" },
  L: { open: 0.5, width: 1.02, radius: "42%" },
  S: { open: 0.24, width: 1.12, radius: "34%" },
  SH: { open: 0.46, width: 0.8, radius: "50%" },
};
function loadVolumePreference() {
  try {
    const savedValue = window.localStorage.getItem("xiaoan.volume");
    if (savedValue === null) return 80;
    const savedVolume = Number(savedValue);
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 100) return savedVolume;
  } catch {}
  return 80;
}

function loadAvatarModePreference() {
  try {
    return cloudGpuAvailable && window.localStorage.getItem("xiaoan.avatarMode") === "cloud-gpu" ? "cloud-gpu" : "local";
  } catch {}
  return "local";
}

function approachByRate(current, target, deltaMs, unitsPerMs) {
  const difference = target - current;
  const maximumStep = Math.max(0, deltaMs) * unitsPerMs;
  return current + Math.max(-maximumStep, Math.min(maximumStep, difference));
}

function useModalFocus(open, onClose, dialogRef, initialFocusRef) {
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusInitial = window.setTimeout(() => (initialFocusRef.current || dialogRef.current?.querySelector("button, input"))?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusInitial);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [dialogRef, initialFocusRef, onClose, open]);
}

function isExplicitAssessmentRequest(text) {
  const value = String(text || "").replace(/[，。！？\s]/g, "");
  return /(做|开始|进行|想做|要做|帮我做).{0,4}(健康)?(测评|问卷)|(健康测评|健康问卷)/.test(value);
}

function localReply(text, messages = []) {
  const value = text.replace(/[，。！？\s]/g, "");
  if (isExplicitAssessmentRequest(value)) return { action: "assessment", text: "好的，我们现在开始。测评一共有八个简单问题，您可以直接说，也可以点击屏幕。" };
  if (/睡眠|睡不着|失眠/.test(value)) return { text: "我听到了。您可以先告诉我，是入睡困难、夜里容易醒，还是早上醒得太早？" };
  if (/血压/.test(value)) return { text: "建议在安静休息几分钟后测量，并记录日期、时间和结果。您也可以告诉我最近一次测量的大致数值。" };
  if (/吃药|服药|药物/.test(value)) return { text: "请按医生交代的方式服用，不要自行改变用量。需要的话，我可以帮您记录是否容易忘记服药。" };
  if (/运动|活动|散步/.test(value)) return { text: "可以从每天十到十五分钟的轻松活动开始，比如散步或做操，以身体感觉舒适为宜。您想把它加入健康计划吗？" };
  if (/血糖|低血糖|空腹糖|餐后糖/.test(value)) return { text: "我可以帮您一起看记录。请告诉我最近一次是空腹还是餐后测量，以及大致数值。" };
  if (/按摩|按揉|推拿|穴位/.test(value)) return { text: "可以先判断是否适合操作。请告诉我想放松哪个部位，以及现在有没有明显不适。" };
  if (/康复|术后|功能训练|辅具/.test(value)) return { text: "我先了解目标。您主要是术后康复、慢性不适，还是日常功能训练？" };
  if (/记忆|记性|健忘|脑健康/.test(value)) return { text: "我先了解变化。主要是容易忘事、注意力下降，还是最近突然出现变化？" };
  if (/你是谁|介绍/.test(value)) return { text: "我是小安，您的数字健康管理师。我可以陪您完成健康测评、解释结果，并一起制定日常健康计划。" };
  if (/你好|您好/.test(value)) return { text: "您好，很高兴见到您。您可以直接告诉我今天想了解什么。" };
  return buildOffTopicReply(text, { messages });
}

function TopControlButton({ icon: Icon, label, detail, active, onClick, ...buttonProps }) {
  return <button type="button" className={`top-control-button ${active ? "is-active" : ""}`} onClick={onClick} aria-pressed={active} {...buttonProps}>
    <span className="top-control-button__icon"><Icon weight="bold" aria-hidden="true"/></span>
    <span className="top-control-button__copy"><strong>{label}</strong><small>{detail}</small></span>
  </button>;
}

function ToastNotice({ notice, inline = false }) {
  if (!notice) return null;
  const speechRetry = notice.kind === "speech-retry";
  return <div className={`toast toast--${notice.kind || "info"} ${inline ? "is-inline" : ""}`} role={speechRetry ? "alert" : "status"} aria-live={speechRetry ? "assertive" : "polite"}>
    <span className="toast__icon">{speechRetry ? <EarSlash weight="bold"/> : <Info weight="fill"/>}</span>
    <span className="toast__copy"><strong>{speechRetry ? "没有听清，也没关系" : "温馨提示"}</strong><small>{notice.text}</small></span>
  </div>;
}

function VoiceControl({ listening, recognizing, speaking = false, supported, onClick, compact = false, automatic = false, transcript = "" }) {
  const helperText = recognizing
    ? "小安正在理解您刚才说的内容"
    : listening
      ? (transcript || "请直接说话，说完后会自动识别")
      : speaking
        ? "点击即可打断小安并开始提问"
      : automatic
        ? (supported ? "持续聆听中，说完后会自动识别" : "可点击下方文字继续体验")
        : (supported ? "点击后直接说出您的答案" : "可点击上方选项继续");
  return <button className={`voice-control ${listening ? "is-listening" : ""} ${recognizing ? "is-recognizing" : ""} ${compact ? "is-compact" : ""}`} onClick={onClick} disabled={recognizing} aria-pressed={listening} aria-label={recognizing ? "正在识别语音" : listening ? "点击停止并识别" : speaking ? "打断小安并开始提问" : automatic ? "语音识别已准备，点击可重新启动" : "点击开始语音识别"}>
    <span className="voice-control__icon">{recognizing ? <Waveform weight="bold"/> : listening ? <StopCircle weight="fill"/> : <Microphone weight="fill"/>}</span>
    <span className="voice-control__copy"><strong>{recognizing ? "正在识别，请稍等" : listening ? "正在听，请直接说" : speaking ? "小安正在回答" : automatic ? "小安已准备聆听" : "用语音回答"}</strong><small>{helperText}</small></span>
    <span className="wave-bars" aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <i key={index}/>)}</span>
  </button>;
}

function SpeechTranscript({ transcript, listening, recognizing }) {
  if (!transcript && !listening && !recognizing) return null;
  const status = recognizing ? "正在识别" : listening ? "正在听" : "识别结果";
  return <div className={`speech-transcript ${recognizing ? "is-recognizing" : ""}`} role="status" aria-live="polite">
    <Waveform weight="bold" aria-hidden="true"/>
    <span><small>{status}</small><strong>{transcript || "请开始说话"}</strong></span>
  </div>;
}

function DigitalHuman({ speaking, analyserRef, visemeTimelineRef, videoActive, videoSrc, frameActive, frameSinkRef, volume, slow, mood, avatarMode = "local", onVideoEnded, onVideoError }) {
  const avatarRef = useRef(null);
  const videoRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const localRigCanvasRef = useRef(null);
  const localRigImagesRef = useRef(null);
  const videoFrameRef = useRef(null);
  const videoExitTimerRef = useRef(null);
  const speakingRef = useRef(speaking);
  const videoActiveRef = useRef(videoActive);
  const moodRef = useRef(mood);
  const [videoReady, setVideoReady] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [localRigReady, setLocalRigReady] = useState(false);
  const [videoSettling, setVideoSettling] = useState(false);
  const videoErrorRef = useRef(onVideoError);
  speakingRef.current = speaking;
  videoActiveRef.current = (videoActive && videoReady) || (frameActive && frameReady);
  moodRef.current = mood;
  useEffect(() => { videoErrorRef.current = onVideoError; }, [onVideoError]);
  useEffect(() => {
    if (!frameSinkRef) return undefined;
    let mounted = true;
    frameSinkRef.current = async (frame) => {
      const canvas = frameCanvasRef.current;
      if (!mounted || !canvas || !frame?.bytes?.length) return false;
      const bitmap = await createImageBitmap(new Blob([frame.bytes], { type: frame.contentType || "image/jpeg" }));
      if (!mounted || frameCanvasRef.current !== canvas) { bitmap.close(); return false; }
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      setFrameReady(true);
      return true;
    };
    return () => { mounted = false; frameSinkRef.current = null; };
  }, [frameSinkRef]);
  useEffect(() => {
    if (frameActive) return;
    setFrameReady(false);
    const canvas = frameCanvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [frameActive]);
  const clearVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (videoFrameRef.current == null) return;
    if (video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoFrameRef.current);
    else window.cancelAnimationFrame(videoFrameRef.current);
    videoFrameRef.current = null;
  }, []);
  const clearVideoExitTimer = useCallback(() => {
    if (videoExitTimerRef.current == null) return;
    window.clearTimeout(videoExitTimerRef.current);
    videoExitTimerRef.current = null;
  }, []);
  const confirmVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoActive || video.readyState < 2) return;
    clearVideoFrame();
    const reveal = () => {
      videoFrameRef.current = null;
      if (videoRef.current === video && videoActive && !video.paused) {
        setVideoSettling(false);
        setVideoReady(true);
      }
    };
    videoFrameRef.current = video.requestVideoFrameCallback
      ? video.requestVideoFrameCallback(reveal)
      : window.requestAnimationFrame(reveal);
  }, [clearVideoFrame, videoActive]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    clearVideoFrame();
    clearVideoExitTimer();
    setVideoSettling(false);
    setVideoReady(false);
    if (!videoActive) {
      video.pause();
      video.currentTime = 0;
      return undefined;
    }
    video.currentTime = 0;
    video.play().catch(() => videoErrorRef.current?.());
    return () => {
      clearVideoFrame();
      clearVideoExitTimer();
      setVideoSettling(false);
      setVideoReady(false);
      video.pause();
    };
  }, [clearVideoExitTimer, clearVideoFrame, videoActive, videoSrc]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = volume === 0;
    video.volume = volume / 100;
    video.playbackRate = slow ? 0.82 : 1;
  }, [slow, volume]);
  useEffect(() => {
    let cancelled = false;
    if (avatarMode !== "local") {
      localRigImagesRef.current = null;
      setLocalRigReady(false);
      localRigCanvasRef.current?.getContext("2d")?.clearRect(0, 0, localRigCanvasRef.current.width, localRigCanvasRef.current.height);
      return undefined;
    }
    loadLocalFaceRigImages().then((images) => {
      if (cancelled) return;
      localRigImagesRef.current = images;
      const master = images.get("CLOSED");
      const canvas = localRigCanvasRef.current;
      if (canvas && master) {
        canvas.width = master.naturalWidth;
        canvas.height = master.naturalHeight;
      }
      setLocalRigReady(true);
    }).catch(() => {
      if (!cancelled) setLocalRigReady(false);
    });
    return () => { cancelled = true; };
  }, [avatarMode]);
  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar) return undefined;
    let frame = 0;
    let lastTimestamp = performance.now();
    let smoothedLevel = 0;
    let smoothedOpen = 0;
    let smoothedOpacity = 0;
    let smoothedWidth = 1;
    let smoothedJawOpen = 0;
    let smoothedMotion = 1;
    let smoothedExpressionStrength = 0;
    let adaptivePeak = 0.06;
    let timeDomain = null;
    let gateState = { open: false, closeAt: lastTimestamp };
    let visemeState = { displayed: "CLOSED", candidate: "CLOSED", candidateSince: lastTimestamp, changedAt: lastTimestamp };
    let visemeBlend = advanceVisemeBlend(null, "CLOSED", lastTimestamp);
    let renderedMouthWeights = {};
    let lastRigPaintAt = 0;
    let lastRigSignature = "";
    let wasOfflineSpeaking = false;
    let speechStartedAt = -1;
    let settleUntil = 0;
    let blinkStartedAt = -1;
    let nextBlinkAt = lastTimestamp + nextBlinkDelay(Math.random(), { mood: moodRef.current });
    let pendingDoubleBlink = false;
    let blinkStrength = 1;
    let blinkProfile = createBlinkProfile(Math.random());
    let renderedBodyPose = { x: 0, y: 0, tilt: 0, scale: 1, breath: 0, chestRise: 0, chestScaleX: 1, chestScaleY: 1 };
    let blinkBodyPose = null;
    const normalizeMood = (value) => (["smile", "concern", "encourage", "listening"].includes(value) ? value : "neutral");
    let displayedMood = normalizeMood(moodRef.current);
    let pendingMood = null;
    let pendingMoodSince = 0;
    let smoothedMoodTilt = 0;
    let smoothedMoodY = 0;
    const animateMouth = (timestamp) => {
      const deltaMs = Math.max(1, Math.min(80, timestamp - lastTimestamp));
      const facialDeltaMs = Math.min(34, deltaMs);
      lastTimestamp = timestamp;
      const offlineSpeaking = Boolean(speakingRef.current && !videoActiveRef.current);
      if (offlineSpeaking && !wasOfflineSpeaking) {
        speechStartedAt = timestamp;
        renderedMouthWeights = {};
      }
      if (wasOfflineSpeaking && !offlineSpeaking) settleUntil = timestamp + 520;
      if (!offlineSpeaking && timestamp >= settleUntil) speechStartedAt = -1;
      wasOfflineSpeaking = offlineSpeaking;
      const settling = !offlineSpeaking && timestamp < settleUntil;
      const analyser = offlineSpeaking ? analyserRef.current : null;
      let targetLevel = 0;
      if (offlineSpeaking && analyser) {
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
      } else if (offlineSpeaking) {
        const syllable = Math.max(0, Math.sin(timestamp * 0.027));
        const cadence = Math.sin(timestamp * 0.006) > -0.72 ? 1 : 0.08;
        targetLevel = Math.min(0.82, (syllable * 0.58 + Math.max(0, Math.sin(timestamp * 0.043)) * 0.24) * cadence);
      }

      const fallbackViseme = ["REST", "A", "E", "CLOSED", "O", "E", "U", "REST"][Math.floor(timestamp / 118) % 8];
      const sample = offlineSpeaking && visemeTimelineRef.current?.visemes?.length
        ? sampleVisemeTimeline(visemeTimelineRef.current, performance.now())
        : { current: fallbackViseme, next: fallbackViseme, mix: 0 };
      const timelineDriven = Boolean(offlineSpeaking && visemeTimelineRef.current?.visemes?.length);
      const profile = blendVisemeProfiles(visemeProfiles, sample);
      const timelineElapsedMs = sample.progress * (Number(visemeTimelineRef.current?.durationMs) || 0);
      const prosody = offlineSpeaking
        ? sampleSpeechProsody(visemeTimelineRef.current?.prosody, timelineElapsedMs)
        : { nod: 0, tilt: 0 };
      const levelAlpha = smoothingAlpha(deltaMs, targetLevel > smoothedLevel ? 34 : 72);
      smoothedLevel += (targetLevel - smoothedLevel) * levelAlpha;
      gateState = updateVisemeGate(gateState, smoothedLevel, timestamp, offlineSpeaking);
      const desiredOpen = sampleMouthAperture({
        profileOpen: profile.open,
        energy: smoothedLevel,
        timelineDriven,
        speaking: offlineSpeaking,
      });
      const openTime = offlineSpeaking ? (desiredOpen > smoothedOpen ? 48 : 88) : settling ? 150 : 240;
      const openCandidate = smoothedOpen + (desiredOpen - smoothedOpen) * smoothingAlpha(facialDeltaMs, openTime);
      smoothedOpen = approachByRate(smoothedOpen, openCandidate, facialDeltaMs, desiredOpen > smoothedOpen ? 0.0055 : 0.0042);
      const desiredOpacity = offlineSpeaking ? Math.min(0.94, 0.11 + smoothedOpen * 0.9) : 0;
      smoothedOpacity += (desiredOpacity - smoothedOpacity) * smoothingAlpha(facialDeltaMs, offlineSpeaking ? 58 : settling ? 110 : 180);
      const desiredWidth = offlineSpeaking ? profile.width : 1;
      smoothedWidth += (desiredWidth - smoothedWidth) * smoothingAlpha(facialDeltaMs, offlineSpeaking ? 72 : 320);
      // The selected photographic viseme already contains its authored lower-
      // lip displacement. Give the chin a matching aperture floor even when a
      // quiet syllable has low PCM energy, otherwise the lower lip approaches a
      // fixed chin and makes this identity's naturally long chin look shorter.
      const authoredJawAperture = offlineSpeaking
        ? Math.max(0, profile.open - visemeProfiles.CLOSED.open) * (0.62 + smoothedLevel * 0.18)
        : 0;
      const jawTarget = sampleJawPose({ mouthOpen: Math.max(smoothedOpen, authoredJawAperture), energy: smoothedLevel, speaking: offlineSpeaking });
      // The mouth and chin now live in the same lower-face replacement, so they
      // always arrive together. Cap the follower's frame delta as well as its
      // rate to prevent a delayed render frame from creating a visible jaw snap.
      const jawDeltaMs = Math.min(facialDeltaMs, 32);
      const jawCandidate = smoothedJawOpen + (jawTarget.open - smoothedJawOpen) * smoothingAlpha(jawDeltaMs, jawTarget.open > smoothedJawOpen ? 64 : settling ? 98 : 104);
      smoothedJawOpen = approachByRate(smoothedJawOpen, jawCandidate, jawDeltaMs, jawTarget.open > smoothedJawOpen ? 0.00135 : 0.0012);
      const jawPose = sampleJawPose({ mouthOpen: smoothedJawOpen, energy: smoothedLevel, speaking: offlineSpeaking || settling });
      avatar.style.setProperty("--mouth-open", smoothedOpen.toFixed(3));
      avatar.style.setProperty("--mouth-shift", `${(smoothedOpen * 0.48).toFixed(3)}cqw`);
      avatar.style.setProperty("--mouth-opacity", smoothedOpacity.toFixed(3));
      avatar.style.setProperty("--mouth-width", smoothedWidth.toFixed(3));
      avatar.style.setProperty("--mouth-radius", profile.radius);
      avatar.style.setProperty("--jaw-open", smoothedJawOpen.toFixed(3));
      avatar.style.setProperty("--jaw-drop", `${jawPose.drop.toFixed(3)}cqw`);
      avatar.style.setProperty("--jaw-scale-y", jawPose.scaleY.toFixed(5));
      avatar.style.setProperty("--jaw-scale-x", jawPose.scaleX.toFixed(5));
      avatar.style.setProperty("--cheek-release", jawPose.cheek.toFixed(3));
      avatar.dataset.jawOpen = smoothedJawOpen.toFixed(3);
      // A timestamped PCM timeline already contains real silence anchors. Do
      // not let a low-energy sustained vowel force the visible sprite back to
      // CLOSED; energy controls aperture, while the timeline controls shape.
      const desiredViseme = offlineSpeaking && (timelineDriven || gateState.open) ? profile.label : "CLOSED";
      visemeState = stabilizeVisemeLabel(visemeState, desiredViseme, timestamp, offlineSpeaking, { timestamped: timelineDriven });
      if (timelineDriven) {
        let timelineMix = Math.min(1, Math.max(0, Number(sample.mix) || 0));
        if (Math.abs(timelineMix - 0.5) < 0.0001) timelineMix = 0.5001;
        // Photographic mouth sprites must never be alpha-blended: two lip
        // textures at once look soft even when their landmarks are aligned.
        // The continuous jaw/lower-face deformation carries the in-between
        // motion while the sharp sprite changes at the coarticulation midpoint.
        const dominant = timelineMix < 0.5 ? sample.current : sample.next;
        renderedMouthWeights = dominant && dominant !== "CLOSED" ? { [dominant]: 1 } : {};
        visemeBlend = { mix: timelineMix, dominant, weights: renderedMouthWeights };
      } else {
        const blended = advanceVisemeBlend(visemeBlend, visemeState.displayed, timestamp);
        const dominant = blended.dominant;
        renderedMouthWeights = dominant && dominant !== "CLOSED" ? { [dominant]: 1 } : {};
        visemeBlend = { ...blended, dominant, weights: renderedMouthWeights };
      }
      avatar.dataset.viseme = visemeBlend.dominant;
      avatar.dataset.visemeTarget = timelineDriven ? profile.label : visemeState.displayed;
      avatar.dataset.visemeCurrent = sample.current || "CLOSED";
      avatar.dataset.visemeNext = sample.next || sample.current || "CLOSED";
      avatar.dataset.visemeBlend = visemeBlend.mix.toFixed(3);
      const activeEventIndex = Math.min(
        Math.max(0, Number(sample.eventIndex) || 0) + (Number(sample.mix) >= 0.5 ? 1 : 0),
        Math.max(0, (visemeTimelineRef.current?.visemes?.length || 1) - 1),
      );
      avatar.dataset.visemeCharacter = timelineDriven ? visemeTimelineRef.current?.visemes?.[activeEventIndex]?.character || "" : "";
      avatar.dataset.visemeEvent = timelineDriven ? String(activeEventIndex) : "";
      avatar.dataset.visemeCharacterIndex = timelineDriven ? String(visemeTimelineRef.current?.visemes?.[activeEventIndex]?.characterIndex ?? "") : "";
      avatar.dataset.visemeRole = timelineDriven ? visemeTimelineRef.current?.visemes?.[activeEventIndex]?.role || "" : "";
      avatar.dataset.visemeAlignment = visemeTimelineRef.current?.alignment?.provider || "none";
      avatar.dataset.avatarState = offlineSpeaking ? "speaking" : settling ? "settling" : "idle";

      const desiredMotion = videoActiveRef.current ? 0 : offlineSpeaking ? 0.94 : 0.78;
      smoothedMotion += (desiredMotion - smoothedMotion) * smoothingAlpha(deltaMs, desiredMotion > smoothedMotion ? 720 : 480);
      const desiredMood = normalizeMood(moodRef.current);
      if (desiredMood !== displayedMood && desiredMood !== pendingMood) {
        pendingMood = desiredMood;
        pendingMoodSince = timestamp;
      }
      // A short answer must not finish before its semantic expression appears.
      // Eye overlays already crossfade; the matching pose is eased below.
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
        speaking: offlineSpeaking,
        elapsedMs: speechStartedAt >= 0 ? timestamp - speechStartedAt : 0,
        energy: smoothedLevel,
        prosody,
      });
      smoothedExpressionStrength += (expressionTarget - smoothedExpressionStrength) * smoothingAlpha(facialDeltaMs, expressionTarget > smoothedExpressionStrength ? 760 : 960);
      avatar.style.setProperty("--expression-strength", smoothedExpressionStrength.toFixed(3));
      avatar.dataset.semanticExpression = displayedMood;
      const localFaceActions = buildLocalFaceActions({
        viseme: offlineSpeaking ? visemeBlend.dominant : "CLOSED",
        mouthOpen: smoothedJawOpen,
        mouthWidth: smoothedWidth,
        expression: displayedMood,
        expressionStrength: smoothedExpressionStrength,
      });
      const rigSignature = `${localFaceActions.viseme}|${localFaceActions.jawOpen.toFixed(3)}|${localFaceActions.mouthStretchLeft.toFixed(3)}|${localFaceActions.mouthPucker.toFixed(3)}`;
      if (avatarMode === "local" && localRigReady && (rigSignature !== lastRigSignature || timestamp - lastRigPaintAt >= 33)) {
        if (renderLocalFaceRig(localRigCanvasRef.current, localRigImagesRef.current, localFaceActions)) {
          lastRigPaintAt = timestamp;
          lastRigSignature = rigSignature;
          avatar.dataset.localRig = "local-mouth-chin-v2";
        }
      }
      const bodyPose = sampleUpperBodyPose({
        elapsedMs: timestamp,
        speaking: offlineSpeaking,
        motion: smoothedMotion,
        energy: smoothedLevel,
        prosody,
        moodTilt: videoActiveRef.current ? 0 : smoothedMoodTilt,
        moodY: videoActiveRef.current ? 0 : smoothedMoodY,
      });
      if (blinkStartedAt >= 0 && !blinkBodyPose) blinkBodyPose = { ...renderedBodyPose };
      if (blinkStartedAt < 0) blinkBodyPose = null;
      if (blinkBodyPose) renderedBodyPose = blinkBodyPose;
      else {
        const postureAlpha = smoothingAlpha(deltaMs, 150);
        renderedBodyPose = {
          x: renderedBodyPose.x + (bodyPose.x - renderedBodyPose.x) * postureAlpha,
          y: renderedBodyPose.y + (bodyPose.y - renderedBodyPose.y) * postureAlpha,
          tilt: renderedBodyPose.tilt + (bodyPose.tilt - renderedBodyPose.tilt) * postureAlpha,
          scale: renderedBodyPose.scale + (bodyPose.scale - renderedBodyPose.scale) * postureAlpha,
          breath: renderedBodyPose.breath + (bodyPose.breath - renderedBodyPose.breath) * postureAlpha,
          chestRise: renderedBodyPose.chestRise + (bodyPose.chestRise - renderedBodyPose.chestRise) * postureAlpha,
          chestScaleX: renderedBodyPose.chestScaleX + (bodyPose.chestScaleX - renderedBodyPose.chestScaleX) * postureAlpha,
          chestScaleY: renderedBodyPose.chestScaleY + (bodyPose.chestScaleY - renderedBodyPose.chestScaleY) * postureAlpha,
        };
      }
      avatar.style.setProperty("--body-x", `${renderedBodyPose.x.toFixed(3)}cqw`);
      avatar.style.setProperty("--body-y", `${renderedBodyPose.y.toFixed(3)}cqw`);
      avatar.style.setProperty("--body-tilt", `${renderedBodyPose.tilt.toFixed(3)}deg`);
      avatar.style.setProperty("--body-scale", renderedBodyPose.scale.toFixed(5));
      avatar.style.setProperty("--breath-phase", renderedBodyPose.breath.toFixed(3));
      avatar.style.setProperty("--chest-rise", `${renderedBodyPose.chestRise.toFixed(3)}cqw`);
      avatar.style.setProperty("--chest-scale-x", renderedBodyPose.chestScaleX.toFixed(5));
      avatar.style.setProperty("--chest-scale-y", renderedBodyPose.chestScaleY.toFixed(5));
      // Keep legacy variables for diagnostics that predate the lower-torso
      // pivot. Rendering now uses the body variables below.
      avatar.style.setProperty("--head-x", `${renderedBodyPose.x.toFixed(3)}cqw`);
      avatar.style.setProperty("--head-y", `${renderedBodyPose.y.toFixed(3)}cqw`);
      avatar.style.setProperty("--head-tilt", `${renderedBodyPose.tilt.toFixed(3)}deg`);
      avatar.style.setProperty("--head-scale", renderedBodyPose.scale.toFixed(5));
      avatar.dataset.motionPhase = offlineSpeaking ? "speaking" : settling ? "settling" : "idle";
      avatar.dataset.motionSource = videoActiveRef.current ? "model" : "local";
      avatar.dataset.blinkWaitMs = String(Math.max(0, Math.round(nextBlinkAt - timestamp)));

      if (!videoActiveRef.current) {
        if (blinkStartedAt < 0 && timestamp >= nextBlinkAt) {
          // Blink at a speech-energy valley instead of in the middle of a
          // stressed syllable.
          if (offlineSpeaking && smoothedLevel > 0.18) nextBlinkAt = timestamp + 120;
          else {
            blinkStartedAt = timestamp;
            blinkProfile = createBlinkProfile(Math.random(), { speaking: offlineSpeaking, doubleBlink: pendingDoubleBlink });
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
          avatar.style.setProperty("--blink-progress", blinkAmount.toFixed(3));
          avatar.dataset.blinkPhase = blinkPhase;
          avatar.dataset.expression = blinkPhase ? "blink" : displayedMood;
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
          avatar.style.setProperty("--blink-progress", "0");
          avatar.dataset.blinkPhase = "";
          avatar.dataset.expression = displayedMood;
        }
      } else {
        blinkStartedAt = -1;
        pendingDoubleBlink = false;
        blinkStrength = 1;
        nextBlinkAt = timestamp + nextBlinkDelay(Math.random(), { mood: moodRef.current });
        displayedMood = desiredMood;
        pendingMood = null;
        pendingMoodSince = 0;
        avatar.style.setProperty("--blink-progress", "0");
        avatar.dataset.blinkPhase = "";
        avatar.dataset.expression = "neutral";
      }
      frame = window.requestAnimationFrame(animateMouth);
    };
    frame = window.requestAnimationFrame(animateMouth);
    return () => {
      window.cancelAnimationFrame(frame);
      avatar.style.setProperty("--mouth-open", "0");
      avatar.style.setProperty("--mouth-shift", "0cqw");
      avatar.style.setProperty("--mouth-opacity", "0");
      avatar.style.setProperty("--mouth-width", "1");
      avatar.style.setProperty("--jaw-open", "0");
      avatar.style.setProperty("--jaw-drop", "0cqw");
      avatar.style.setProperty("--jaw-scale-y", "1");
      avatar.style.setProperty("--jaw-scale-x", "1");
      avatar.style.setProperty("--cheek-release", "0");
      avatar.style.setProperty("--body-x", "0cqw");
      avatar.style.setProperty("--body-y", "0cqw");
      avatar.style.setProperty("--body-tilt", "0deg");
      avatar.style.setProperty("--body-scale", "1");
      avatar.style.setProperty("--breath-phase", "0");
      avatar.style.setProperty("--chest-rise", "0cqw");
      avatar.style.setProperty("--chest-scale-x", "1");
      avatar.style.setProperty("--chest-scale-y", "1");
      avatar.style.setProperty("--head-x", "0cqw");
      avatar.style.setProperty("--head-y", "0cqw");
      avatar.style.setProperty("--head-tilt", "0deg");
      avatar.style.setProperty("--head-scale", "1");
      avatar.style.setProperty("--blink-progress", "0");
      avatar.style.setProperty("--expression-strength", "0");
      delete avatar.dataset.viseme;
      delete avatar.dataset.visemeTarget;
      delete avatar.dataset.visemeCurrent;
      delete avatar.dataset.visemeNext;
      delete avatar.dataset.visemeBlend;
      delete avatar.dataset.visemeCharacter;
      delete avatar.dataset.visemeEvent;
      delete avatar.dataset.visemeCharacterIndex;
      delete avatar.dataset.visemeRole;
      delete avatar.dataset.visemeAlignment;
      delete avatar.dataset.jawOpen;
      delete avatar.dataset.expression;
      delete avatar.dataset.semanticExpression;
      delete avatar.dataset.blinkPhase;
      delete avatar.dataset.avatarState;
      delete avatar.dataset.motionPhase;
      delete avatar.dataset.localRig;
      localRigCanvasRef.current?.getContext("2d")?.clearRect(0, 0, localRigCanvasRef.current.width, localRigCanvasRef.current.height);
    };
  }, [analyserRef, avatarMode, localRigReady, visemeTimelineRef]);

  const finishVideo = () => {
    clearVideoFrame();
    clearVideoExitTimer();
    setVideoSettling(true);
    videoExitTimerRef.current = window.setTimeout(() => {
      videoExitTimerRef.current = null;
      setVideoReady(false);
      setVideoSettling(false);
      onVideoEnded?.();
    }, 320);
  };
  const failVideo = () => { clearVideoFrame(); clearVideoExitTimer(); setVideoSettling(false); setVideoReady(false); onVideoError?.(); };
  return <div ref={avatarRef} data-mood={mood} data-avatar-mode={avatarMode} className={`digital-human ${speaking ? "is-speaking" : ""} ${avatarMode === "local" && localRigReady ? "has-local-rig" : ""} ${(videoActive && videoReady) || (frameActive && frameReady) ? "has-ready-video" : ""} ${videoSettling ? "is-video-settling" : ""}`}>
    <img src="./assets/xiaoa-ditto-master-v1.0.3.png" alt="写实数字健康管理师小安" className="digital-human__image"/>
    <img src="./assets/xiaoa-ditto-master-v1.0.3.png" alt="" className="digital-human__breath-frame" aria-hidden="true"/>
    <canvas ref={localRigCanvasRef} className="digital-human__local-rig" aria-hidden="true"/>
    <img src="./assets/xiaoa-expression-smile-v3.png" alt="" className="digital-human__expression-frame digital-human__expression-frame--smile" aria-hidden="true"/>
    <img src="./assets/xiaoa-expression-concern-v3.png" alt="" className="digital-human__expression-frame digital-human__expression-frame--concern" aria-hidden="true"/>
    <img src="./assets/xiaoa-expression-encourage-v3.png" alt="" className="digital-human__expression-frame digital-human__expression-frame--encourage" aria-hidden="true"/>
    <img src="./assets/xiaoa-expression-listening-v3.png" alt="" className="digital-human__expression-frame digital-human__expression-frame--listening" aria-hidden="true"/>
    <img src="./assets/xiaoa-blink-half-v5.png" alt="" className="digital-human__blink-frame digital-human__blink-frame--half digital-human__blink-frame--screen-left" aria-hidden="true"/>
    <img src="./assets/xiaoa-blink-half-v5.png" alt="" className="digital-human__blink-frame digital-human__blink-frame--half digital-human__blink-frame--screen-right" aria-hidden="true"/>
    <img src="./assets/xiaoa-blink-closed-v3.png" alt="" className="digital-human__blink-frame digital-human__blink-frame--closed digital-human__blink-frame--screen-left" aria-hidden="true"/>
    <img src="./assets/xiaoa-blink-closed-v3.png" alt="" className="digital-human__blink-frame digital-human__blink-frame--closed digital-human__blink-frame--screen-right" aria-hidden="true"/>
    <video ref={videoRef} className="digital-human__video" src={videoSrc} preload="auto" playsInline onLoadedData={confirmVideoFrame} onPlaying={confirmVideoFrame} onEnded={finishVideo} onError={failVideo} aria-label="小安同步嘴型讲解"/>
    <canvas ref={frameCanvasRef} className="digital-human__frame" aria-label="小安实时嘴型帧流"/>
  </div>;
}

export function App() {
  const [screen, setScreen] = useState("welcome");
  const [messages, setMessages] = useState([{ role: "assistant", text: "您好，我是小安。您可以直接和我说话。" }]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [assessmentBusy, setAssessmentBusy] = useState(false);
  const [clarification, setClarification] = useState(null);
  const [safetyNotice, setSafetyNotice] = useState(null);
  const clarificationAttemptsRef = useRef({});
  const [listening, setListening] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [dittoIntroActive, setDittoIntroActive] = useState(false);
  const [dittoSpeechActive, setDittoSpeechActive] = useState(false);
  const [dittoSpeechSrc, setDittoSpeechSrc] = useState("");
  const [dittoFrameActive, setDittoFrameActive] = useState(false);
  const [avatarPreparing, setAvatarPreparing] = useState(false);
  const [speechPreparing, setSpeechPreparing] = useState(false);
  const [speechMood, setSpeechMood] = useState("neutral");
  const [transcript, setTranscript] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [volume, setVolume] = useState(loadVolumePreference);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [slow, setSlow] = useState(false);
  const [avatarMode, setAvatarMode] = useState(loadAvatarModePreference);
  const [showAvatarSettings, setShowAvatarSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const [symptomConversation, setSymptomConversation] = useState(null);
  const [aiChoices, setAiChoices] = useState([]);
  const [aiReady, setAiReady] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const recognitionRef = useRef(null);
  const recordingAbortRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioGainRef = useRef(null);
  const speechUtteranceRef = useRef(null);
  const speechAnalyserRef = useRef(null);
  const speechVisemeTimelineRef = useRef(null);
  const speechTicketRef = useRef(0);
  const activeSpeechTurnRef = useRef("");
  const dittoSpeechUrlRef = useRef("");
  const dittoFrameSinkRef = useRef(null);
  const avatarRenderAbortRef = useRef(null);
  const activeAiRequestRef = useRef("");
  const autoListenTimerRef = useRef(null);
  const autoListenDelayRef = useRef(280);
  const listeningSessionRef = useRef(0);
  const listeningOperationRef = useRef(false);
  const autoListenAllowedRef = useRef(false);
  const toastTimer = useRef(null);
  const announcementTimerRef = useRef(null);
  const keyDialogRef = useRef(null);
  const keyInputRef = useRef(null);
  const avatarSettingsDialogRef = useRef(null);
  const avatarSettingsLocalRef = useRef(null);
  const chatStreamRef = useRef(null);
  const foreheadTapsRef = useRef([]);
  const currentQuestion = questions[questionIndex];
  const hasNativeRecognition = Boolean(window.kioskBridge?.recognizePcm);
  const hasWebRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasLocalWebRecognition = !window.kioskBridge && Boolean(navigator.mediaDevices?.getUserMedia);
  const recognitionSupported = hasNativeRecognition || hasWebRecognition || hasLocalWebRecognition;
  const autoListenAllowed = screen === "talk" && !listening && !recognizing && !speaking && !speechPreparing && !avatarPreparing && !aiBusy && !showKeySetup && !showAvatarSettings;
  autoListenAllowedRef.current = autoListenAllowed;
  const muted = volume === 0;
  const result = useMemo(() => buildPersonalizedHealthPlan(answers), [answers]);
  const avatarExpression = speaking && speechMood !== "neutral"
    ? speechMood
    : screen === "result" && result.level === "attention"
    ? "concern"
    : listening || recognizing
      ? "listening"
    : screen === "plan"
      ? "encourage"
      : screen === "welcome"
        ? "smile"
        : "neutral";
  const closeKeySetup = useCallback(() => setShowKeySetup(false), []);
  const closeAvatarSettings = useCallback(() => setShowAvatarSettings(false), []);
  useModalFocus(showKeySetup, closeKeySetup, keyDialogRef, keyInputRef);
  useModalFocus(showAvatarSettings, closeAvatarSettings, avatarSettingsDialogRef, avatarSettingsLocalRef);

  const notify = useCallback((text, kind = "info") => {
    const message = String(text || "").trim();
    if (!message) return;
    setToast({ text: message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === "speech-retry" ? 4800 : 2800);
  }, []);

  const clearDittoSpeechVideo = useCallback(() => {
    setDittoSpeechActive(false);
    setDittoSpeechSrc("");
    setDittoFrameActive(false);
    if (dittoSpeechUrlRef.current) URL.revokeObjectURL(dittoSpeechUrlRef.current);
    dittoSpeechUrlRef.current = "";
  }, []);

  const stopSpeaking = useCallback(() => {
    const activeTurnId = activeSpeechTurnRef.current;
    activeSpeechTurnRef.current = "";
    speechTicketRef.current += 1;
    avatarRenderAbortRef.current?.abort();
    avatarRenderAbortRef.current = null;
    if (activeTurnId) window.kioskBridge?.cancelSpeechTurn?.(activeTurnId);
    if (activeTurnId) window.kioskBridge?.cancelAvatarTurn?.(activeTurnId);
    window.speechSynthesis?.cancel();
    speechUtteranceRef.current = null;
    try { audioSourceRef.current?.stop(); } catch {}
    audioSourceRef.current = null;
    audioGainRef.current = null;
    speechAnalyserRef.current = null;
    speechVisemeTimelineRef.current = null;
    setSpeechMood("neutral");
    clearDittoSpeechVideo();
    setAvatarPreparing(false);
    setSpeechPreparing(false);
    setSpeaking(false);
  }, [clearDittoSpeechVideo]);

  const chooseAvatarMode = useCallback((nextMode) => {
    if (nextMode === "cloud-gpu" && !cloudGpuAvailable) return;
    const normalized = nextMode === "cloud-gpu" ? "cloud-gpu" : "local";
    stopSpeaking();
    setAvatarMode(normalized);
    try { window.localStorage.setItem("xiaoan.avatarMode", normalized); } catch {}
    setShowAvatarSettings(false);
  }, [stopSpeaking]);

  const updateVolume = useCallback((nextValue) => {
    const nextVolume = Math.min(100, Math.max(0, Math.round(Number(nextValue) || 0)));
    setVolume(nextVolume);
    try { window.localStorage.setItem("xiaoan.volume", String(nextVolume)); } catch {}
    if (speechUtteranceRef.current) speechUtteranceRef.current.volume = nextVolume / 100;
    const context = audioContextRef.current;
    const gain = audioGainRef.current;
    if (context && gain) gain.gain.setTargetAtTime((nextVolume / 100) * nativeSpeechOutputGain, context.currentTime, 0.015);
  }, []);

  const speak = useCallback((text, voiceOverride, { authentic = false, streaming = false } = {}) => {
    if (!text || muted) return Promise.resolve(false);
    stopSpeaking();
    const ticket = speechTicketRef.current;
    const turnId = createSpeechTurnId(ticket);
    activeSpeechTurnRef.current = turnId;
    const voice = voiceOverride || selectedVoice;
    const segments = splitSpeechSegments(text, { minChars: 8, maxChars: 22 });
    let nativeSegmentSequence = 0;
    const isCurrentTurn = () => ticket === speechTicketRef.current && activeSpeechTurnRef.current === turnId;

    const playBrowserSegment = (segment) => new Promise((resolve) => {
      if (!isCurrentTurn() || !("speechSynthesis" in window)) { resolve(false); return; }
      const utterance = new SpeechSynthesisUtterance(segment);
      utterance.lang = "zh-CN"; utterance.rate = slow ? 0.72 : 0.9; utterance.pitch = 1.02; utterance.volume = volume / 100;
      speechUtteranceRef.current = utterance;
      const finishUtterance = () => {
        if (speechUtteranceRef.current === utterance) speechUtteranceRef.current = null;
        resolve(isCurrentTurn());
      };
      utterance.onstart = () => { if (isCurrentTurn()) setSpeaking(true); };
      utterance.onend = finishUtterance;
      utterance.onerror = finishUtterance;
      window.speechSynthesis.speak(utterance);
    });

    const playNativeSegment = async (result, segmentText, { onStarted } = {}) => {
      if (!isCurrentTurn() || !result?.ok || !result.samples?.length) return false;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      if (typeof context.setSinkId === "function" && context.sinkId !== "default") {
        try { await context.setSinkId("default"); } catch { /* Chromium will retain the current system-default route. */ }
      }
      if (context.state === "suspended") await context.resume();
      if (!isCurrentTurn()) return false;
      const samples = result.samples instanceof Float32Array ? result.samples : new Float32Array(result.samples);
      const buffer = context.createBuffer(1, samples.length, result.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      const analyser = context.createAnalyser();
      const envelopeGain = context.createGain();
      const highpass = context.createBiquadFilter();
      const presence = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const masterGain = context.createGain();
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.42;
      const now = context.currentTime;
      const startLeadSeconds = nativeSegmentSequence === 0 ? 0.024 : 0.001;
      const startAtContext = now + startLeadSeconds;
      envelopeGain.gain.setValueAtTime(0.0001, startAtContext);
      envelopeGain.gain.exponentialRampToValueAtTime(1, startAtContext + (nativeSegmentSequence === 0 ? 0.012 : 0.003));
      const fadeStart = Math.max(startAtContext + 0.008, startAtContext + buffer.duration - 0.008);
      envelopeGain.gain.setValueAtTime(1, fadeStart);
      envelopeGain.gain.exponentialRampToValueAtTime(0.0001, startAtContext + buffer.duration);
      highpass.type = "highpass"; highpass.frequency.setValueAtTime(72, now); highpass.Q.setValueAtTime(0.72, now);
      presence.type = "peaking"; presence.frequency.setValueAtTime(2700, now); presence.Q.setValueAtTime(0.7, now); presence.gain.setValueAtTime(1.2, now);
      compressor.threshold.setValueAtTime(-20, now); compressor.knee.setValueAtTime(14, now); compressor.ratio.setValueAtTime(1.8, now); compressor.attack.setValueAtTime(0.004, now); compressor.release.setValueAtTime(0.14, now);
      masterGain.gain.setValueAtTime((volume / 100) * nativeSpeechOutputGain, now);
      source.buffer = buffer; source.connect(analyser); analyser.connect(envelopeGain); envelopeGain.connect(highpass); highpass.connect(presence); presence.connect(compressor); compressor.connect(masterGain); masterGain.connect(context.destination);
      audioSourceRef.current = source; audioGainRef.current = masterGain; speechAnalyserRef.current = analyser;
      speechVisemeTimelineRef.current = {
        visemes: result.visemes || [],
        alignment: result.alignment || null,
        prosody: createSpeechProsodyTimeline(segmentText, buffer.duration * 1000),
        audioContext: context,
        startedAtContext: startAtContext,
        startedAtPerformance: performance.now() + startLeadSeconds * 1000,
        durationMs: buffer.duration * 1000,
      };
      // The dedicated alignment worker has already tied exact text timestamps
      // to this PCM chunk before it reaches the renderer. Playback therefore
      // stays audio-clock driven without running ASR on the animation thread.
      setSpeechMood(inferSpeechMood(segmentText));
      setSpeechPreparing(false); setSpeaking(true);
      return new Promise((resolve) => {
        source.onended = () => {
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null; audioGainRef.current = null; speechAnalyserRef.current = null; speechVisemeTimelineRef.current = null;
          }
          resolve(isCurrentTurn());
        };
        onStarted?.(startAtContext);
        source.start(startAtContext);
        nativeSegmentSequence += 1;
      });
    };

    const prepareNativeSegment = (segment, index) => {
      if (window.kioskBridge?.synthesizeSpeechStream) {
        const queue = createSpeechChunkQueue();
        const streamId = `${turnId}-${index}`;
        const promise = window.kioskBridge.synthesizeSpeechStream(segment, {
          speed: slow ? 0.68 : 0.78,
          voiceId: voice.id,
          turnId,
          streamId,
        }, (event) => {
          if (isCurrentTurn() && event?.type === "chunk" && event.samples?.length) queue.push(event);
        }).then((result) => {
          queue.close();
          return result;
        }).catch((error) => {
          queue.fail(error);
          return { ok: false, message: error?.message || "流式语音合成失败" };
        });
        return { mode: "stream", segment, queue, promise };
      }
      return {
        mode: "complete",
        segment,
        promise: window.kioskBridge.synthesizeSpeech(segment, {
          speed: slow ? 0.68 : 0.78,
          voiceId: voice.id,
          turnId,
        }),
      };
    };

    const playPreparedSegment = async (prepared, options = {}) => {
      if (prepared.mode === "complete") {
        const result = await prepared.promise;
        return playNativeSegment(result, prepared.segment, options);
      }
      let played = false;
      while (isCurrentTurn()) {
        const chunk = await prepared.queue.next();
        if (!chunk) break;
        if (!await playNativeSegment({ ok: true, ...chunk }, chunk.text || prepared.segment, options)) return false;
        played = true;
      }
      const result = await prepared.promise;
      return played && Boolean(result?.ok);
    };

    const playSegmentedSpeech = async () => {
      setAvatarPreparing(false);
      setSpeechPreparing(true);
      try {
        if (window.kioskBridge?.synthesizeSpeech) {
          const prepared = segments.map(prepareNativeSegment);
          for (const preparedSegment of prepared) {
            if (!await playPreparedSegment(preparedSegment)) return;
          }
        } else {
          for (const segment of segments) if (!await playBrowserSegment(segment)) return;
        }
      } catch {
        if (!isCurrentTurn()) return;
        for (const segment of segments) if (!await playBrowserSegment(segment)) return;
      } finally {
        if (isCurrentTurn()) {
          activeSpeechTurnRef.current = "";
          setSpeechPreparing(false);
          setSpeechMood("neutral");
          setSpeaking(false);
        }
      }
    };

    setSpeechPreparing(true);
    const startAuthenticFrameStream = async () => {
      // Audio is the primary clock and must never wait for the optional GPU
      // renderer. Ditto on a 6 GB Turing GPU can be much slower than realtime;
      // local PCM therefore starts first and late video frames are discarded.
      setAvatarPreparing(Boolean(window.kioskBridge?.streamAvatar));
      let audioFinished = false;
      let audioStartedAtPerformance = 0;
      let pendingFrame = null;
      let framePump = null;
      let lastFrameArrival = 0;
      const frameIntervals = [];
      let realtimeFrameReady = false;
      let frameProbeStopped = false;
      const pumpLatestFrame = () => {
        if (framePump || !pendingFrame || audioFinished || !isCurrentTurn()) return;
        framePump = (async () => {
          while (pendingFrame && !audioFinished && isCurrentTurn()) {
            const frame = pendingFrame;
            const frameTimestampMs = Math.max(0, Number(frame.timestampMs) || 0);
            const playbackElapsedMs = Math.max(0, performance.now() - audioStartedAtPerformance);
            if (frameTimestampMs + 180 < playbackElapsedMs) {
              pendingFrame = null;
              continue;
            }
            const waitMs = frameTimestampMs - playbackElapsedMs;
            if (waitMs > 12) {
              await new Promise((resolve) => window.setTimeout(resolve, Math.min(40, waitMs)));
              continue;
            }
            pendingFrame = null;
            setDittoFrameActive(true);
            await dittoFrameSinkRef.current?.(frame);
          }
        })().finally(() => {
          framePump = null;
          if (pendingFrame && !audioFinished && isCurrentTurn()) pumpLatestFrame();
        });
      };
      try {
        if (!window.kioskBridge?.synthesizeSpeech) return false;
        // Submit the short local segments before the optional renderer request.
        // On this 6-core host concurrent VITS jobs materially reduce both first
        // sound and inter-segment gaps compared with serialized generation.
        const preparedSpeech = segments.map(prepareNativeSegment);
        const frameStreamPromise = window.kioskBridge?.streamAvatar
          ? window.kioskBridge.streamAvatar(text, { speed: slow ? 0.82 : 1, voiceId: voice.id, turnId }, (event) => {
            if (!isCurrentTurn() || event?.type !== "frame" || !event.bytes?.length || audioFinished) return;
            const arrivedAt = performance.now();
            if (lastFrameArrival) frameIntervals.push(arrivedAt - lastFrameArrival);
            lastFrameArrival = arrivedAt;
            if (!realtimeFrameReady && frameIntervals.length >= 4) {
              const recent = frameIntervals.slice(-4).sort((left, right) => left - right);
              const medianInterval = (recent[1] + recent[2]) / 2;
              realtimeFrameReady = medianInterval <= 160;
              if (!realtimeFrameReady && frameIntervals.length >= 6 && !frameProbeStopped) {
                frameProbeStopped = true;
                window.kioskBridge?.cancelAvatarTurn?.(turnId);
              }
            }
            if (!realtimeFrameReady) return;
            pendingFrame = event;
            pumpLatestFrame();
          }).catch(() => null)
          : Promise.resolve(null);

        let played = false;
        for (const preparedSegment of preparedSpeech) {
          if (!await playPreparedSegment(preparedSegment, { onStarted: () => {
            if (!audioStartedAtPerformance) {
              audioStartedAtPerformance = performance.now() + 24;
              setAvatarPreparing(false);
            }
          } })) break;
          played = true;
        }
        audioFinished = true;
        pendingFrame = null;
        window.kioskBridge?.cancelAvatarTurn?.(turnId);
        void frameStreamPromise;
        if (isCurrentTurn()) {
          activeSpeechTurnRef.current = "";
          setDittoFrameActive(false);
          setAvatarPreparing(false);
          setSpeechPreparing(false);
          setSpeechMood("neutral");
          setSpeaking(false);
        }
        return played;
      } catch {
        if (ticket === speechTicketRef.current) {
          setDittoFrameActive(false);
          setAvatarPreparing(false);
        }
        return false;
      }
    };
    if (authentic && avatarMode === "cloud-gpu") return startAuthenticFrameStream().then((started) => (started || !isCurrentTurn() ? started : playSegmentedSpeech()));
    return playSegmentedSpeech();
  }, [avatarMode, muted, notify, selectedVoice, slow, stopSpeaking, volume]);

  useEffect(() => {
    if (!window.kioskBridge?.qaAvatar) return undefined;
    const qaApi = {
      speakReference: (text) => speak(String(text || ""), selectedVoice, { authentic: false }),
      stopSpeech: () => stopSpeaking(),
    };
    window.__XIAOAN_AVATAR_QA__ = qaApi;
    return () => {
      if (window.__XIAOAN_AVATAR_QA__ === qaApi) delete window.__XIAOAN_AVATAR_QA__;
    };
  }, [selectedVoice, speak, stopSpeaking]);

  const openScreen = useCallback((next, announcement) => {
    setScreen(next); setPendingAnswer(null); setClarification(null); setSafetyNotice(null); setTranscript(""); setAiChoices([]);
    if (next === "welcome" || next === "assessment") setSymptomConversation(resetSymptomConversation());
    window.clearTimeout(announcementTimerRef.current);
    if (announcement) announcementTimerRef.current = window.setTimeout(() => speak(announcement), 80);
  }, [speak]);

  const finishDittoIntro = useCallback(() => {
    setDittoIntroActive(false);
    setSpeaking(false);
  }, []);

  const fallbackFromDittoIntro = useCallback(() => {
    setDittoIntroActive(false);
    setSpeaking(false);
  }, []);

  const finishDittoSpeech = useCallback(() => {
    activeSpeechTurnRef.current = "";
    clearDittoSpeechVideo();
    setAvatarPreparing(false);
    setSpeechPreparing(false);
    setSpeaking(false);
  }, [clearDittoSpeechVideo]);

  const handleDittoVideoEnded = useCallback(() => {
    if (dittoIntroActive) finishDittoIntro();
    else finishDittoSpeech();
  }, [dittoIntroActive, finishDittoIntro, finishDittoSpeech]);

  const handleDittoVideoError = useCallback(() => {
    if (dittoIntroActive) fallbackFromDittoIntro();
    else {
      finishDittoSpeech();
      notify("真实嘴型视频播放失败，已保留本地语音模式");
    }
  }, [dittoIntroActive, fallbackFromDittoIntro, finishDittoSpeech, notify]);

  const chooseVoiceAnswer = useCallback((option) => {
    setPendingAnswer(option); setClarification(null); setTranscript(`已听到：${option.label}`);
    speak(`我听到的是，${option.label}，对吗？`);
  }, [speak]);

  const handleText = useCallback(async (rawText, { source = "touch", symptomOption = null } = {}) => {
    const text = String(rawText || "").trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) {
      if (source === "voice") { setTranscript("没有听清，请再说一次"); notify("请再说一次，小安正在继续听", "speech-retry"); }
      return;
    }
    const previousAiRequest = activeAiRequestRef.current;
    if (previousAiRequest) {
      activeAiRequestRef.current = "";
      window.kioskBridge?.cancelDeepSeekChat?.(previousAiRequest);
    }
    setTranscript(text);
    setAiChoices([]);
    if (screen === "assessment" && !pendingAnswer) {
      const localSafety = detectSafetySignal(text);
      if (localSafety) {
        setSafetyNotice(localSafety); setClarification(null); speak(localSafety.message); return;
      }
      const attempts = clarificationAttemptsRef.current[currentQuestion.id] || 0;
      setAssessmentBusy(true); setClarification(null); setSafetyNotice(null);
      let interpretation = null;
      if (aiReady && window.kioskBridge?.interpretAssessment) {
        try {
          const aiResult = await window.kioskBridge.interpretAssessment({
            question: { id: currentQuestion.id, title: currentQuestion.title, type: currentQuestion.type, domain: currentQuestion.skillDomain, options: currentQuestion.options.map(({ id, label }) => ({ id, label })) },
            text,
          });
          if (aiResult?.ok) interpretation = validateInterpretation({ ...aiResult.result, source: "ai" }, currentQuestion);
          else notify(aiResult?.message || "智能理解暂时不可用，已使用本地理解");
        } catch { notify("智能理解暂时不可用，已使用本地理解"); }
      }
      if (!interpretation) interpretation = localInterpretAssessment({ question: currentQuestion, text, clarificationAttempt: attempts });
      setAssessmentBusy(false);
      if (interpretation.safetySignal) {
        setSafetyNotice(interpretation.safetySignal); speak(interpretation.safetySignal.message); return;
      }
      const option = resolveOption(currentQuestion, interpretation.answerId);
      if (option && interpretation.confidence >= .82 && !interpretation.needsClarification) {
        if (source === "voice") chooseVoiceAnswer(option); else submitAnswer(option);
        return;
      }
      clarificationAttemptsRef.current[currentQuestion.id] = attempts + 1;
      const candidates = interpretation.candidates.map((candidate) => resolveOption(currentQuestion, candidate.answerId)).filter(Boolean).slice(0, 2);
      const prompt = attempts >= 1 ? "还是不确定也没关系，请点击最接近的一项。" : interpretation.clarificationPrompt;
      setClarification({ prompt, candidates, showAllOptions: interpretation.confidence < .55 || !candidates.length });
      speak(prompt);
      return;
    }
    const userMessage = { role: "user", text };
    setMessages((items) => [...items.slice(-19), userMessage]);

    if (isExplicitAssessmentRequest(text)) {
      const response = localReply(text, messages);
      setSymptomConversation(resetSymptomConversation());
      window.setTimeout(() => { setQuestionIndex(0); setAnswers([]); openScreen("assessment"); }, 900);
      setMessages((items) => [...items, { role: "assistant", text: response.text }]);
      speak(response.text);
      return;
    }

    let symptomInput = symptomOption
      ? { text, questionId: symptomOption.questionId, optionId: symptomOption.optionId }
      : text;
    let symptomAcknowledgement = "";
    if (symptomConversation?.active && !symptomOption && aiReady && window.kioskBridge?.interpretSymptom) {
      try {
        const interpreted = await window.kioskBridge.interpretSymptom({
          question: symptomConversation.question,
          options: symptomConversation.options,
          text,
          symptom: symptomConversation.symptom,
        });
        if (interpreted?.safetySignal) {
          setSymptomConversation((current) => current ? {
            ...current,
            active: false,
            complete: true,
            type: "safety",
            options: [],
            message: interpreted.safetySignal.message,
          } : current);
          setMessages((items) => [...items, { role: "assistant", text: interpreted.safetySignal.message }]);
          speak(interpreted.safetySignal.message);
          return;
        }
        if (interpreted?.ok && interpreted.optionId) {
          symptomInput = { text, questionId: symptomConversation.question?.id, optionId: interpreted.optionId };
          symptomAcknowledgement = interpreted.acknowledgement || "";
        }
      } catch { notify("智能理解暂时不可用，已使用本地安全规则"); }
    }
    const nextSymptomState = symptomConversation?.active
      ? advanceSymptomConversation(symptomConversation, symptomInput)
      : startSymptomConversation(symptomInput);
    if (nextSymptomState?.handled) {
      setSymptomConversation(nextSymptomState);
      const symptomMessage = symptomAcknowledgement
        ? `${symptomAcknowledgement}${/[。！？]$/.test(symptomAcknowledgement) ? "" : "。"}${nextSymptomState.message}`
        : nextSymptomState.message;
      setMessages((items) => [...items, { role: "assistant", text: symptomMessage }]);
      speak(symptomMessage, undefined, { authentic: shouldUseAuthenticAvatar(nextSymptomState) });
      return;
    }

    const response = localReply(text, messages);
    if (response.action === "assessment") window.setTimeout(() => { setQuestionIndex(0); setAnswers([]); openScreen("assessment"); }, 900);
    if (response.action) { setMessages((items) => [...items, { role: "assistant", text: response.text }]); speak(response.text); return; }
    if (aiReady && (window.kioskBridge?.deepSeekChatStream || window.kioskBridge?.deepSeekChat)) {
      setAiBusy(true);
      try {
        const payload = [...messages, userMessage].map((item) => ({ role: item.role, content: item.text }));
        const context = {
          inputMode: source,
          activeSymptom: symptomConversation?.active ? {
            symptom: symptomConversation.symptom,
            currentQuestionId: symptomConversation.currentQuestionId,
            turnCount: symptomConversation.turnCount,
          } : null,
        };
        if (window.kioskBridge?.deepSeekChatStream) {
          const requestId = `ai-${createSpeechTurnId(speechTicketRef.current)}`;
          activeAiRequestRef.current = requestId;
          const segmenter = createIncrementalSpeechSegmenter();
          let streamedText = "";
          let messageStarted = false;
          let speechChain = Promise.resolve();
          const enqueueSpeech = (segment) => {
            if (!segment) return;
            speechChain = speechChain.then(() => activeAiRequestRef.current === requestId
              ? speak(segment, undefined, { authentic: true, streaming: true })
              : false);
          };
          const aiResponse = await window.kioskBridge.deepSeekChatStream({
            requestId,
            messages: payload,
            context,
          }, (event) => {
            if (event?.type !== "delta" || activeAiRequestRef.current !== requestId) return;
            streamedText = String(event.text || `${streamedText}${event.delta || ""}`);
            if (!messageStarted) {
              messageStarted = true;
              setMessages((items) => [...items, { role: "assistant", text: streamedText, streamId: requestId }]);
            } else {
              setMessages((items) => items.map((item) => item.streamId === requestId ? { ...item, text: streamedText } : item));
            }
            for (const segment of segmenter.push(event.delta)) enqueueSpeech(segment);
          });
          for (const segment of segmenter.flush()) enqueueSpeech(segment);
          if (aiResponse?.cancelled) return;
          if (aiResponse?.ok) {
            setAiChoices(Array.isArray(aiResponse.options) ? aiResponse.options : []);
            if (!messageStarted) setMessages((items) => [...items, { role: "assistant", text: aiResponse.text, streamId: requestId }]);
            else setMessages((items) => items.map((item) => item.streamId === requestId ? { role: "assistant", text: aiResponse.text } : item));
            if (!streamedText && aiResponse.text) enqueueSpeech(aiResponse.text);
            await speechChain;
            if (activeAiRequestRef.current === requestId) activeAiRequestRef.current = "";
            return;
          }
          if (activeAiRequestRef.current === requestId) activeAiRequestRef.current = "";
          notify(aiResponse?.message || "AI 服务暂时不可用，已切换本地对话");
        } else {
          const aiResponse = await window.kioskBridge.deepSeekChat({
          messages: payload,
            context,
          });
          if (aiResponse?.ok) {
            setAiChoices(Array.isArray(aiResponse.options) ? aiResponse.options : []);
            setMessages((items) => [...items, { role: "assistant", text: aiResponse.text }]);
            await speak(aiResponse.text, undefined, { authentic: true, streaming: true });
            return;
          }
          notify(aiResponse?.message || "AI 服务暂时不可用，已切换本地对话");
        }
      } catch { notify("智能对话暂时不可用，已切换本地健康助手"); }
      finally { setAiBusy(false); }
    }
    const fallbackText = aiReady
      ? "智能对话暂时不可用，刚才的回答还没有被智能处理，请稍后再说一次。"
      : response.text;
    setMessages((items) => [...items, { role: "assistant", text: fallbackText }]); speak(fallbackText, undefined, { authentic: true, streaming: true });
  }, [aiReady, chooseVoiceAnswer, currentQuestion, messages, notify, openScreen, pendingAnswer, screen, speak, symptomConversation]);

  const stopListening = useCallback(() => {
    listeningSessionRef.current += 1;
    listeningOperationRef.current = false;
    recordingAbortRef.current?.abort();
    recordingAbortRef.current = null;
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(async ({ automatic = false } = {}) => {
    if (automatic && !autoListenAllowedRef.current) return;
    if (listeningOperationRef.current || recognizing) return;
    listeningOperationRef.current = true;
    const session = listeningSessionRef.current + 1;
    listeningSessionRef.current = session;
    const activeAiRequest = activeAiRequestRef.current;
    if (activeAiRequest) {
      activeAiRequestRef.current = "";
      window.kioskBridge?.cancelDeepSeekChat?.(activeAiRequest);
    }
    stopSpeaking(); setTranscript("请开始说话，说完后小安会自动识别"); setListening(true); setRecognizing(false);
    try {
      if (hasNativeRecognition) {
        const controller = new AbortController();
        const previewState = { active: true };
        recordingAbortRef.current = controller;
        let recording;
        try {
          recording = await recordSpeech({
            maxDurationMs: screen === "talk" ? 45000 : 12000,
            maxIdleMs: screen === "talk" ? 12000 : 8000,
            signal: controller.signal,
            onReady: () => setTranscript("麦克风已开启，请说话"),
            onSpeechStart: () => { setToast(null); setTranscript("已经听到，您说完后会自动识别"); },
            onPreview: window.kioskBridge?.recognizePreviewPcm ? async ({ samples, sampleRate }) => {
              const preview = await window.kioskBridge.recognizePreviewPcm(samples, sampleRate);
              if (previewState.active && session === listeningSessionRef.current && preview?.ok && preview.text) setTranscript(`正在听：${preview.text}`);
            } : undefined,
          });
        } finally {
          previewState.active = false;
        }
        recordingAbortRef.current = null;
        if (controller.signal.aborted || session !== listeningSessionRef.current) return;
        if (!recording.heardSpeech) { autoListenDelayRef.current = 900; setTranscript("没有听到声音，小安会继续聆听"); return; }
        setListening(false); setRecognizing(true); setTranscript("正在识别您刚才说的内容…");
        const resultText = await window.kioskBridge.recognizePcm(recording.samples, recording.sampleRate);
        if (session !== listeningSessionRef.current) return;
        if (resultText?.ok && resultText.text) { autoListenDelayRef.current = 280; await handleText(resultText.text, { source: "voice" }); }
        else { autoListenDelayRef.current = 900; setTranscript("没有听清，小安会继续聆听"); notify("请再说一次，小安正在继续听", "speech-retry"); }
        return;
      }
      if (hasLocalWebRecognition) {
        const controller = new AbortController();
        recordingAbortRef.current = controller;
        const recording = await recordSpeech({
          maxDurationMs: screen === "talk" ? 45000 : 12000,
          maxIdleMs: screen === "talk" ? 12000 : 8000,
          signal: controller.signal,
          onReady: () => setTranscript("麦克风已开启，请说话"),
          onSpeechStart: () => { setToast(null); setTranscript("已经听到，您说完后会自动识别"); },
        });
        recordingAbortRef.current = null;
        if (controller.signal.aborted || session !== listeningSessionRef.current) return;
        if (!recording.heardSpeech) { autoListenDelayRef.current = 900; setTranscript("没有听到声音，小安会继续聆听"); return; }
        setListening(false); setRecognizing(true); setTranscript("正在识别您刚才说的内容…");
        const response = await fetch("/api/speech/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: recording.samples.buffer,
        });
        const resultText = await response.json();
        if (session !== listeningSessionRef.current) return;
        if (resultText?.ok && resultText.text) { autoListenDelayRef.current = 280; await handleText(resultText.text, { source: "voice" }); }
        else { autoListenDelayRef.current = 900; setTranscript("没有听清，小安会继续聆听"); notify("请再说一次，小安正在继续听", "speech-retry"); }
        return;
      }
      if (hasWebRecognition) {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        await new Promise((resolve) => {
          const recognition = new Recognition();
          let receivedResult = false;
          let settled = false;
          const finish = () => { if (settled) return; settled = true; resolve(); };
          recognition.lang = "zh-CN"; recognition.continuous = false; recognition.interimResults = true;
          recognition.onspeechstart = () => { setToast(null); setTranscript("已经听到，请继续说"); };
          recognition.onresult = async (event) => {
            if (session !== listeningSessionRef.current) { finish(); return; }
            let interimText = "";
            let finalText = "";
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
              const candidate = event.results[index]?.[0]?.transcript || "";
              if (event.results[index].isFinal) finalText += candidate;
              else interimText += candidate;
            }
            if (!finalText) {
              if (interimText.trim()) setTranscript(`正在听：${interimText.trim()}`);
              return;
            }
            receivedResult = true;
            setListening(false); setRecognizing(true); setTranscript("正在识别您刚才说的内容…");
            try {
              if (session === listeningSessionRef.current) {
                autoListenDelayRef.current = 280;
                await handleText(finalText, { source: "voice" });
              }
            } finally { finish(); }
          };
          recognition.onerror = (event) => {
            if (session !== listeningSessionRef.current) { finish(); return; }
            if (event?.error === "aborted") { finish(); return; }
            autoListenDelayRef.current = 1200;
            setTranscript("没有听清，小安会继续聆听"); notify("请再说一次，小安正在继续听", "speech-retry"); finish();
          };
          recognition.onend = () => {
            recognitionRef.current = null;
            if (session !== listeningSessionRef.current) { finish(); return; }
            if (!receivedResult) { autoListenDelayRef.current = 900; setTranscript("小安会继续聆听，请直接说话"); finish(); }
          };
          recognition.onnomatch = () => { if (session !== listeningSessionRef.current) { finish(); return; } autoListenDelayRef.current = 900; setTranscript("没有听到清晰文字，小安会继续聆听"); notify("请再说一次，小安正在继续听", "speech-retry"); finish(); };
          recognition.onstart = () => setListening(true);
          recognition.onspeechend = () => { setListening(false); setRecognizing(true); };
          recognitionRef.current = recognition;
          recognition.start();
        });
        return;
      }
      setTranscript("当前设备未启用语音识别，请点击文字继续"); notify("当前设备未启用语音识别，请点击下方文字体验对话");
    } catch (error) {
      autoListenDelayRef.current = 1200;
      const message = error?.message || "麦克风暂时不可用，请检查权限后重试";
      setTranscript(message); notify(message);
    }
    finally {
      if (session === listeningSessionRef.current) {
        listeningOperationRef.current = false;
        setListening(false); setRecognizing(false);
      }
    }
  }, [handleText, hasLocalWebRecognition, hasNativeRecognition, hasWebRecognition, notify, recognizing, screen, stopSpeaking]);

  const toggleListening = useCallback(() => {
    if (recognizing) return;
    if (listening) stopListening(); else startListening();
  }, [listening, recognizing, startListening, stopListening]);

  const beginVoiceConversation = () => openScreen("talk", "您好，我是小安。您可以直接说出您的健康问题，我会认真听。");

  const saveApiKey = async () => {
    try {
      const saved = await window.kioskBridge?.saveDeepSeekKey?.(keyDraft);
      if (!saved?.ok) throw new Error("保存失败");
      setAiReady(true); setShowKeySetup(false); setKeyDraft(""); notify("DeepSeek 已安全连接");
    } catch (error) { notify(error?.message || "密钥格式不正确，请重新输入"); }
  };

  const confirmAnswer = () => {
    const next = advanceAssessment({ questions, questionIndex, answers, option: pendingAnswer });
    setAnswers(next.answers); setPendingAnswer(null); setClarification(null); setTranscript("");
    if (next.complete) {
      setScreen("analyzing"); speak("回答已经记录好了，我正在整理结果，请稍等。");
      window.setTimeout(() => setScreen("result"), 1900);
    } else setQuestionIndex(next.questionIndex);
  };

  const submitAnswer = (option) => {
    const next = advanceAssessment({ questions, questionIndex, answers, option });
    setAnswers(next.answers); setPendingAnswer(null); setClarification(null); setSafetyNotice(null); setTranscript("");
    if (next.complete) {
      setScreen("analyzing"); speak("回答已经记录好了，我正在整理结果，请稍等。");
      window.setTimeout(() => setScreen("result"), 1900);
    } else setQuestionIndex(next.questionIndex);
  };

  const goBack = () => {
    if (screen === "assessment" && pendingAnswer) { setPendingAnswer(null); return; }
    if (screen === "assessment" && questionIndex > 0) { setQuestionIndex((index) => index - 1); return; }
    const nextScreen = screen === "plan" || screen === "result" ? "talk" : "welcome";
    if (nextScreen === "welcome") setSymptomConversation(resetSymptomConversation());
    setScreen(nextScreen);
  };

  useEffect(() => {
    setShowVolumeControl(false);
  }, [screen]);

  useEffect(() => {
    window.kioskBridge?.deepSeekStatus?.().then((status) => setAiReady(Boolean(status?.configured))).catch(() => {});
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(announcementTimerRef.current);
      window.clearTimeout(autoListenTimerRef.current);
      if (activeAiRequestRef.current) window.kioskBridge?.cancelDeepSeekChat?.(activeAiRequestRef.current);
      activeAiRequestRef.current = "";
      stopSpeaking();
      stopListening();
      audioContextRef.current?.close?.();
    };
  }, [stopListening, stopSpeaking]);

  const startAssessment = () => {
    clarificationAttemptsRef.current = {};
    setSymptomConversation(resetSymptomConversation());
    setQuestionIndex(0);
    setAnswers([]);
    stopSpeaking();
    openScreen("assessment");
    setDittoIntroActive(false);
  };

  useEffect(() => {
    if (screen !== "assessment" || questionIndex === 0 || pendingAnswer) return undefined;
    const timer = window.setTimeout(() => speak(currentQuestion.title), 180);
    return () => window.clearTimeout(timer);
  }, [currentQuestion.title, pendingAnswer, questionIndex, screen, speak]);

  useEffect(() => {
    if (screen !== "result") return undefined;
    const resultSpeech = result.level === "attention"
      ? "有几项情况需要多关注。建议记录变化，并在需要时咨询专业医务人员。"
      : "整体情况比较平稳。继续保持规律作息、适量活动和按时服药。";
    const timer = window.setTimeout(() => speak(resultSpeech), 180);
    return () => window.clearTimeout(timer);
  }, [result.level, screen, speak]);

  useEffect(() => {
    const stream = chatStreamRef.current;
    if (!stream) return undefined;
    const moveToLatest = () => { stream.scrollTop = stream.scrollHeight; };
    const frame = window.requestAnimationFrame(moveToLatest);
    const settleTimer = window.setTimeout(moveToLatest, 90);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(settleTimer); };
  }, [aiBusy, messages]);

  useEffect(() => {
    const stream = chatStreamRef.current;
    if (screen !== "talk" || !stream || !("ResizeObserver" in window)) return undefined;
    const observer = new ResizeObserver(() => { stream.scrollTop = stream.scrollHeight; });
    observer.observe(stream);
    return () => observer.disconnect();
  }, [screen]);

  const requestAutoListen = useCallback(() => {
    if (!autoListenAllowedRef.current) return;
    window.clearTimeout(autoListenTimerRef.current);
    const delay = autoListenDelayRef.current;
    autoListenDelayRef.current = 280;
    autoListenTimerRef.current = window.setTimeout(() => {
      startListening({ automatic: true });
    }, delay);
  }, [startListening]);

  useEffect(() => {
    if (screen !== "talk") return undefined;
    requestAutoListen();
    return () => {
      window.clearTimeout(autoListenTimerRef.current);
    };
  }, [autoListenAllowed, requestAutoListen, screen]);

  const handleForeheadTap = (trigger) => {
    const now = Date.now();
    const recentTaps = [...foreheadTapsRef.current.filter((time) => now - time <= 5000), now];
    foreheadTapsRef.current = recentTaps;
    if (trigger) trigger.dataset.adminTapCount = String(Math.min(recentTaps.length, 5));
    if (recentTaps.length < 5) return;
    foreheadTapsRef.current = [];
    if (trigger) trigger.dataset.adminTapCount = "0";
    stopListening();
    speak("您好，我是小安。口型试听：啊啊，诶诶，哦哦，呜呜。我会陪您一起做好日常健康管理。", selectedVoice, { authentic: false });
  };

  const handleQuickPrompt = (prompt) => {
    stopListening();
    handleText(prompt);
  };

  const WelcomePanel = () => <section className="welcome-panel panel-enter">
    <div className="welcome-copy"><p>您好，我是小安</p><h1>今天想聊聊您的健康吗？</h1></div>
    <button className={`welcome-voice ${listening ? "is-listening" : ""}`} onClick={beginVoiceConversation} aria-label="进入健康对话">
      <span className="welcome-voice__mic"><Microphone weight="fill"/></span>
      <span className="welcome-action-copy"><strong>直接和小安说话</strong><small>进入后自动聆听，无需操作麦克风</small></span>
      <span className="welcome-voice__wave" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <i key={index}/>)}</span>
    </button>
    <button className="welcome-assessment" onClick={startAssessment}><ClipboardText weight="regular"/><span className="welcome-action-copy"><strong>开始健康测评</strong><small>8个简单问题，支持说话或点击</small></span><ArrowRight/></button>
  </section>;

  const TalkPanel = () => <section className="talk-panel panel-enter">
    <VoiceControl listening={listening} recognizing={recognizing} speaking={speaking} supported={recognitionSupported} onClick={toggleListening} automatic transcript={transcript}/>
    {toast?.kind === "speech-retry" && <ToastNotice notice={toast} inline/>}
    <div ref={chatStreamRef} className="chat-stream" role="log" tabIndex={0} aria-label="与小安的历史对话，可上下滑动查看" aria-live="polite">{messages.map((message, index) => <article className={`message message--${message.role}`} key={`${message.role}-${index}`}>
      <span className="message__label">{message.role === "assistant" ? <><Waveform weight="bold"/>小安的回答</> : "您刚才说"}</span>
      <p>{message.text}</p>
    </article>)}{aiBusy && <div className="message message--assistant typing"><i/><i/><i/>小安正在整理回答</div>}</div>
    {symptomConversation?.active && symptomConversation.options?.length > 0
      ? <div className="symptom-choice-section" aria-label="当前症状问题的可选回答"><p>可直接点选，也可以继续说</p><div className="symptom-choice-grid">{symptomConversation.options.map((option) => <button key={option.id} onClick={() => handleText(option.label, { source: "touch", symptomOption: { questionId: symptomConversation.question?.id, optionId: option.id } })}><span>{option.label}</span><ArrowRight weight="bold"/></button>)}</div></div>
      : aiChoices.length > 0
        ? <div className="symptom-choice-section" aria-label="小安提供的可选回答"><p>可以直接说，也可以点选</p><div className="symptom-choice-grid">{aiChoices.map((option) => <button key={option.id} onClick={() => handleText(option.label, { source: "touch" })}><span>{option.label}</span><ArrowRight weight="bold"/></button>)}</div></div>
        : <div className="prompt-section"><p>也可以选择常见问题</p><div className="prompt-row">{quickPrompts.map((prompt) => <button key={prompt} onClick={() => handleQuickPrompt(prompt)}><PaperPlaneTilt weight="bold"/>{prompt}<ArrowRight/></button>)}</div></div>}
  </section>;

  const AssessmentPanel = () => <section className="assessment-panel panel-enter">
    <div className="progress-head"><button onClick={goBack} aria-label="返回"><ArrowLeft/></button><div><span style={{ transform: `scaleX(${(questionIndex + 1) / questions.length})` }}/></div><strong>{questionIndex + 1}/{questions.length}</strong></div>
    <p className="section-kicker">健康测评</p><h1>{currentQuestion.title}</h1><p className="section-hint">{currentQuestion.hint}</p>
    {assessmentBusy && <div className="assessment-status" role="status"><Waveform weight="bold"/><div><strong>小安正在理解您的回答</strong><small>请稍等一下</small></div></div>}
    {safetyNotice && <div className="safety-card" role="alert"><ShieldCheck weight="fill"/><div><strong>请先关注当前情况</strong><p>{safetyNotice.message}</p><button className="secondary-action" onClick={() => setSafetyNotice(null)}>返回本题</button></div></div>}
    {!assessmentBusy && !safetyNotice && !pendingAnswer && clarification && <div className="clarification-card"><p>{clarification.prompt}</p>{clarification.candidates.length > 0 && <div className="candidate-grid">{clarification.candidates.map((option) => <button key={option.id} onClick={() => submitAnswer(option)}><CheckCircle/><strong>{option.label}</strong><ArrowRight/></button>)}</div>}{clarification.showAllOptions && <small>也可以直接点击下面最接近的答案</small>}</div>}
    {!assessmentBusy && !safetyNotice && !pendingAnswer && (!clarification || clarification.showAllOptions) && <div className="answer-grid">{currentQuestion.options.map((option, index) => <button key={option.id} onClick={() => submitAnswer(option)}><span>{index + 1}</span><strong>{option.label}</strong><ArrowRight/></button>)}</div>}
    {!assessmentBusy && !safetyNotice && pendingAnswer && <div className="confirm-card"><Waveform weight="bold"/><p>请确认刚才的语音内容</p><h2>{pendingAnswer.label}</h2><div><button className="primary-action" onClick={confirmAnswer}><Check/>对，继续</button><button className="secondary-action" onClick={() => setPendingAnswer(null)}>重新回答</button></div></div>}
    {!assessmentBusy && !safetyNotice && !pendingAnswer && <><VoiceControl listening={listening} recognizing={recognizing} speaking={speaking} supported={recognitionSupported} onClick={toggleListening} compact/><SpeechTranscript transcript={transcript} listening={listening} recognizing={recognizing}/></>}
  </section>;

  const ResultPanel = () => <section className="result-panel panel-enter">
    <p className="section-kicker">测评完成</p><div className={`result-title ${result.level === "attention" ? "is-attention" : ""}`}><CheckCircle weight="fill"/><div><small>本次健康管理建议</small><h1>{result.level === "attention" ? "重点关注" : "日常管理"}</h1></div></div>
    <div className="result-focus"><strong>{result.focusTitle}</strong><small>计划根据您刚才的回答生成，不作为疾病诊断</small></div>
    <div className="insight-list">{result.insights.map((insight) => { const InsightIcon = ["mobility", "exercise"].includes(insight.domain) ? PersonSimpleWalk : Heartbeat; return <div key={insight.id}><InsightIcon/><span><strong>{insight.text}</strong><small>{insight.detail}</small></span></div>; })}</div>
    <button className="primary-action wide" onClick={() => openScreen("plan", "我为您整理了三件容易做到的小事。")}>查看我的健康计划<ArrowRight/></button>
  </section>;

  const PlanPanel = () => <section className="plan-panel panel-enter"><p className="section-kicker">根据您的回答生成</p><h1>今天先做好三件小事</h1><div className="plan-steps">{result.actions.map((action, index) => <div key={action.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{action.text}</strong><small>{action.tracking}</small></div><Check/></div>)}</div><p className="plan-boundary">计划用于日常健康管理，不替代已有医嘱。</p><button className="primary-action wide" onClick={() => openScreen("talk", "计划已经为您准备好了，您还想了解什么？")}>完成，继续和小安聊聊</button></section>;

  return <div className={`kiosk-shell ${window.kioskBridge ? "runtime-electron" : "runtime-web"} ${largeText ? "large-text" : ""} screen-${screen}`}>
    <div className="portrait-stage" aria-label="数字健康管理师小安">
      <DigitalHuman speaking={speaking} analyserRef={speechAnalyserRef} visemeTimelineRef={speechVisemeTimelineRef} videoActive={(screen === "welcome" || screen === "talk") && (dittoIntroActive || dittoSpeechActive)} videoSrc={dittoSpeechActive ? dittoSpeechSrc : "./assets/xiaoa-ditto-welcome-v1.mp4"} frameActive={screen === "talk" && dittoFrameActive} frameSinkRef={dittoFrameSinkRef} volume={volume} slow={slow} mood={avatarExpression} avatarMode={avatarMode} onVideoEnded={handleDittoVideoEnded} onVideoError={handleDittoVideoError}/>
      <button className="forehead-admin-trigger" type="button" data-admin-tap-count="0" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); handleForeheadTap(event.currentTarget); }} onContextMenu={(event) => event.preventDefault()} tabIndex={-1} aria-label="管理员入口五连击"/>
      <div className="stage-glow"/><div className={`voice-aura ${speaking || listening ? "is-active" : ""}`} aria-hidden="true"><i/><i/><i/></div>
      <header className="topbar">
        <div className="brand"><span><Waveform weight="bold"/></span><div><strong>康养智能健康空间 <b className="app-version">{appVersion}</b></strong><small>AI HEALTH COMPANION</small></div></div>
        <div className="topbar-actions">
          {screen === "talk" && <button type="button" className="topbar-home" onClick={() => { stopListening(); openScreen("welcome"); }} aria-label="返回主页"><HouseLine weight="bold"/><span>主页</span></button>}
          <div className="top-control-cluster" role="group" aria-label="常用设置">
            <TopControlButton icon={muted ? SpeakerSimpleSlash : SpeakerSimpleHigh} label="音量" detail={muted ? "静音" : `${volume}%`} active={showVolumeControl} onClick={() => setShowVolumeControl((value) => !value)} aria-expanded={showVolumeControl} aria-controls="volume-control-panel"/>
            <TopControlButton icon={TextAa} label="大字" detail={largeText ? "已放大" : "标准"} active={largeText} onClick={() => setLargeText((value) => !value)}/>
            <TopControlButton icon={Speedometer} label="慢速" detail={slow ? "已开启" : "正常"} active={slow} onClick={() => setSlow((value) => !value)}/>
            <TopControlButton icon={GearSix} label="设置" detail={avatarMode === "local" ? "本地" : "云GPU"} active={showAvatarSettings} onClick={() => { setShowVolumeControl(false); setShowAvatarSettings(true); }} aria-expanded={showAvatarSettings} aria-controls="avatar-settings-dialog"/>
          </div>
          {!aiReady && <button type="button" className="online" onClick={() => window.kioskBridge?.deepSeekStatus ? setShowKeySetup(true) : notify("请在桌面版配置智能对话")} aria-label="小安未配置，请在桌面版连接智能对话"><i/>连接</button>}
        </div>
      </header>
      {showVolumeControl && <div id="volume-control-panel" className="volume-panel" role="group" aria-label="音量调节">
        <div className="volume-panel__head"><strong>音量调节</strong><output aria-live="polite">{muted ? "静音" : `${volume}%`}</output></div>
        <div className="volume-panel__controls">
          <button type="button" onClick={() => updateVolume(volume - 10)} disabled={volume === 0} aria-label="降低音量"><Minus weight="bold"/></button>
          <input type="range" min="0" max="100" step="10" value={volume} onChange={(event) => updateVolume(event.target.value)} aria-label="小安说话音量" aria-valuetext={muted ? "静音" : `${volume}%`}/>
          <button type="button" onClick={() => updateVolume(volume + 10)} disabled={volume === 100} aria-label="提高音量"><Plus weight="bold"/></button>
        </div>
      </div>}
      {speechPreparing && <div className="speaking-indicator is-preparing" role="status"><Waveform/>{avatarPreparing ? "正在连接实时嘴型" : "正在准备声音"}</div>}
      {speaking && <div className="speaking-indicator" role="status"><Waveform/>小安正在说话</div>}
    </div>
    <main className="content-layer">
      {screen === "welcome" && WelcomePanel()}{screen === "talk" && TalkPanel()}{screen === "assessment" && AssessmentPanel()}{screen === "analyzing" && <section className="analyzing-panel"><div className="analysis-orb"><Waveform weight="bold"/><i/><i/></div><p>测评已经完成</p><h1>正在整理您的结果</h1><small>只需要几秒钟</small></section>}{screen === "result" && ResultPanel()}{screen === "plan" && PlanPanel()}
    </main>
    {toast && !(screen === "talk" && toast.kind === "speech-retry") && <ToastNotice notice={toast}/>}
    {showKeySetup && <div className="setup-scrim" role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-help"><form ref={keyDialogRef} className="setup-card" onSubmit={(event) => { event.preventDefault(); saveApiKey(); }}>
      <div className="setup-icon"><CloudCheck weight="duotone"/></div><p>管理员设置</p><h2 id="setup-title">连接 DeepSeek 智能对话</h2><small id="setup-help"><LockKey weight="fill"/>密钥将使用 Windows 当前用户加密保存，不会写入安装包。</small>
      <label htmlFor="api-key"><Key/>DeepSeek API Key</label><input ref={keyInputRef} id="api-key" type="password" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="粘贴新的 sk-... 密钥" autoComplete="off"/>
      <button className="primary-action wide" type="submit" disabled={!keyDraft.trim()}>安全保存并开始对话</button><button className="secondary-action wide" type="button" onClick={() => setShowKeySetup(false)}>先体验本地对话</button>
    </form></div>}
    {showAvatarSettings && <div className="setup-scrim" role="dialog" aria-modal="true" aria-labelledby="avatar-settings-title" aria-describedby="avatar-settings-help"><section ref={avatarSettingsDialogRef} id="avatar-settings-dialog" className="setup-card avatar-settings-card">
      <div className="setup-icon"><GearSix weight="duotone"/></div><p>数字人设置</p><h2 id="avatar-settings-title">选择口型运行方式</h2><small id="avatar-settings-help">本地模式已启用；云GPU入口为后续接入预留。</small>
      <div className="avatar-mode-options" role="radiogroup" aria-label="口型运行方式">
        <button ref={avatarSettingsLocalRef} type="button" role="radio" aria-checked={avatarMode === "local"} className={`avatar-mode-option ${avatarMode === "local" ? "is-selected" : ""}`} onClick={() => chooseAvatarMode("local")}>
          <span className="avatar-mode-option__icon"><Waveform weight="bold"/></span><span><strong>本地</strong><small>单嘴唇与下巴特征 · 默认</small></span><i><Check weight="bold"/></i>
        </button>
        <button type="button" role="radio" aria-checked="false" className="avatar-mode-option is-disabled" disabled aria-describedby="cloud-gpu-status">
          <span className="avatar-mode-option__icon"><CloudCheck weight="bold"/></span><span><strong>云GPU</strong><small id="cloud-gpu-status">后续接入</small></span><em>未开放</em>
        </button>
      </div>
      <button className="secondary-action wide" type="button" onClick={closeAvatarSettings}>关闭</button>
    </section></div>}
  </div>;
}
