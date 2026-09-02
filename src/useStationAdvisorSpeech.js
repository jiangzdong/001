import { useCallback, useEffect, useRef, useState } from "react";
import { createSpeechProsodyTimeline, inferSpeechMood } from "./avatarMotion.js";
import { createSpeechChunkQueue, createSpeechTurnId, splitSpeechSegments } from "./streamingSpeech.js";

const defaultVoiceId = "zh-ll-2";
const nativeSpeechOutputGain = 2.8;

function recordSpeechQaEvent(type, details = {}) {
  if (!window.kioskBridge?.qaAvatar) return;
  const events = Array.isArray(window.__XIAOAN_SPEECH_QA_EVENTS__)
    ? window.__XIAOAN_SPEECH_QA_EVENTS__
    : [];
  events.push({ at: performance.now(), type, ...details });
  if (events.length > 256) events.splice(0, events.length - 256);
  window.__XIAOAN_SPEECH_QA_EVENTS__ = events;
}

async function synthesizeWithLocalApi(text, options, signal) {
  const response = await fetch("/api/speech/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({ text, ...options }),
    signal,
  });
  if (!String(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("本地语音合成接口未就绪");
  }
  const result = await response.json();
  if (!response.ok || !result?.ok) throw new Error(result?.message || "本地语音合成暂时不可用");
  return result;
}

