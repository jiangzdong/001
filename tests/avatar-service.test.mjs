import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createAvatarService, encodePcm16Wave, renderKey } = require("../electron/avatar-service.cjs");

test("avatar service encodes mono PCM16 WAV", () => {
  const wav = encodePcm16Wave(new Float32Array([-1, 0, 1]), 16000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 50);
});

test("avatar status degrades safely when the cloud is unreachable", async () => {
  const avatar = createAvatarService({ fetchImpl: async () => { throw new Error("offline"); } });
  const status = await avatar.status();
  assert.equal(status.ready, false);
  assert.equal(status.message, "本机 GPU 数字人服务未连接");
  assert.equal(status.consecutiveFailures, 1);
  assert.equal(status.circuitOpen, false);
});

test("avatar circuit opens after repeated cloud failures and advertises local fallback", async () => {
  let calls = 0;
  const avatar = createAvatarService({ fetchImpl: async () => { calls += 1; throw new Error("offline"); } });
  await avatar.status();
  await avatar.status();
  const third = await avatar.status();
  assert.equal(third.circuitOpen, true);
  const result = await avatar.render({ samples: new Float32Array([0, 0.1]), sampleRate: 16000 });
  assert.equal(result.ok, false);
  assert.equal(result.circuitOpen, true);
  assert.match(result.message, /音频口型/);
  assert.equal(calls, 3);
});

test("render identity is stable across whitespace and numeric speed forms", () => {
  const first = renderKey({ text: "您好，  我是小安。", voiceId: "zh-ll-2", speed: 1 });
  const second = renderKey({ text: " 您好， 我是小安。 ", voiceId: "zh-ll-2", speed: "1.000" });
  assert.equal(first, second);
});

test("same text requests share one synthesis and one cloud render", async () => {
  let synthCalls = 0;
  let fetchCalls = 0;
  const video = new Uint8Array(2048).fill(7);
  const service = createAvatarService({
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      assert.match(options.headers["X-Render-Key"], /^[0-9a-f]{64}$/);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(video, { status: 200, headers: { "Content-Type": "video/mp4", "X-Render-Seconds": "1.2" } });
    },
  });
  const synthesize = async () => {
    synthCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, samples: new Float32Array([0, 0.1]), sampleRate: 16000 };
  };
  const payload = { text: "同一条健康提示", voiceId: "zh-ll-2", speed: 1, synthesize };
  const [first, second] = await Promise.all([service.renderText(payload), service.renderText(payload)]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.deduplicated, true);
  assert.equal(synthCalls, 1);
  assert.equal(fetchCalls, 1);
});

test("disk cache survives service recreation and skips non-deterministic TTS", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoan-avatar-test-"));
  let synthCalls = 0;
  let fetchCalls = 0;
  const synthesize = async () => ({ ok: true, samples: new Float32Array([0, ++synthCalls / 10]), sampleRate: 16000 });
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response(new Uint8Array(2048).fill(9), { status: 200, headers: { "Content-Type": "video/mp4" } });
  };
  try {
    const options = { cacheDir, fetchImpl };
    const first = await createAvatarService(options).renderText({ text: "持久缓存测试", voiceId: "zh-ll-2", speed: 1, synthesize });
    const second = await createAvatarService(options).renderText({ text: " 持久缓存测试 ", voiceId: "zh-ll-2", speed: "1.0", synthesize });
    assert.equal(first.ok, true);
    assert.equal(second.cacheTier, "local");
    assert.equal(second.synthSeconds, 0);
    assert.equal(synthCalls, 1);
    assert.equal(fetchCalls, 1);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("a turn cancellation aborts its in-flight cloud request", async () => {
  let aborted = false;
  const service = createAvatarService({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }),
  });
  const pending = service.renderText({
    text: "这段数字人播报应该被新一轮对话取消。",
    voiceId: "zh-ll-2",
    speed: 1,
    turnId: "turn-cancel-test",
    synthesize: async () => ({ ok: true, samples: new Float32Array([0, 0.1]), sampleRate: 16000 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(service.cancelTurn("turn-cancel-test"), true);
  const result = await pending;
  assert.equal(aborted, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
});
