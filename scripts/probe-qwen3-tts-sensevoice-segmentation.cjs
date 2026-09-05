"use strict";

// QA-only candidate A: preserve the exact 22-round question but synthesize
// each existing punctuation sentence separately. This is not a product route.
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createSpeechService } = require("../electron/speech-service.cjs");
const { REAL_ASR_PROVIDER, characterErrorRate } = require("../electron/harness/virtual-senior-asr-gate.cjs");
const { validateRoundTranscript, ORACLE_VERSION } = require("../electron/harness/virtual-senior-voice-oracle.cjs");
const { splitQuestionAtExistingPunctuation, summarizeCandidate } = require("../electron/harness/qwen3-tts-sensevoice-candidate.cjs");

const root = path.resolve(__dirname, "..");
const assetsRoot = "/Users/luc/Documents/Codex/2026-09-02/referenced-chatgpt-conversation-this-is-an/outputs/apple-silicon-mlx-digital-human-stack";
const qwenModel = path.join(assetsRoot, "models/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit");
const qwenWorker = path.join(assetsRoot, "scripts/qwen3_tts_worker.py");
const qwenPython = path.join(assetsRoot, ".venv-qwen3-tts/bin/python");
const question = "还有哪些消费？接着上一页往后看。";
const out = path.join(root, "QA-EXTERNAL/virtual-senior-community/qwen3-tts-sensevoice-candidates-v1", crypto.randomUUID());
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const relative = (filename) => path.relative(out, filename).split(path.sep).join("/");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readWav24k(bytes) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("candidate source is not RIFF/WAVE");
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
    if (end > bytes.length) throw new Error("candidate WAV chunk out of bounds");
    if (id === "fmt " && size >= 16) format = { code: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    if (id === "data") pcm = bytes.subarray(start, end);
    offset = end + size % 2;
  }
  if (!format || !pcm || format.code !== 1 || format.channels !== 1 || format.rate !== 24000 || format.bits !== 16 || !pcm.length || pcm.length % 2) throw new Error("candidate source must be nonempty 24k mono PCM16");
  return pcm;
}

function wav(sampleRate, pcm) {
  const result = Buffer.alloc(44 + pcm.length);
  result.write("RIFF", 0, "ascii"); result.writeUInt32LE(36 + pcm.length, 4); result.write("WAVEfmt ", 8, "ascii"); result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22); result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write("data", 36, "ascii"); result.writeUInt32LE(pcm.length, 40); pcm.copy(result, 44);
  return result;
}

function resample(pcm24) {
  const source = new Int16Array(pcm24.buffer, pcm24.byteOffset, pcm24.length / 2), result = Buffer.alloc(Math.floor(source.length * 2 / 3) * 2);
  for (let index = 0; index < result.length / 2; index += 1) {
    const point = index * 1.5, lower = Math.floor(point), upper = Math.min(source.length - 1, lower + 1), value = Math.round(source[lower] * (1 - point + lower) + source[upper] * (point - lower));
    result.writeInt16LE(Math.max(-32768, Math.min(32767, value)), index * 2);
  }
  return result;
}

function floats(pcm) { const result = new Float32Array(pcm.length / 2); for (let index = 0; index < result.length; index += 1) result[index] = pcm.readInt16LE(index * 2) / 32768; return result; }