export function useStationAdvisorSpeech({ muted = false, slow = false, volume = 80 } = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [mood, setMood] = useState("neutral");
  const [speechError, setSpeechError] = useState("");
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioGainRef = useRef(null);
  const analyserRef = useRef(null);
  const visemeTimelineRef = useRef(null);
  const utteranceRef = useRef(null);
  const fetchAbortControllersRef = useRef(new Set());
  const ticketRef = useRef(0);
  const activeTurnRef = useRef("");

  const stop = useCallback(() => {
    const activeTurn = activeTurnRef.current;
    activeTurnRef.current = "";
    ticketRef.current += 1;
    if (activeTurn) window.kioskBridge?.cancelSpeechTurn?.(activeTurn);
    window.speechSynthesis?.cancel();
    for (const controller of fetchAbortControllersRef.current) controller.abort();
    fetchAbortControllersRef.current.clear();
    utteranceRef.current = null;
    try { audioSourceRef.current?.stop(); } catch {}
    audioSourceRef.current = null;
    audioGainRef.current = null;
    analyserRef.current = null;
    visemeTimelineRef.current = null;
    recordSpeechQaEvent("stop", { activeTurn: Boolean(activeTurn) });
    setPreparing(false);
    setSpeaking(false);
    setMood("neutral");
  }, []);

  const speak = useCallback((value) => {
    const text = String(value || "").trim();
    if (!text || muted) return Promise.resolve(false);

    stop();
    setSpeechError("");
    const ticket = ticketRef.current;
    const turnId = createSpeechTurnId(ticket);
    activeTurnRef.current = turnId;
    recordSpeechQaEvent("turn-start");
    const isCurrentTurn = () => ticket === ticketRef.current && activeTurnRef.current === turnId;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !audioContextRef.current) {
      try { audioContextRef.current = new AudioContextClass(); } catch { audioContextRef.current = null; }
    }

    const playBrowserSegment = (segment) => new Promise((resolve) => {
      if (!isCurrentTurn() || !("speechSynthesis" in window)) { resolve(false); return; }
      const utterance = new SpeechSynthesisUtterance(segment);
      utterance.lang = "zh-CN";
      utterance.rate = slow ? 0.72 : 0.9;
      utterance.pitch = 1.02;
      utterance.volume = Math.min(1, Math.max(0, volume / 100));
      utteranceRef.current = utterance;
      const finish = () => {
        if (utteranceRef.current === utterance) utteranceRef.current = null;
        if (isCurrentTurn()) setSpeaking(false);
        resolve(isCurrentTurn());
      };
      utterance.onstart = () => {
        if (!isCurrentTurn()) return;
        setPreparing(false);
        setSpeaking(true);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });

    const playNativeSegment = async (result, segment, { retainSpeaking = false } = {}) => {
      if (!isCurrentTurn() || !result?.ok || !result.samples?.length || !result.sampleRate || !AudioContextClass) return false;
      let context;
      try {
        context = audioContextRef.current || new AudioContextClass();
        audioContextRef.current = context;
        if (context.state === "suspended") {
          let resumeTimer;
          await Promise.race([
            context.resume(),
            new Promise((_, reject) => {
              resumeTimer = window.setTimeout(() => reject(new Error("音频输出未获准启动")), 1200);
            }),
          ]).finally(() => window.clearTimeout(resumeTimer));
        }
        if (context.state && context.state !== "running") return false;
      } catch {
        return false;
      }
      if (!isCurrentTurn()) return false;
      const samples = result.samples instanceof Float32Array ? result.samples : Float32Array.from(result.samples);
      recordSpeechQaEvent("buffer-create-start", {
        chunkIndex: Number(result.chunkIndex) || 0,
        sampleCount: samples.length,
        sampleRate: Number(result.sampleRate),
      });
      const buffer = context.createBuffer(1, samples.length, Number(result.sampleRate));
      buffer.copyToChannel(samples, 0);
      recordSpeechQaEvent("buffer-create-end", {
        chunkIndex: Number(result.chunkIndex) || 0,
        durationMs: Number((buffer.duration * 1000).toFixed(2)),
      });
      const source = context.createBufferSource();
      const analyser = context.createAnalyser();
      const gain = context.createGain();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.42;
      const startAtContext = context.currentTime + 0.018;
      gain.gain.setValueAtTime((volume / 100) * nativeSpeechOutputGain, context.currentTime);
      source.buffer = buffer;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      audioSourceRef.current = source;
      audioGainRef.current = gain;
      analyserRef.current = analyser;
      visemeTimelineRef.current = {
        visemes: result.visemes || [],
        alignment: result.alignment || null,
        prosody: createSpeechProsodyTimeline(segment, buffer.duration * 1000),
        audioContext: context,
        startedAtContext: startAtContext,
        startedAtPerformance: performance.now() + 18,
        durationMs: buffer.duration * 1000,
      };
      setMood(inferSpeechMood(segment));
      setPreparing(false);
      setSpeaking(true);
      recordSpeechQaEvent("play-start", {
        chunkIndex: Number(result.chunkIndex) || 0,
        durationMs: Number((buffer.duration * 1000).toFixed(2)),
      });
      return new Promise((resolve) => {
        let settled = false;
        const finish = (completed) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(watchdog);
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
            audioGainRef.current = null;
            analyserRef.current = null;
            visemeTimelineRef.current = null;
          }
          if (isCurrentTurn()) {
            const keepSpeaking = typeof retainSpeaking === "function" ? retainSpeaking() : Boolean(retainSpeaking);
            setSpeaking(keepSpeaking);
            setPreparing(!keepSpeaking);
          }
          recordSpeechQaEvent("play-end", {
            chunkIndex: Number(result.chunkIndex) || 0,
            completed: Boolean(completed),
          });
          resolve(Boolean(completed && isCurrentTurn()));
        };
        const watchdog = window.setTimeout(() => {
          source.onended = null;
          finish(false);
          try { source.stop(); } catch {}
        }, Math.max(2500, buffer.duration * 1000 + 1800));
        source.onended = () => finish(true);
        try { source.start(startAtContext); } catch { finish(false); }
      });
    };

    const prepareSegment = (segment, index) => {
      const options = {
        speed: slow ? 0.68 : 0.78,
        voiceId: defaultVoiceId,
        turnId,
      };
      if (window.kioskBridge?.synthesizeSpeechStream) {
        const queue = createSpeechChunkQueue();
        const streamId = `${turnId}-${index}`;
        const promise = window.kioskBridge.synthesizeSpeechStream(segment, { ...options, streamId }, (event) => {
          if (isCurrentTurn() && event?.type === "chunk" && event.samples?.length) {
            recordSpeechQaEvent("chunk-received", {
              chunkIndex: Number(event.chunkIndex) || 0,
              sampleCount: Number(event.samples.length) || 0,
              sampleRate: Number(event.sampleRate) || 0,
              generatedAtMs: Number(event.generatedAtMs) || 0,
            });
            queue.push(event);
          }
        }).then((result) => {
          recordSpeechQaEvent("stream-complete", {
            ok: Boolean(result?.ok),
            chunkCount: Number(result?.chunkCount) || 0,
            firstChunkMs: Number(result?.firstChunkMs) || 0,
          });
          queue.close();
          return result;
        }).catch((error) => {
          queue.fail(error);
          return { ok: false, message: error?.message || "本地流式语音合成暂时不可用" };
        });
        return { mode: "stream", segment, queue, promise };
      }
      if (window.kioskBridge?.synthesizeSpeech) {
        return {
          mode: "complete",
          segment,
          promise: window.kioskBridge.synthesizeSpeech(segment, options)
            .catch((error) => ({ ok: false, message: error?.message || "本地语音合成暂时不可用" })),
        };
      }
      const controller = new AbortController();
      fetchAbortControllersRef.current.add(controller);
      return {
        mode: "complete",
        segment,
        promise: synthesizeWithLocalApi(segment, options, controller.signal)
          .catch((error) => ({
            ok: false,
            cancelled: error?.name === "AbortError",
            message: error?.name === "AbortError" ? "语音请求已取消" : error?.message || "本地语音合成暂时不可用",
          }))
          .finally(() => fetchAbortControllersRef.current.delete(controller)),
      };
    };

    const playPreparedSegment = async (prepared) => {
      if (prepared.mode === "complete") {
        const result = await prepared.promise;
        if (!result?.ok && isCurrentTurn() && !result?.cancelled) setSpeechError(result?.message || "本地语音合成暂时不可用");
        return result?.ok ? playNativeSegment(result, prepared.segment) : false;
      }
      let played = false;
      try {
        while (isCurrentTurn()) {
          setPreparing(true);
          const chunk = await prepared.queue.next();
          if (!chunk) break;
          if (!await playNativeSegment(
            { ok: true, ...chunk },
            chunk.text || prepared.segment,
            { retainSpeaking: () => prepared.queue.pending() > 0 },
          )) return played;
          played = true;
        }
      } catch (error) {
        if (isCurrentTurn()) setSpeechError(error?.message || "本地流式语音合成暂时不可用");
      }
      const result = await prepared.promise;
      if (!result?.ok && isCurrentTurn() && !result?.cancelled) setSpeechError(result?.message || "本地流式语音合成暂时不可用");
      return played;
    };

    const run = async () => {
      // Electron's native stream already emits punctuation-aware PCM chunks.
      // Sending the whole answer once lets VITS generate the next chunk while
      // the current audio buffer is playing; pre-splitting here forced serial
      // worker requests and created an audible one-second gap between clauses.
      const segments = window.kioskBridge?.synthesizeSpeechStream
        ? [text]
        : splitSpeechSegments(text, { minChars: 8, maxChars: 24 });
      const preparedSegments = segments.map(prepareSegment);
      setPreparing(true);
      let played = false;
      try {
        for (const prepared of preparedSegments) {
          if (!isCurrentTurn()) return false;
          setPreparing(true);
          const nativePlayed = await playPreparedSegment(prepared);
          if (!nativePlayed) {
            if (!await playBrowserSegment(prepared.segment)) return played;
          }
          played = true;
        }
        return played;
      } finally {
        if (isCurrentTurn()) {
          activeTurnRef.current = "";
          setPreparing(false);
          setSpeaking(false);
          setMood("neutral");
        }
      }
    };

    return run();
  }, [muted, slow, stop, volume]);

  useEffect(() => {
    if (muted) stop();
  }, [muted, stop]);

  useEffect(() => () => {
    stop();
    audioContextRef.current?.close?.();
    audioContextRef.current = null;
  }, [stop]);

  return {
    analyserRef,
    mood,
    preparing,
    speak,
    speaking,
    speechError,
    stop,
    visemeTimelineRef,
  };
}
