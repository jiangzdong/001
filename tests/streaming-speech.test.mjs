import assert from "node:assert/strict";
import test from "node:test";
import { createIncrementalSpeechSegmenter, createSpeechChunkQueue, createSpeechTurnId, splitSpeechSegments } from "../src/streamingSpeech.js";
import { mergeSpeechEngineRuntimeStatus, speechPlaybackOutcome } from "../src/useStationAdvisorSpeech.js";

test("long replies split at natural sentence boundaries", () => {
  const segments = splitSpeechSegments("先记录今天的血压。接下来保持规律作息，并在身体舒适时散步十分钟。最后把异常情况告诉医生。");
  assert.deepEqual(segments, [
    "先记录今天的血压。",
    "接下来保持规律作息，并在身体舒适时散步十分钟。",
    "最后把异常情况告诉医生。",
  ]);
});

test("overlong sentences split near punctuation without losing text", () => {
  const text = "今天先做轻松活动，过程中注意呼吸是否平稳，结束后休息几分钟，再记录身体感受和持续时间。";
  const segments = splitSpeechSegments(text, { minChars: 8, maxChars: 20 });
  assert.ok(segments.length >= 3);
  assert.ok(segments.every((segment) => segment.length <= 20));
  assert.equal(segments.join(""), text);
});

test("speech turn ids stay unique across sequential turns", () => {
  assert.notEqual(createSpeechTurnId(1, 1000), createSpeechTurnId(2, 1000));
  assert.match(createSpeechTurnId(3, 1000), /^turn-[a-z0-9]+-[a-z0-9]+$/);
});

test("incremental speech emits complete clauses before the response finishes", () => {
  const segmenter = createIncrementalSpeechSegmenter({ maxChars: 18 });
  assert.deepEqual(segmenter.push("先记录今天的血"), []);
  assert.deepEqual(segmenter.push("压。接下来保持规律"), ["先记录今天的血压。"]);
  assert.deepEqual(segmenter.push("作息，并适量活动。"), ["接下来保持规律作息，并适量活动。"]);
  assert.deepEqual(segmenter.flush(), []);
});

test("incremental speech preserves every character when flushed", () => {
  const text = "这是一段没有结尾标点但需要完整播报的健康提示";
  const segmenter = createIncrementalSpeechSegmenter({ maxChars: 16 });
  const segments = [...segmenter.push(text.slice(0, 9)), ...segmenter.push(text.slice(9)), ...segmenter.flush()];
  assert.equal(segments.join(""), text);
});

test("speech chunk queue preserves order and closes without a sentinel race", async () => {
  const queue = createSpeechChunkQueue();
  const first = queue.next();
  queue.push({ chunkIndex: 0 });
  queue.push({ chunkIndex: 1 });
  queue.close();
  assert.equal((await first).chunkIndex, 0);
  assert.equal((await queue.next()).chunkIndex, 1);
  assert.equal(await queue.next(), null);
});

test("a partial stream is never promoted to complete or replayed in the browser", () => {
  assert.deepEqual(speechPlaybackOutcome({ ok: false, partial: true, engineRequested: "qwen3-tts", engineUsed: "qwen3-tts" }, { played: true }), {
    complete: false,
    allowBrowserFallback: false,
    message: "语音未完整播放，请重试",
    notice: "",
  });
});

test("a reset to VITS asks for one clean replay instead of continuing mixed audio", () => {
  assert.deepEqual(speechPlaybackOutcome({ ok: false, reset: true, engineRequested: "qwen3-tts", engineUsed: "vits" }, { played: true }), {
    complete: false,
    allowBrowserFallback: false,
    message: "语音已切换轻量语音，请重新播放",
    notice: "",
  });
});

test("a complete server-side fallback remains successful and visibly identifies VITS", () => {
  assert.deepEqual(speechPlaybackOutcome({ ok: true, engineRequested: "qwen3-tts", engineUsed: "vits", fallbackReason: "worker unavailable" }), {
    complete: true,
    allowBrowserFallback: false,
    message: "",
    notice: "高质量语音暂时不可用，已切换轻量语音",
  });
});

test("a lightweight status refresh cannot erase a latched incomplete playback", () => {
  const partial = {
    engineRequested: "qwen3-tts",
    engineUsed: "vits",
    degraded: true,
    fallbackReason: "worker reset",
    incomplete: true,
  };
  const refreshed = mergeSpeechEngineRuntimeStatus({ requested: "qwen3-tts", used: "vits", degraded: true }, partial);
  assert.equal(refreshed.runtimeIncomplete, true);
  assert.equal(refreshed.fallbackReason, "worker reset");
  assert.equal(mergeSpeechEngineRuntimeStatus(refreshed, null).runtimeIncomplete, true);
  const completed = mergeSpeechEngineRuntimeStatus(refreshed, {
    engineRequested: "qwen3-tts",
    engineUsed: "qwen3-tts",
    degraded: false,
    fallbackReason: null,
    incomplete: false,
  });
  assert.equal(completed.runtimeIncomplete, false);
  assert.equal(completed.fallbackReason, null);
});
