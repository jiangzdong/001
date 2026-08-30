function mergeChunks(chunks, length) {
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged;
}

function resample(samples, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.round(samples.length / ratio));
  if (ratio < 1) {
    for (let index = 0; index < output.length; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(samples.length - 1, left + 1);
      const blend = position - left;
      output[index] = samples[left] * (1 - blend) + samples[right] * blend;
    }
    return output;
  }
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += samples[cursor];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export function createPreviewSamples(chunks, sourceRate, { targetRate = 16000, maxDurationMs = 10000 } = {}) {
  const maxSourceLength = Math.max(1, Math.round(sourceRate * maxDurationMs / 1000));
  const selected = [];
  let selectedLength = 0;
  for (let index = chunks.length - 1; index >= 0 && selectedLength < maxSourceLength; index -= 1) {
    const chunk = chunks[index];
    const remaining = maxSourceLength - selectedLength;
    selected.unshift(chunk.length <= remaining ? chunk : chunk.slice(chunk.length - remaining));
    selectedLength += Math.min(chunk.length, remaining);
  }
  return resample(mergeChunks(selected, selectedLength), sourceRate, targetRate);
}

export function computeRms(samples) {
  if (!samples?.length) return 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) energy += samples[index] * samples[index];
  return Math.sqrt(energy / samples.length);
}

export function createAdaptiveVad({ floor = 0.00045, ceiling = 0.02, multiplier = 3.2, calibrationFrames = 4, activationFrames = 2 } = {}) {
  let noiseFloor = floor / multiplier;
  let calibrationEnergy = 0;
  let calibratedFrames = 0;
  let activeFrames = 0;
  return {
    observe(samples) {
      const rms = computeRms(samples);
      if (calibratedFrames < calibrationFrames) {
        // Keep speech during startup from being learned as the room noise floor.
        calibrationEnergy += Math.min(rms, floor);
        calibratedFrames += 1;
        noiseFloor = Math.max(floor / multiplier, calibrationEnergy / calibratedFrames);
      } else if (rms < noiseFloor * 1.8) {
        noiseFloor = noiseFloor * 0.94 + rms * 0.06;
      }
      const threshold = Math.min(ceiling, Math.max(floor, noiseFloor * multiplier));
      activeFrames = rms >= threshold ? activeFrames + 1 : 0;
      return { rms, threshold, speech: activeFrames >= activationFrames, noiseFloor, activeFrames };
    },
    snapshot() {
      const threshold = Math.min(ceiling, Math.max(floor, noiseFloor * multiplier));
      return { noiseFloor, threshold };
    },
  };
}

export async function recordSpeech({
  maxDurationMs = 45000,
  maxIdleMs = 12000,
  silenceMs = 1100,
  preRollMs = 420,
  onReady,
  onSpeechStart,
  onLevel,
  onPreview,
  previewIntervalMs = 1800,
  previewMaxDurationMs = 10000,
  signal,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前设备无法访问麦克风");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  if (context.state === "suspended") await context.resume();
  if (context.state !== "running") {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw new Error("麦克风没有成功启动，请检查系统麦克风权限");
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0;
  const chunks = [];
  const preRoll = [];
  let length = 0;
  let preRollLength = 0;
  let heardSpeech = false;
  let speechStartedAt = 0;
  let lastSpeechAt = performance.now();
  let lastPreviewAt = 0;
  let previewInFlight = false;
  let finished = false;
  const vad = createAdaptiveVad();

  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);
  onReady?.();

  return new Promise((resolve, reject) => {
    let maxTimer;
    let idleTimer;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      signal?.removeEventListener("abort", finish);
      processor.disconnect(); source.disconnect(); sink.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      const merged = mergeChunks(chunks, length);
      const vadState = vad.snapshot();
      resolve({
        samples: resample(merged, context.sampleRate),
        sampleRate: 16000,
        heardSpeech,
        durationMs: Math.round(length / context.sampleRate * 1000),
        speechDurationMs: speechStartedAt ? Math.round(performance.now() - speechStartedAt) : 0,
        noiseFloor: vadState.noiseFloor,
        threshold: vadState.threshold,
      });
    };
    maxTimer = setTimeout(finish, maxDurationMs);
    idleTimer = setTimeout(finish, Math.min(maxDurationMs, maxIdleMs));
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish().catch(reject);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input);
      const activity = vad.observe(chunk);
      onLevel?.(activity);
      const now = performance.now();
      if (!heardSpeech) {
        preRoll.push(chunk);
        preRollLength += chunk.length;
        const maxPreRollLength = Math.round(context.sampleRate * preRollMs / 1000);
        while (preRollLength > maxPreRollLength && preRoll.length > 1) preRollLength -= preRoll.shift().length;
      } else {
        chunks.push(chunk);
        length += chunk.length;
      }
      if (activity.speech) {
        if (!heardSpeech) {
          clearTimeout(idleTimer);
          heardSpeech = true;
          speechStartedAt = now;
          for (const buffered of preRoll) { chunks.push(buffered); length += buffered.length; }
          preRoll.length = 0;
          preRollLength = 0;
          onSpeechStart?.();
        }
        heardSpeech = true;
        lastSpeechAt = now;
      }
      const speechLengthMs = length / context.sampleRate * 1000;
      if (onPreview && heardSpeech && speechLengthMs >= 1000 && now - lastPreviewAt >= previewIntervalMs && !previewInFlight) {
        lastPreviewAt = now;
        previewInFlight = true;
        const samples = createPreviewSamples(chunks, context.sampleRate, { maxDurationMs: previewMaxDurationMs });
        Promise.resolve(onPreview({ samples, sampleRate: 16000 }))
          .catch(() => {})
          .finally(() => { previewInFlight = false; });
      }
      if (heardSpeech && now - lastSpeechAt >= silenceMs && length / context.sampleRate > 0.7) finish().catch(reject);
    };
  });
}
