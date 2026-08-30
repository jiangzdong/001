import assert from "node:assert/strict";
import test from "node:test";
import { createIncrementalSpeechSegmenter, createSpeechChunkQueue, createSpeechTurnId, splitSpeechSegments } from "../src/streamingSpeech.js";

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
