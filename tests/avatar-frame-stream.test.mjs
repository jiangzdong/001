import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createAvatarService } = require("../electron/avatar-service.cjs");
const { boundaryFromContentType, createMultipartFrameParser } = require("../electron/frame-stream.cjs");

function part(boundary, contentType, payload, headers = {}) {
  const bytes = Buffer.from(payload);
  const lines = [`--${boundary}`, `Content-Type: ${contentType}`, `Content-Length: ${bytes.length}`, ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`)];
  return Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`), bytes, Buffer.from("\r\n")]);
}

function frameStreamBody(boundary = "test-frame") {
  return Buffer.concat([
    part(boundary, "image/jpeg", Buffer.from([1, 2, 3]), { "X-Frame-Index": "0", "X-Frame-Timestamp-Ms": "0" }),
    part(boundary, "image/jpeg", Buffer.from([4, 5, 6, 7]), { "X-Frame-Index": "1", "X-Frame-Timestamp-Ms": "40" }),
    part(boundary, "application/json", Buffer.from('{"frameCount":2,"renderSeconds":0.8}')),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
}

test("multipart frame parser survives arbitrary network chunk boundaries", () => {
  const frames = [];
  const metadata = [];
  const body = frameStreamBody();
  const parser = createMultipartFrameParser({ boundary: "test-frame", onFrame: (frame) => frames.push(frame), onMetadata: (value) => metadata.push(value) });
  for (let index = 0; index < body.length; index += 7) parser.push(body.subarray(index, index + 7), index + 7 >= body.length);
  assert.equal(parser.isFinished(), true);
  assert.deepEqual(frames.map((frame) => [frame.index, frame.timestampMs, [...frame.bytes]]), [[0, 0, [1, 2, 3]], [1, 40, [4, 5, 6, 7]]]);
  assert.equal(metadata[0].frameCount, 2);
  assert.equal(boundaryFromContentType('multipart/x-mixed-replace; boundary="test-frame"'), "test-frame");
});

test("avatar service emits synthesized audio before real JPEG frames and completion", async () => {
  const body = frameStreamBody();
  const events = [];
  const service = createAvatarService({
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v1\/render\/frames$/);
      assert.equal(options.headers["Content-Type"], "audio/wav");
      return new Response(new ReadableStream({
        start(controller) {
          for (let index = 0; index < body.length; index += 11) controller.enqueue(body.subarray(index, index + 11));
          controller.close();
        },
      }), { status: 200, headers: { "Content-Type": "multipart/x-mixed-replace; boundary=test-frame" } });
    },
  });
  const result = await service.streamText({
    text: "帧流测试",
    voiceId: "zh-ll-2",
    speed: 1,
    turnId: "frame-turn-1",
    synthesize: async () => ({ ok: true, samples: new Float32Array([0, 0.1, -0.1]), sampleRate: 16000, visemes: [{ timeMs: 0, shape: "A" }] }),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.frameStreaming, true);
  assert.equal(result.transport, "multipart-jpeg");
  assert.equal(result.frameCount, 2);
  assert.deepEqual(events.map((event) => event.type), ["audio", "frame", "frame", "complete"]);
});

test("frame endpoint absence is reported as unsupported instead of an MP4 success", async () => {
  const events = [];
  const service = createAvatarService({ fetchImpl: async () => new Response("missing", { status: 404 }) });
  const result = await service.streamText({
    text: "旧服务降级测试", turnId: "frame-turn-2",
    synthesize: async () => ({ ok: true, samples: new Float32Array([0, 0.1]), sampleRate: 16000 }),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, false);
  assert.equal(result.unsupported, true);
  assert.deepEqual(events.map((event) => event.type), ["audio", "error"]);
});

test("cloud and renderer contracts expose actual frames instead of labeling MP4 as streaming", async () => {
  const [cloud, pipeline, app, preload, main] = await Promise.all([
    readFile(new URL("../ditto-validation/cloud/ditto_api.py", import.meta.url), "utf8"),
    readFile(new URL("../ditto-validation/ditto-source/stream_pipeline_offline.py", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(cloud, /@app\.post\("\/v1\/render\/frames"\)/);
  assert.match(cloud, /"frameStreaming": True/);
  assert.match(cloud, /multipart\/x-mixed-replace/);
  assert.match(pipeline, /self\.frame_callback\(res_frame_rgb\)/);
  assert.match(app, /createImageBitmap/);
  assert.match(app, /synthesizeSpeechStream\(segment/);
  assert.match(app, /preparedSpeech = segments\.map\(prepareNativeSegment\)[\s\S]*playPreparedSegment\(preparedSegment/);
  assert.match(app, /pendingFrame = event[\s\S]*pumpLatestFrame\(\)/);
  assert.match(app, /medianInterval <= 160[\s\S]*if \(!realtimeFrameReady\) return/);
  assert.match(app, /frameTimestampMs \+ 180 < playbackElapsedMs/);
  assert.match(app, /cancelAvatarTurn\?\.\(turnId\)/);
  assert.doesNotMatch(app, /const bufferedFrames = frames\.splice\(0\)/);
  assert.match(cloud, /DITTO_SAMPLING_STEPS[\s\S]*"12"/);
  assert.match(cloud, /DITTO_MAX_SIZE[\s\S]*"1280"/);
  assert.match(preload, /avatar:stream-event/);
  assert.match(main, /avatar:render-stream/);
});
