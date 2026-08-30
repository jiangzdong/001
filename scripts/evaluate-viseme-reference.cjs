const fs = require("fs");
const path = require("path");
const sherpa = require("sherpa-onnx-node");
const { analyzeEnvelope, createAlignedVisemes, createTimedVisemes } = require("../electron/viseme-timeline.cjs");

const projectRoot = path.join(__dirname, "..");
const argument = (name, fallback) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};
const text = argument("text", "的经验推动各领域的合作，为推进上海合作组织合作贡献力。");
const wavPath = path.resolve(argument("wav", path.join(projectRoot, "qa", "reference", "real-speaker-sample-30-38.wav")));
const realPath = path.resolve(argument("real", path.join(projectRoot, "qa", "reference", "real-speaker-motion.json")));
const outputPath = path.resolve(argument("output", path.join(projectRoot, "qa", "reference", "avatar-pcm-reference.json")));

const profiles = {
  CLOSED: { open: 0.01, width: 0.94 }, REST: { open: 0.18, width: 0.98 },
  A: { open: 0.94, width: 1.01 }, E: { open: 0.38, width: 1.2 },
  O: { open: 0.68, width: 0.82 }, U: { open: 0.4, width: 0.72 },
  F: { open: 0.22, width: 1.04 }, L: { open: 0.5, width: 1.02 },
  S: { open: 0.24, width: 1.12 }, SH: { open: 0.46, width: 0.8 },
};

function loadPronunciations() {
  const lexiconPath = path.join(projectRoot, "models", "sherpa-onnx-vits-zh-ll", "lexicon.txt");
  const pronunciations = new Map();
  for (const line of fs.readFileSync(lexiconPath, "utf8").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length > 1 && [...parts[0]].length === 1) pronunciations.set(parts[0], parts.slice(1));
  }
  return pronunciations;
}

function recognizeAlignment(wave) {
  const modelDirectory = path.join(projectRoot, "models", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: path.join(modelDirectory, "model.int8.onnx"), useInverseTextNormalization: 1 },
      tokens: path.join(modelDirectory, "tokens.txt"),
      numThreads: 4,
      provider: "cpu",
      debug: 0,
    },
  });
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples: Float32Array.from(wave.samples), sampleRate: wave.sampleRate });
  recognizer.decode(stream);
  return recognizer.getResult(stream);
}

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const alpha = (deltaMs, timeConstantMs) => 1 - Math.exp(-Math.max(0, deltaMs) / Math.max(1, timeConstantMs));
function percentile(values, position) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * position));
  const low = Math.floor(index); const high = Math.ceil(index); const mix = index - low;
  return sorted[low] + (sorted[high] - sorted[low]) * mix;
}
function normalize(values) {
  const low = percentile(values, 0.05); const high = percentile(values, 0.95);
  return values.map((value) => clamp01((value - low) / Math.max(1e-6, high - low)));
}
function pearson(a, b) {
  const size = Math.min(a.length, b.length);
  if (size < 3) return 0;
  const meanA = a.slice(0, size).reduce((sum, value) => sum + value, 0) / size;
  const meanB = b.slice(0, size).reduce((sum, value) => sum + value, 0) / size;
  let numerator = 0; let denominatorA = 0; let denominatorB = 0;
  for (let index = 0; index < size; index += 1) {
    const da = a[index] - meanA; const db = b[index] - meanB;
    numerator += da * db; denominatorA += da * da; denominatorB += db * db;
  }
  return numerator / Math.max(1e-9, Math.sqrt(denominatorA * denominatorB));
}
function compareAtLag(real, predicted, lagFrames) {
  if (lagFrames >= 0) return { real: real.slice(lagFrames), predicted: predicted.slice(0, predicted.length - lagFrames) };
  return { real: real.slice(0, real.length + lagFrames), predicted: predicted.slice(-lagFrames) };
}
function directionChanges(values, threshold = 0.08) {
  const signs = [];
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (Math.abs(delta) >= threshold) signs.push(Math.sign(delta));
  }
  return signs.slice(1).filter((sign, index) => sign !== signs[index]).length;
}
function timelineSample(events, timeMs) {
  let index = 0;
  while (index + 1 < events.length && events[index + 1].timeMs <= timeMs) index += 1;
  const currentEvent = events[index] || { timeMs: 0, shape: "CLOSED" };
  const nextEvent = events[Math.min(index + 1, events.length - 1)] || currentEvent;
  const span = Math.max(0, nextEvent.timeMs - currentEvent.timeMs);
  const transitionMs = Math.min(110, Math.max(68, span * 0.42));
  const start = Math.max(currentEvent.timeMs, nextEvent.timeMs - transitionMs);
  const raw = nextEvent.timeMs > start ? clamp01((timeMs - start) / (nextEvent.timeMs - start)) : 0;
  const mix = raw * raw * (3 - 2 * raw);
  return { current: currentEvent.shape, next: nextEvent.shape, mix };
}

