"use strict";

// QA-only, isolated bridge: Qwen3-TTS MLX -> retained WAV/PCM -> the current
// product's local sherpa SenseVoice service. It neither alters Electron's
// speech provider nor verifies playback, microphone, device, or packaging.
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createSpeechService } = require("../electron/speech-service.cjs");
const { JOURNEY } = require("../electron/harness/virtual-senior-live-journey.cjs");
const { REAL_ASR_PROVIDER, characterErrorRate } = require("../electron/harness/virtual-senior-asr-gate.cjs");
const { ORACLE_VERSION, validateRoundTranscript } = require("../electron/harness/virtual-senior-voice-oracle.cjs");
const { summarizePilot } = require("../electron/harness/qwen3-tts-sensevoice-pilot.cjs");
const { splitQuestionAtExistingPunctuation } = require("../electron/harness/qwen3-tts-sensevoice-candidate.cjs");

const root = path.resolve(__dirname, "..");
const assetsRoot = "/Users/luc/Documents/Codex/2026-09-02/referenced-chatgpt-conversation-this-is-an/outputs/apple-silicon-mlx-digital-human-stack";
const qwenModel = path.join(assetsRoot, "models/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit");
const qwenWorker = path.join(assetsRoot, "scripts/qwen3_tts_worker.py");
const qwenPython = path.join(assetsRoot, ".venv-qwen3-tts/bin/python");
const outputRoot = path.join(root, "QA-EXTERNAL/virtual-senior-community/qwen3-tts-sensevoice-pilot-v1");
const finalizeArgument = process.argv.find((argument) => argument.startsWith("--finalize="));
const strategyArgument = (process.argv.find((argument) => argument.startsWith("--strategy=")) || "--strategy=single-utterance-v1").slice("--strategy=".length);
if (!["single-utterance-v1", "existing-punctuation-segmentation-v1"].includes(strategyArgument)) throw new Error("unknown Qwen pilot strategy");
const runDirectory = finalizeArgument ? path.resolve(finalizeArgument.slice("--finalize=".length)) : path.join(outputRoot, crypto.randomUUID());
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const hashFile = async (filename) => sha256(await fs.readFile(filename));
const relative = (filename) => path.relative(runDirectory, filename).split(path.sep).join("/");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeWav16(bytes, expectedRate) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("Qwen output is not RIFF/WAVE");
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end > bytes.length) throw new Error("Qwen WAV chunk out of bounds");
    if (id === "fmt " && size >= 16) format = { code: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    if (id === "data") pcm = bytes.subarray(start, end);
    offset = end + (size % 2);
  }
  if (!format || !pcm || format.code !== 1 || format.channels !== 1 || format.bits !== 16 || format.sampleRate !== expectedRate || pcm.length < expectedRate / 10 * 2 || pcm.length % 2) throw new Error("Qwen WAV must be non-empty mono PCM16 at expected rate");
  return { pcm, sampleRate: format.sampleRate, samples: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2) };
}

function writeWav16(sampleRate, pcm) {
  const buffer = Buffer.alloc(44 + pcm.length);
  buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(36 + pcm.length, 4); buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36, "ascii"); buffer.writeUInt32LE(pcm.length, 40); pcm.copy(buffer, 44);
  return buffer;
}

function resample24kTo16k(source) {
  if (source.sampleRate !== 24000) throw new Error(`unsupported source rate ${source.sampleRate}`);
  const count = Math.floor(source.samples.length * 16000 / 24000);
  const output = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index += 1) {
    const inputPosition = index * 1.5;
    const lower = Math.floor(inputPosition), upper = Math.min(source.samples.length - 1, lower + 1), fraction = inputPosition - lower;
    const sample = Math.max(-32768, Math.min(32767, Math.round(source.samples[lower] * (1 - fraction) + source.samples[upper] * fraction)));
    output.writeInt16LE(sample, index * 2);
  }
  return output;
}

