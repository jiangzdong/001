"use strict";

// QA-only synthetic speech loopback, not a microphone/acoustic test. The
// responder receives actual recognized text, never a hidden text fallback.
const crypto = require("node:crypto");
const { REAL_ASR_PROVIDER, characterErrorRate, containsSensitiveText } = require("./virtual-senior-asr-gate.cjs");
const { validateRoundTranscript } = require("./virtual-senior-voice-oracle.cjs");
const STAGES = Object.freeze(["question-tts", "question-playback", "asr", "response", "answer-tts", "answer-playback"]);
const issue = (code, message, status = "blocked") => Object.assign(new Error(message), { code, status });

function audioEvidence(result) {
  if (!result?.ok) throw issue("VOICE_SYNTHESIS_UNAVAILABLE", result?.message || "本地语音合成不可用");
  const rate = result.sampleRate;
  const source = result.samples;
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || !source || !Number.isSafeInteger(source.length) || source.length < rate * 0.1 || source.length > rate * 180) throw issue("VOICE_AUDIO_INVALID", "合成音频格式或时长无效", "failed");
  const samples = Float32Array.from(source);
  let power = 0, peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw issue("VOICE_AUDIO_INVALID", "合成音频含有无效采样", "failed");
    power += sample * sample; peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(power / samples.length);
  if (rms < 0.001 || peak < 0.01) throw issue("VOICE_AUDIO_SILENT", "合成音频为空或近似静音", "failed");
  return { samples, metadata: { sampleRate: rate, samples: samples.length, durationMs: samples.length / rate * 1000, rms, peak, sha256: crypto.createHash("sha256").update(Buffer.from(samples.buffer)).digest("hex") } };
}

// Production synthesize() truncates at 500 characters; split instead of
// reporting a full answer as spoken when only its prefix was synthesized.
function speechSegments(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 6000) throw issue("VOICE_TEXT_INVALID", "播报内容为空或过长", "failed");
  const segments = [];
  let rest = text;
  while (rest.length > 420) {
    let cut = rest.slice(0, 420).search(/[。！？；\n][^。！？；\n]*$/);
    cut = cut >= 100 ? cut + 1 : 420;
    segments.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (rest) segments.push(rest);
  return segments;
}