function worker() {
  const child = spawn(qwenPython, [qwenWorker, qwenModel], { cwd: assetsRoot, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.setDefaultEncoding("utf8");
  const queue = [], waiters = []; let buffered = "", stderr = "", closed = false;
  const deliver = (event) => { const waiter = waiters.shift(); if (waiter) waiter(event); else queue.push(event); };
  child.stdout.on("data", (chunk) => { buffered += chunk; let end; while ((end = buffered.indexOf("\n")) >= 0) { const line = buffered.slice(0, end).trim(); buffered = buffered.slice(end + 1); if (line) { try { deliver(JSON.parse(line)); } catch { stderr += `\ninvalid JSON: ${line.slice(0, 300)}`; } } } });
  child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("close", () => { closed = true; while (waiters.length) waiters.shift()({ status: "worker-closed" }); });
  const next = (ms = 180000) => queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve({ status: "worker-closed" }) : Promise.race([new Promise((resolve) => waiters.push(resolve)), sleep(ms).then(() => ({ status: "worker-timeout" }))]);
  return {
    async ready() { const event = await next(); if (event.status !== "ready") throw new Error(`worker not ready: ${JSON.stringify(event)} ${stderr.slice(-300)}`); return event; },
    async generate(request) { child.stdin.write(`${JSON.stringify(request)}\n`); let firstChunk = null; for (;;) { const event = await next(); if (event.status === "chunk" && firstChunk == null) firstChunk = event.elapsed_seconds; if (event.status === "completed") return { metrics: event.metrics, firstChunk }; if (event.status === "failed") throw new Error(event.error || "Qwen generation failed"); if (/worker-(closed|timeout)/.test(event.status || "")) throw new Error(`${event.status}: ${stderr.slice(-300)}`); } },
    async close() { if (!closed) { child.stdin.end(); await new Promise((resolve) => child.once("close", resolve)); } },
  };
}

async function main() {
  if (process.env.ELECTRON_RUN_AS_NODE !== "1") throw new Error("requires current Electron runtime as Node");
  const segments = splitQuestionAtExistingPunctuation(question);
  if (segments.length !== 2) throw new Error("candidate no longer has exactly two original punctuation segments");
  await fs.mkdir(out, { recursive: true });
  const qwen = worker(), speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => root } });
  const report = { version: "qwen3-tts-sensevoice-candidate-v1", candidate: "existing-punctuation-segmentation-v1", candidateRationale: "same full business text repeatedly hit the existing 1024-token EOS guard; two original punctuation sentences are shorter, semantically unchanged, and their concatenation is byte-identical", fullQuestion: question, segments, generationParameters: { voice: "Vivian", instruct: "自然、清晰地朗读这句中文测试问题。", language: "chinese", top_k: 1, top_p: 1, temperature: 0.3, max_tokens: 1024, stream: true }, oracleVersion: ORACLE_VERSION, attempts: [], fullVoiceAcceptance: false, scope: "isolated QA only; no product integration or playback/microphone claim" };
  try {
    report.workerReady = await qwen.ready();
    for (let index = 1; index <= 10; index += 1) {
      const attemptId = `attempt-${String(index).padStart(2, "0")}`, directory = path.join(out, "attempts", attemptId);
      await fs.mkdir(path.join(directory, "segments"), { recursive: true }); await fs.mkdir(path.join(directory, "metrics"), { recursive: true });
      const attempt = { attemptId, segments: [], status: "running" }; const pcmParts = [];
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex], wavPath = path.join(directory, "segments", `${segmentIndex + 1}.wav`), metricPath = path.join(directory, "metrics", `${segmentIndex + 1}.json`);
        const entry = { text: segment, seed: index * 100 + segmentIndex + 1, wavPath: relative(wavPath), metricPath: relative(metricPath) };
        try {
          const generated = await qwen.generate({ text: segment, voice: "Vivian", instruct: "自然、清晰地朗读这句中文测试问题。", style: "segmentation-candidate-v1", seed: entry.seed, stream: true, streaming_interval: 0.32, output: wavPath, metrics: metricPath, staging_output: path.join(directory, "segments", `.${segmentIndex + 1}.partial.wav`), staging_metrics: path.join(directory, "metrics", `.${segmentIndex + 1}.partial.json`) });
          const bytes = await fs.readFile(wavPath); entry.source24kSha256 = sha256(bytes); entry.metrics = JSON.parse(await fs.readFile(metricPath, "utf8")); entry.observedFirstChunkSeconds = generated.firstChunk;
          if (entry.metrics.termination_reason !== "eos" || !entry.metrics.model_reused || entry.metrics.stream_first_chunk_seconds == null) throw new Error("EOS/reuse/stream evidence failed");
          pcmParts.push(readWav24k(bytes)); entry.status = "passed";
        } catch (error) { entry.status = "failed"; entry.error = String(error.message || error).slice(0, 500); }
        attempt.segments.push(entry);
      }
      attempt.allSegmentsEos = attempt.segments.every((entry) => entry.status === "passed" && entry.metrics?.termination_reason === "eos");
      if (attempt.allSegmentsEos) {
        const pcm24 = Buffer.concat(pcmParts), combined24 = wav(24000, pcm24), combined24Path = path.join(directory, "combined-24k.wav"), pcm16 = resample(pcm24), combined16 = wav(16000, pcm16), combined16Path = path.join(directory, "combined-16k.wav");
        await fs.writeFile(combined24Path, combined24, { flag: "wx" }); await fs.writeFile(combined16Path, combined16, { flag: "wx" });
        attempt.combined = { source24kPath: relative(combined24Path), source24kSha256: sha256(combined24), converted16kPath: relative(combined16Path), converted16kSha256: sha256(combined16), pcm16leSha256: sha256(pcm16) };
        const started = performance.now(), actual = await speech.recognize({ samples: floats(pcm16), sampleRate: 16000 });
        attempt.asrDurationMs = Math.round((performance.now() - started) * 1000) / 1000; attempt.provider = actual.provider || null; attempt.transcript = String(actual.text || "").trim(); attempt.cer = characterErrorRate(attempt.transcript, question); attempt.criticalTerms = validateRoundTranscript("consumption-next", attempt.transcript);
        attempt.status = actual.ok && actual.trustedFinal && attempt.provider === REAL_ASR_PROVIDER && attempt.cer <= 0.25 && attempt.criticalTerms.valid ? "passed" : "failed";
        if (attempt.status !== "passed") attempt.error = actual.message || "ASR/oracle mismatch";
      } else { attempt.criticalTerms = { valid: false, oracle: ORACLE_VERSION, missing: [] }; attempt.status = "failed"; attempt.error = attempt.segments.filter((entry) => entry.status !== "passed").map((entry) => entry.error).join("; "); }
      const attemptPath = path.join(directory, "report.json"); await fs.writeFile(attemptPath, JSON.stringify(attempt, null, 2) + "\n", { flag: "wx" }); attempt.reportPath = relative(attemptPath); attempt.reportSha256 = sha256(await fs.readFile(attemptPath)); report.attempts.push(attempt);
      console.log(JSON.stringify({ attemptId, status: attempt.status, cer: attempt.cer, transcript: attempt.transcript, error: attempt.error }));
    }
    report.summary = summarizeCandidate(report.attempts); report.finishedAt = new Date().toISOString(); const manifest = path.join(out, "manifest.json"); await fs.writeFile(manifest, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ output: manifest, summary: report.summary }));
  } finally { await qwen.close().catch(() => {}); speech.close(); }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