function samples16k(pcm) {
  const values = new Float32Array(pcm.length / 2);
  for (let index = 0; index < values.length; index += 1) values[index] = pcm.readInt16LE(index * 2) / 32768;
  return values;
}

function segmentsForQuestion(question) {
  return strategyArgument === "existing-punctuation-segmentation-v1" ? splitQuestionAtExistingPunctuation(question) : [question];
}

function aggregateSegmentMetrics(entries) {
  const metrics = entries.map((entry) => entry.metrics);
  return {
    termination_reason: metrics.every((item) => item.termination_reason === "eos") ? "eos" : "not-eos",
    model_reused: metrics.every((item) => item.model_reused === true),
    sample_rate_hz: metrics.every((item) => item.sample_rate_hz === 24000) ? 24000 : null,
    channels: metrics.every((item) => item.channels === 1) ? 1 : null,
    streaming: metrics.every((item) => item.streaming === true),
    stream_first_chunk_seconds: metrics[0]?.stream_first_chunk_seconds ?? null,
    stream_chunks: metrics.reduce((total, item) => total + (Number(item.stream_chunks) || 0), 0),
    generated_token_count: metrics.reduce((total, item) => total + (Number(item.generated_token_count) || 0), 0),
    wall_seconds: Math.round(metrics.reduce((total, item) => total + (Number(item.wall_seconds) || 0), 0) * 10000) / 10000,
    mlx_memory: { peak_bytes: Math.max(...metrics.map((item) => Number(item.mlx_memory?.peak_bytes) || 0)) },
    segmentCount: metrics.length,
  };
}

function fileSummary(filename) {
  const stat = fssync.statSync(filename);
  return { path: filename, bytes: stat.size, sha256: sha256(fssync.readFileSync(filename)) };
}

function modelSummary() {
  const files = fssync.readdirSync(qwenModel).sort().map((name) => {
    const filename = path.join(qwenModel, name);
    const stat = fssync.statSync(filename);
    return stat.isFile() ? { name, bytes: stat.size, sha256: sha256(fssync.readFileSync(filename)) } : { name, type: "directory" };
  });
  return { qwenModel: { path: qwenModel, files }, qwenWorker: fileSummary(qwenWorker), qwenPython: fssync.realpathSync(qwenPython) };
}