const wave = sherpa.readWave(wavPath);
const samples = Float32Array.from(wave.samples);
const envelope = analyzeEnvelope(samples, wave.sampleRate);
const pronunciations = loadPronunciations();
const alignment = recognizeAlignment(wave);
const events = process.argv.includes("--weighted")
  ? createTimedVisemes(text, pronunciations, samples, wave.sampleRate)
  : createAlignedVisemes(text, pronunciations, samples, wave.sampleRate, alignment);
const realReport = JSON.parse(fs.readFileSync(realPath, "utf8"));
const realSamples = realReport.samples.filter((sample) => sample.timeMs <= envelope.durationMs);
let lastTime = realSamples[0]?.timeMs || 0;
let adaptivePeak = 0.06;
let smoothedLevel = 0;
let smoothedOpen = 0;
const predictedRaw = [];
const energyRaw = [];
for (const sample of realSamples) {
  const deltaMs = Math.max(1, Math.min(80, sample.timeMs - lastTime));
  lastTime = sample.timeMs;
  const envelopeIndex = Math.min(envelope.rms.length - 1, Math.max(0, Math.round(sample.timeMs / envelope.windowMs)));
  const rms = envelope.rms[envelopeIndex] || 0;
  adaptivePeak = Math.max(rms, adaptivePeak * Math.exp(-deltaMs / 1450), 0.025);
  const targetLevel = Math.min(1, Math.pow(Math.max(0, (rms - 0.0035) / Math.max(0.018, adaptivePeak - 0.0035)), 0.72));
  smoothedLevel += (targetLevel - smoothedLevel) * alpha(deltaMs, targetLevel > smoothedLevel ? 34 : 72);
  energyRaw.push(smoothedLevel);
  const pose = timelineSample(events, sample.timeMs);
  const current = profiles[pose.current] || profiles.REST;
  const next = profiles[pose.next] || current;
  const profileOpen = current.open + (next.open - current.open) * pose.mix;
  const desiredOpen = Math.min(1, profileOpen * (0.075 + smoothedLevel * 1.02));
  smoothedOpen += (desiredOpen - smoothedOpen) * alpha(deltaMs, desiredOpen > smoothedOpen ? 38 : 82);
  predictedRaw.push(smoothedOpen);
}
const predicted = normalize(predictedRaw);
const energy = normalize(energyRaw);
const real = realSamples.map((sample) => sample.mouthOpenNormalized);
const fps = Number(realReport.fps) || 25;
const bestAlignment = (candidate) => {
  let best = { lagFrames: 0, correlation: -2, real, predicted: candidate };
  for (let lagFrames = -Math.round(fps * 0.4); lagFrames <= Math.round(fps * 0.4); lagFrames += 1) {
    const aligned = compareAtLag(real, candidate, lagFrames);
    const correlation = pearson(aligned.real, aligned.predicted);
    if (correlation > best.correlation) best = { lagFrames, correlation, ...aligned };
  }
  return best;
};
const best = bestAlignment(predicted);
const bestEnergy = bestAlignment(energy);
const mae = best.real.reduce((sum, value, index) => sum + Math.abs(value - best.predicted[index]), 0) / Math.max(1, best.real.length);
const durationSeconds = Math.min(envelope.durationMs, realSamples.at(-1)?.timeMs || 0) / 1000;
const report = {
  generatedAt: new Date().toISOString(), text, wavPath, realPath,
  alignmentProvider: process.argv.includes("--weighted") ? "weighted-pcm-fallback" : "sensevoice-character-timestamps",
  alignmentTokenCount: alignment.tokens?.length || 0,
  audioDurationMs: Math.round(envelope.durationMs),
  speechStartMs: Math.round(envelope.speechStartMs), speechEndMs: Math.round(envelope.speechEndMs),
  eventCount: events.length,
  visibleEventsPerSecond: +(events.length / Math.max(0.001, durationSeconds)).toFixed(3),
  predictedDirectionChangesPerSecond: +(directionChanges(predicted) / Math.max(0.001, durationSeconds)).toFixed(3),
  realDirectionChangesPerSecond: +(directionChanges(real) / Math.max(0.001, durationSeconds)).toFixed(3),
  bestLagMs: Math.round(best.lagFrames / fps * 1000),
  bestCorrelation: +best.correlation.toFixed(4),
  acousticBestLagMs: Math.round(bestEnergy.lagFrames / fps * 1000),
  acousticBestCorrelation: +bestEnergy.correlation.toFixed(4),
  meanAbsoluteError: +mae.toFixed(4),
  visemes: events,
  samples: realSamples.map((sample, index) => ({ timeMs: sample.timeMs, realMouthOpen: sample.mouthOpenNormalized, predictedMouthOpen: +predicted[index].toFixed(5), audioEnergy: +energy[index].toFixed(5) })),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, samples: undefined, visemes: undefined, outputPath }, null, 2));
