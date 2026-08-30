const { performance } = require("node:perf_hooks");
const { createSpeechService } = require("../electron/speech-service.cjs");

const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => process.cwd() } });
const text = "妈妈您好，我是小安。女声发音练习，来、小、是、无。";
const requiredShapes = ["CLOSED", "A", "E", "O", "U"];
const voices = ["zh-ll-2"];

(async () => {
  const warmupStartedAt = performance.now();
  const warmup = await speech.warmup("zh-ll-2");
  const warmupMs = performance.now() - warmupStartedAt;
  const reports = [];
  for (const voiceId of voices) {
    const startedAt = performance.now();
    const result = await speech.synthesize({ text, speed: 1, voiceId });
    const synthesisMs = performance.now() - startedAt;
    if (!result.ok || !result.samples?.length) throw new Error(`${voiceId}: no synthesized PCM`);
    if (result.alignment?.provider !== "weighted-pcm-fallback") throw new Error(`${voiceId}: synthesis must return the non-blocking fallback timeline`);
    const alignmentStartedAt = performance.now();
    const aligned = await speech.align({ text, samples: result.samples, sampleRate: result.sampleRate, turnId: "alignment-audit" });
    const alignmentMs = performance.now() - alignmentStartedAt;
    if (!aligned.ok || aligned.alignment?.provider !== "sensevoice-character-timestamps") throw new Error(`${voiceId}: timestamp alignment unavailable`);
    const events = aligned.visemes || [];
    const audioMs = result.samples.length / result.sampleRate * 1000;
    const gaps = events.slice(1).map((event, index) => event.timeMs - events[index].timeMs);
    const shapes = [...new Set(events.map((event) => event.shape))];
    const missingShapes = requiredShapes.filter((shape) => !shapes.includes(shape));
    if (missingShapes.length) throw new Error(`${voiceId}: missing ${missingShapes.join(",")}`);
    // The exact timeline may contain two close targets inside one diphthong.
    // Renderer-level stabilization enforces the 52 ms visible dwell; here we
    // only require the source timestamp sequence itself to remain monotonic.
    if (events.some((event, index) => event.timeMs < 0 || event.timeMs > audioMs || (index > 0 && event.timeMs <= events[index - 1].timeMs))) throw new Error(`${voiceId}: invalid event timeline`);
    reports.push({
      voiceId,
      synthesisMs: Math.round(synthesisMs),
      alignmentMs: Math.round(alignmentMs),
      audioMs: Math.round(audioMs),
      eventCount: events.length,
      minimumEventGapMs: Math.min(...gaps),
      shapes,
      missingShapes,
      fallbackAlignment: result.alignment,
      alignment: aligned.alignment,
    });
  }
  console.log(JSON.stringify({ ok: true, text, warmup: { ...warmup, durationMs: Math.round(warmupMs) }, reports }, null, 2));
})().finally(() => speech.close()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