function startWorker() {
  const child = spawn(qwenPython, [qwenWorker, qwenModel], { cwd: assetsRoot, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.setDefaultEncoding("utf8");
  const events = [], waiting = [];
  let stdout = "", stderr = "", closed = false;
  // An event must go either to the current waiter or the FIFO backlog, never
  // both. Keeping it in both places makes the next synthesis consume a stale
  // completion and can wrongly associate audio with a later round.
  const publish = (event) => { const listener = waiting.shift(); if (listener) listener(event); else events.push(event); };
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    let lineEnd;
    while ((lineEnd = stdout.indexOf("\n")) >= 0) {
      const line = stdout.slice(0, lineEnd).trim(); stdout = stdout.slice(lineEnd + 1);
      if (!line) continue;
      try { publish(JSON.parse(line)); } catch { stderr += `\n[invalid-worker-json] ${line.slice(0, 500)}`; }
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", () => { closed = true; while (waiting.length) waiting.shift()({ status: "worker-closed" }); });
  const next = async (timeoutMs = 180000) => {
    if (events.length) return events.shift();
    if (closed) return { status: "worker-closed" };
    return Promise.race([new Promise((resolve) => waiting.push(resolve)), sleep(timeoutMs).then(() => ({ status: "worker-timeout" }))]);
  };
  return {
    child, stderr: () => stderr,
    async ready() {
      const result = await next(180000);
      if (result?.status !== "ready") throw new Error(`Qwen worker did not become ready: ${JSON.stringify(result)} ${stderr.slice(-500)}`);
      return result;
    },
    async synthesize(request) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
      let firstChunkSeconds = null;
      for (;;) {
        const result = await next(180000);
        if (result?.status === "chunk" && firstChunkSeconds == null) firstChunkSeconds = result.elapsed_seconds;
        if (result?.status === "completed") return { metrics: result.metrics, observedFirstChunkSeconds: firstChunkSeconds };
        if (result?.status === "failed") throw new Error(`Qwen synthesis failed: ${result.error || "unknown"}`);
        if (result?.status === "worker-timeout" || result?.status === "worker-closed") throw new Error(`Qwen worker ended before completion: ${result.status} ${stderr.slice(-500)}`);
      }
    },
    async close() { if (!closed) { child.stdin.end(); await new Promise((resolve) => child.once("close", resolve)); } },
  };
}

async function finalizeExistingRun() {
  const resolvedRoot = path.resolve(outputRoot);
  if (runDirectory !== resolvedRoot && !runDirectory.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("finalize directory must be below the dedicated Qwen pilot evidence root");
  const manifestPath = path.join(runDirectory, "manifest.json");
  if (fssync.existsSync(manifestPath)) throw new Error("refusing to overwrite an existing pilot manifest");
  const batches = [];
  for (let batchIndex = 1; batchIndex <= 3; batchIndex += 1) {
    const batchId = `batch-${String(batchIndex).padStart(3, "0")}`;
    const reportPath = path.join(runDirectory, "batches", batchId, "report.json");
    const bytes = await fs.readFile(reportPath);
    const batch = JSON.parse(bytes.toString("utf8"));
    for (const row of batch.cases || []) {
      if (row.asrStatus !== "passed" && row.metrics?.termination_reason !== "eos" && /^0{64}$/.test(row.source24kSha256 || "")) {
        row.audioStatus = "not-published-non-eos";
        row.source24kSha256 = null; row.converted16kSha256 = null; row.pcm16leSha256 = null;
      }
    }
    batch.reportPath = relative(reportPath); batch.reportSha256 = sha256(bytes);
    batches.push(batch);
  }
  const manifest = {
    version: "qwen3-tts-sensevoice-pilot-v1", dataClassification: "synthetic-test-only",
    evidenceScope: "isolated Qwen3-TTS MLX to current product SenseVoice QA; no Electron provider integration or playback/microphone/device claim",
    finalizedAt: new Date().toISOString(), source: modelSummary(),
    currentProductSenseVoice: { provider: REAL_ASR_PROVIDER, speechService: fileSummary(path.join(root, "electron/speech-service.cjs")), model: fileSummary(path.join(root, "models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx")) },
    oracleVersion: ORACLE_VERSION, conversion: { source: "24kHz mono PCM16 WAV", output: "16kHz mono PCM16 WAV", algorithm: "deterministic linear interpolation, ratio 2:3" }, batches,
    fullVoiceAcceptance: false, unverifiedBoundaries: ["Electron product integration", "GUI playback", "microphone capture", "acoustic output", "target device", "Windows packaging", "production MCP"],
  };
  manifest.summary = summarizePilot(manifest.batches);
  manifest.status = manifest.summary.gate === "passed" ? "pilot-passed-no-30-batch-run-performed" : "pilot-failed-30-batch-run-prohibited";
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output: manifestPath, gate: manifest.summary.gate, actualCases: `${manifest.summary.passedCases}/${manifest.summary.totalCases}`, eligibleForThirtyBatchStabilityRun: manifest.summary.eligibleForThirtyBatchStabilityRun }));
}

