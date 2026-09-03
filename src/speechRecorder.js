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

export function createAdaptiveVad({ floor = 0.00045, ceiling = 0.02, multiplier = 3.2, calibrationFrames = 4, activationFrames = 2, quietFramesBeforeActivation = 0 } = {}) {
  let noiseFloor = floor / multiplier;
  let calibrationEnergy = 0;
  let calibratedFrames = 0;
  let activeFrames = 0;
  let quietFrames = 0;
  let armed = quietFramesBeforeActivation === 0;
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
      if (!armed) {
        quietFrames = calibratedFrames >= calibrationFrames && rms < threshold ? quietFrames + 1 : 0;
        armed = quietFrames >= quietFramesBeforeActivation;
        activeFrames = 0;
        return { rms, threshold, speech: false, noiseFloor, activeFrames, armed };
      }
      activeFrames = rms >= threshold ? activeFrames + 1 : 0;
      return { rms, threshold, speech: activeFrames >= activationFrames, noiseFloor, activeFrames, armed };
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
  silenceMs = 700,
  preRollMs = 420,
  onReady,
  onSpeechStart,
  onLevel,
  onPreview,
  previewIntervalMs = 500,
  previewMaxDurationMs = 6000,
  vadOptions,
  signal,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前设备无法访问麦克风");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  let context = null;
  let source = null;
  let processor = null;
  let sink = null;
  let maxTimer = null;
  let idleTimer = null;
  let finishRecording = null;
  let cleanupPromise = null;
  let aborted = false;
  let resolveAbort;
  const abortPromise = new Promise((resolve) => { resolveAbort = resolve; });
  const handleAbort = () => {
    if (aborted) return;
    aborted = true;
    resolveAbort();
    finishRecording?.();
    void cleanup();
  };
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      clearTimeout(maxTimer);
      clearTimeout(idleTimer);
      try { signal?.removeEventListener?.("abort", handleAbort); } catch {}
      try { if (processor) processor.onaudioprocess = null; } catch {}
      for (const node of [processor, source, sink]) {
        try { node?.disconnect?.(); } catch {}
      }
      let tracks = [];
      try { tracks = stream?.getTracks?.() || []; } catch {}
      for (const track of tracks) {
        try { track?.stop?.(); } catch {}
      }
      try { if (context && context.state !== "closed") await context.close?.(); } catch {}
    })();
    return cleanupPromise;
  };

  try {
    signal?.addEventListener?.("abort", handleAbort, { once: true });
    if (signal?.aborted) handleAbort();
    if (aborted) {
      const vadState = createAdaptiveVad().snapshot();
      return { samples: new Float32Array(), sampleRate: 16000, heardSpeech: false, durationMs: 0, speechDurationMs: 0, noiseFloor: vadState.noiseFloor, threshold: vadState.threshold };
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextClass !== "function") throw new Error("当前设备无法启动麦克风音频处理");
    context = new AudioContextClass();
    if (context.state === "suspended") {
      await Promise.race([
        Promise.resolve(context.resume()).then(() => "resumed"),
        abortPromise.then(() => "aborted"),
      ]);
    }
    if (aborted) {
      const vadState = createAdaptiveVad().snapshot();
      return { samples: new Float32Array(), sampleRate: 16000, heardSpeech: false, durationMs: 0, speechDurationMs: 0, noiseFloor: vadState.noiseFloor, threshold: vadState.threshold };
    }
    if (context.state !== "running") throw new Error("麦克风没有成功启动，请检查系统麦克风权限");

    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    sink = context.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);

    const chunks = [];
    const preRoll = [];
    let length = 0;
    let preRollLength = 0;
    let heardSpeech = false;
    let speechStartedAt = 0;
    let lastSpeechAt = performance.now();
    let lastPreviewAt = 0;
    let previewInFlight = false;
    const vad = createAdaptiveVad(vadOptions);

    return await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(maxTimer);
        clearTimeout(idleTimer);
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error || "录音失败")));
          return;
        }
        try {
          const sourceRate = Number(context?.sampleRate) || 16000;
          const merged = mergeChunks(chunks, length);
          const vadState = vad.snapshot();
          resolve({
            samples: resample(merged, sourceRate),
            sampleRate: 16000,
            heardSpeech,
            durationMs: Math.round(length / sourceRate * 1000),
            speechDurationMs: speechStartedAt ? Math.round(performance.now() - speechStartedAt) : 0,
            noiseFloor: vadState.noiseFloor,
            threshold: vadState.threshold,
          });
        } catch (recordingError) {
          reject(recordingError);
        }
      };
      finishRecording = () => settle();
      idleTimer = setTimeout(finishRecording, maxIdleMs);
      processor.onaudioprocess = (event) => {
        try {
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
              maxTimer = setTimeout(finishRecording, maxDurationMs);
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
          if (onPreview && heardSpeech && speechLengthMs >= 450 && now - lastPreviewAt >= previewIntervalMs && !previewInFlight) {
            lastPreviewAt = now;
            previewInFlight = true;
            const samples = createPreviewSamples(chunks, context.sampleRate, { maxDurationMs: previewMaxDurationMs });
            Promise.resolve(onPreview({ samples, sampleRate: 16000 }))
              .catch(() => {})
              .finally(() => { previewInFlight = false; });
          }
          if (heardSpeech && now - lastSpeechAt >= silenceMs && length / context.sampleRate > 0.5) finishRecording();
        } catch (error) {
          settle(error);
        }
      };
      try { onReady?.(); } catch (error) { settle(error); }
      if (aborted) finishRecording();
    });
  } finally {
    await cleanup();
  }
}