function createVirtualSeniorVoiceTrial({ speech, playAudio, onStage = () => {}, timeoutMs = 65000, evidenceMode = "real-local" } = {}) {
  if (!["real-local", "unit-test"].includes(evidenceMode)) throw new TypeError("Invalid speech evidence mode");
  async function runRound({ roundId, question, speechPace = "medium", turnId, signal, respond } = {}) {
    const report = { required: true, mode: "synthetic-speech-loopback", evidenceMode, status: "running", maxCer: 0.25, microphone: "not-verified", acousticOutput: "not-verified", stages: Object.fromEntries(STAGES.map((id) => [id, { status: "not-run" }])) };
    let current = "question-tts";
    let active = true;
    const guard = () => { if (signal?.aborted || !active) throw issue("CANCELLED", "语音测试已停止", "cancelled"); };
    const wait = (operation) => new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const abort = () => { active = false; cleanup(); reject(issue("CANCELLED", "语音测试已停止", "cancelled")); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) return abort();
      timer = setTimeout(() => { active = false; cleanup(); reject(issue("VOICE_STAGE_TIMEOUT", "语音环节超时，不能记为通过")); }, timeoutMs);
      Promise.resolve().then(() => { guard(); return operation(); }).then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    });
    const stage = async (id, action) => {
      guard(); current = id;
      const start = performance.now();
      report.stages[id] = { ...report.stages[id], status: "running" };
      onStage({ stage: id, status: "running" });
      const result = await wait(action);
      guard();
      report.stages[id] = { ...report.stages[id], status: "passed", durationMs: (report.stages[id].durationMs || 0) + performance.now() - start };
      onStage({ stage: id, status: "passed" });
      return result;
    };
    const play = async (id, pcm, synthesized) => stage(id, async () => {
      const started = performance.now();
      const receipt = await playAudio({ turnId, stage: id, samples: pcm.samples, sampleRate: pcm.metadata.sampleRate, visemes: synthesized.visemes, audio: pcm.metadata, signal });
      guard();
      const elapsed = performance.now() - started;
      if (!receipt?.ended || receipt.contextState !== "running" || receipt.muted !== false || !Number.isFinite(receipt.playedMs) || receipt.playedMs < pcm.metadata.durationMs * 0.9 || (evidenceMode === "real-local" && elapsed < pcm.metadata.durationMs * 0.9)) throw issue("VOICE_PLAYBACK_UNCONFIRMED", "音频未完成实际播放，或输出处于静音/暂停状态");
      const clips = report.stages[id].clips || [];
      report.stages[id].clips = [...clips, { ...pcm.metadata, playedMs: receipt.playedMs, elapsedMs: elapsed, ended: true, contextState: receipt.contextState }];
    });
    try {
      guard();
      if (!speech || !speech.status?.().ready || typeof speech.synthesize !== "function" || typeof speech.recognize !== "function") throw issue("VOICE_MODELS_UNAVAILABLE", "本地语音模型不可用；本次语音测试受阻，不降级为文字通过");
      if (typeof playAudio !== "function") throw issue("VOICE_PLAYBACK_UNAVAILABLE", "观察界面的音频播放器尚不可用；不能略过播放验证");
      if (typeof question !== "string" || !question.trim() || question.length > 240 || typeof respond !== "function") throw issue("VOICE_INPUT_INVALID", "语音测试问题或响应器无效", "failed");
      if (containsSensitiveText(question)) throw issue("VOICE_SENSITIVE_INPUT", "测试问题包含敏感格式，不进行播报或记录", "failed");
      const speed = ({ slow: 0.85, medium: 1, fast: 1.15 })[speechPace] || 1;
      let synthesized, input;
      await stage("question-tts", async () => {
        synthesized = await speech.synthesize({ text: question, speed, voiceId: "zh-ll-2", turnId });
        guard(); input = audioEvidence(synthesized);
        report.stages["question-tts"].audio = input.metadata;
      });
      await play("question-playback", input, synthesized);
      const transcript = await stage("asr", async () => {
        const result = await speech.recognize({ samples: input.samples, sampleRate: input.metadata.sampleRate });
        guard();
        if (!result?.ok || result.provider !== REAL_ASR_PROVIDER || result.trustedFinal !== true) throw issue("VOICE_ASR_UNAVAILABLE", result?.message || "未取得可信本地语音识别结果");
        const text = String(result.text || "").trim();
        if (!text || text.length > 500) throw issue("VOICE_ASR_INVALID", "语音识别结果为空或过长", "failed");
        if (containsSensitiveText(text)) throw issue("VOICE_SENSITIVE_TRANSCRIPT", "识别结果包含敏感格式，已阻止进入业务和报告", "failed");
        const cer = characterErrorRate(text, question);
        report.stages.asr = { ...report.stages.asr, transcript: text, cer, provider: result.provider };
        if (cer > report.maxCer) throw issue("VOICE_ASR_MISMATCH", "语音识别与测试问题偏差过大，未使用原文替代识别结果", "failed");
        const semantic = validateRoundTranscript(roundId, text);
        report.stages.asr.criticalTerms = semantic;
        if (!semantic.valid) throw issue("VOICE_ASR_CRITICAL_TERMS", `关键业务词识别未通过：${semantic.missing.join("、") || "未知轮次"}；不按原脚本伪造业务识别成功`, "failed");
        return text;
      });
      const response = await stage("response", () => respond(transcript));
      report.transcript = transcript;
      report.response = response;
      const answer = typeof response === "string" ? response : response?.answer?.speechText;
      const segments = speechSegments(answer);
      report.answerCharacters = answer.length;
      report.answerSegments = segments.length;
      for (const text of segments) {
        let output, pcm;
        await stage("answer-tts", async () => {
          output = await speech.synthesize({ text, speed: 1, voiceId: "zh-ll-2", turnId });
          guard(); pcm = audioEvidence(output);
          report.stages["answer-tts"].clips = [...(report.stages["answer-tts"].clips || []), { ...pcm.metadata, characters: text.length }];
        });
        await play("answer-playback", pcm, output);
      }
      report.status = "passed";
    } catch (error) {
      active = false;
      report.status = error.status || "failed";
      report.error = { code: error.code || "VOICE_ERROR", message: String(error.message || "语音测试失败").slice(0, 240), stage: current };
      report.stages[current] = { ...report.stages[current], status: report.status, error: report.error };
      for (const item of Object.values(report.stages)) if (item.status === "not-run") Object.assign(item, { status: "blocked", reason: "UPSTREAM_VOICE_UNAVAILABLE" });
      for (const id of ["answer-tts", "answer-playback"]) {
        const item = report.stages[id];
        if (item.status === "passed" && item.clips?.length < report.answerSegments) Object.assign(item, { status: "blocked", reason: "ANSWER_INCOMPLETE" });
      }
      speech?.cancelTurn?.(turnId);
      onStage({ stage: current, status: report.status, error: report.error });
    }
    active = false;
    return report;
  }
  return { runRound };
}

module.exports = { STAGES, audioEvidence, speechSegments, createVirtualSeniorVoiceTrial };