async function main() {
  if (finalizeArgument) return finalizeExistingRun();
  if (process.env.ELECTRON_RUN_AS_NODE !== "1") throw new Error("run with ELECTRON_RUN_AS_NODE=1 so current product SenseVoice is loaded directly");
  for (const filename of [qwenModel, qwenWorker, qwenPython]) await fs.access(filename);
  await fs.mkdir(runDirectory, { recursive: true });
  const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => root } });
  const worker = startWorker();
  const manifest = {
    version: "qwen3-tts-sensevoice-pilot-v1",
    dataClassification: "synthetic-test-only",
    evidenceScope: "isolated Qwen3-TTS MLX to current product SenseVoice QA; no Electron provider integration or playback/microphone/device claim",
    startedAt: new Date().toISOString(),
    source: modelSummary(),
    currentProductSenseVoice: { provider: REAL_ASR_PROVIDER, speechService: fileSummary(path.join(root, "electron/speech-service.cjs")), model: fileSummary(path.join(root, "models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx")) },
    oracleVersion: ORACLE_VERSION,
    generationStrategy: strategyArgument,
    conversion: { source: "24kHz mono PCM16 WAV", output: "16kHz mono PCM16 WAV", algorithm: "deterministic linear interpolation, ratio 2:3" },
    batches: [],
  };
  try {
    const loaded = await worker.ready();
    manifest.qwenLoadSeconds = loaded.model_load_seconds;
    for (let batchIndex = 1; batchIndex <= 3; batchIndex += 1) {
      const batchId = `batch-${String(batchIndex).padStart(3, "0")}`;
      const batchDirectory = path.join(runDirectory, "batches", batchId);
      await fs.mkdir(path.join(batchDirectory, "audio-24k"), { recursive: true });
      await fs.mkdir(path.join(batchDirectory, "audio-24k-segments"), { recursive: true });
      await fs.mkdir(path.join(batchDirectory, "audio-16k"), { recursive: true });
      await fs.mkdir(path.join(batchDirectory, "metrics"), { recursive: true });
      const batch = { batchId, startedAt: new Date().toISOString(), cases: [] };
      for (let roundIndex = 0; roundIndex < JOURNEY.length; roundIndex += 1) {
        const step = JOURNEY[roundIndex];
        const output24k = path.join(batchDirectory, "audio-24k", `${step.id}.wav`);
        const metricDirectory = path.join(batchDirectory, "metrics", step.id);
        const output16k = path.join(batchDirectory, "audio-16k", `${step.id}.wav`);
        const questionSegments = segmentsForQuestion(step.question);
        const row = { roundId: step.id, question: step.question, generationStrategy: strategyArgument, segments: [], status: "running", source24kPath: relative(output24k), converted16kPath: relative(output16k) };
        try {
          const segmentPcm = [];
          for (let segmentIndex = 0; segmentIndex < questionSegments.length; segmentIndex += 1) {
            const segmentOutput = path.join(batchDirectory, "audio-24k-segments", step.id, `${segmentIndex + 1}.wav`);
            const segmentMetric = path.join(metricDirectory, `${segmentIndex + 1}.json`);
            await fs.mkdir(path.dirname(segmentOutput), { recursive: true }); await fs.mkdir(metricDirectory, { recursive: true });
            const request = { text: questionSegments[segmentIndex], voice: "Vivian", instruct: "自然、清晰地朗读这句中文测试问题。", style: "synthetic-qa-pilot", seed: batchIndex * 100000 + roundIndex * 10 + segmentIndex + 1, stream: true, streaming_interval: 0.32, output: segmentOutput, metrics: segmentMetric, staging_output: path.join(path.dirname(segmentOutput), `.${segmentIndex + 1}.partial.wav`), staging_metrics: path.join(metricDirectory, `.${segmentIndex + 1}.partial.json`) };
            const generated = await worker.synthesize(request), sourceBytes = await fs.readFile(segmentOutput), source = decodeWav16(sourceBytes, 24000), metrics = JSON.parse(await fs.readFile(segmentMetric, "utf8"));
            const observedConsistent = generated.observedFirstChunkSeconds != null && Math.abs(metrics.stream_first_chunk_seconds - generated.observedFirstChunkSeconds) <= 0.00011;
            if (metrics.termination_reason !== "eos" || metrics.sample_rate_hz !== 24000 || metrics.channels !== 1 || !metrics.model_reused || !observedConsistent) throw new Error("Qwen segment metrics failed EOS/reuse/stream evidence contract");
            row.segments.push({ text: request.text, seed: request.seed, source24kPath: relative(segmentOutput), source24kSha256: sha256(sourceBytes), metricsPath: relative(segmentMetric), metrics, observedFirstChunkSeconds: generated.observedFirstChunkSeconds });
            segmentPcm.push(source.pcm);
          }
          const sourceBytes = writeWav16(24000, Buffer.concat(segmentPcm));
          await fs.writeFile(output24k, sourceBytes, { flag: "wx" });
          const source = decodeWav16(sourceBytes, 24000);
          const conversionStarted = performance.now();
          const pcm = resample24kTo16k(source);
          const converted = writeWav16(16000, pcm);
          await fs.writeFile(output16k, converted, { flag: "wx" });
          row.conversionDurationMs = Math.round((performance.now() - conversionStarted) * 1000) / 1000;
          row.source24kSha256 = sha256(sourceBytes);
          row.converted16kSha256 = sha256(converted);
          row.pcm16leSha256 = sha256(pcm);
          row.metrics = aggregateSegmentMetrics(row.segments);
          row.observedFirstChunkSeconds = row.segments[0].observedFirstChunkSeconds;
          const asrStarted = performance.now();
          const actual = await speech.recognize({ samples: samples16k(pcm), sampleRate: 16000 });
          row.asrDurationMs = Math.round((performance.now() - asrStarted) * 1000) / 1000;
          row.provider = actual.provider || null;
          row.trustedFinal = actual.trustedFinal === true;
          row.transcript = String(actual.text || "").trim();
          row.cer = characterErrorRate(row.transcript, step.question);
          row.criticalTerms = validateRoundTranscript(step.id, row.transcript);
          row.characterAccuracyPassed = actual.ok === true && row.provider === REAL_ASR_PROVIDER && row.trustedFinal && row.cer <= 0.25;
          row.asrStatus = row.characterAccuracyPassed && row.criticalTerms.valid ? "passed" : "failed";
          row.status = row.asrStatus;
          if (!actual.ok) row.error = actual.message || "SenseVoice did not return a final transcript";
        } catch (error) {
          row.status = "blocked"; row.asrStatus = "blocked"; row.error = String(error.message || error).slice(0, 500);
          // Preserve the attempted row and any published artifacts; never retry.
          row.audioStatus = "not-published-or-incomplete";
          row.source24kSha256 ||= null; row.converted16kSha256 ||= null; row.pcm16leSha256 ||= null;
          row.metrics ||= { termination_reason: "not-eos" }; row.provider ||= "unverified"; row.criticalTerms ||= { valid: false, oracle: ORACLE_VERSION, missing: [] };
        }
        batch.cases.push(row);
        console.log(JSON.stringify({ batchId, roundId: row.roundId, status: row.asrStatus, cer: row.cer, transcript: row.transcript, error: row.error }));
      }
      batch.finishedAt = new Date().toISOString();
      const reportPath = path.join(batchDirectory, "report.json");
      await fs.writeFile(reportPath, JSON.stringify(batch, null, 2) + "\n", { flag: "wx" });
      batch.reportPath = relative(reportPath); batch.reportSha256 = await hashFile(reportPath);
      manifest.batches.push(batch);
    }
    manifest.summary = summarizePilot(manifest.batches);
    manifest.finishedAt = new Date().toISOString();
    manifest.status = manifest.summary.gate === "passed" ? "pilot-passed-no-30-batch-run-performed" : "pilot-failed-30-batch-run-prohibited";
    manifest.fullVoiceAcceptance = false;
    manifest.unverifiedBoundaries = ["Electron product integration", "GUI playback", "microphone capture", "acoustic output", "target device", "Windows packaging", "production MCP"];
    const manifestPath = path.join(runDirectory, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ output: manifestPath, gate: manifest.summary.gate, actualCases: `${manifest.summary.passedCases}/${manifest.summary.totalCases}`, eligibleForThirtyBatchStabilityRun: manifest.summary.eligibleForThirtyBatchStabilityRun }));
  } finally { await worker.close().catch(() => {}); speech.close(); }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
