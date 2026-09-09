import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeMonoPcm16Wav, createNativeAudioPlayer } = require("../electron/native-audio-playback.cjs");

test("native macOS playback writes a valid private WAV, waits for afplay, and removes it", async () => {
  const wav = encodeMonoPcm16Wav(Float32Array.from([0, 1, -1]), 24000);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 6);
  const calls = [];
  const player = createNativeAudioPlayer({
    platform: "darwin",
    tmpRoot: "/tmp/xiaoan-native-audio-test",
    writeFile: async (file, data, options) => calls.push(["write", file, data.length, options]),
    unlink: async (file) => calls.push(["unlink", file]),
    spawnProcess: (command, args) => {
      calls.push(["spawn", command, args]);
      const child = new EventEmitter(); child.kill = () => true;
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
  });
  const receipt = await player({ samples: Float32Array.from({ length: 2400 }, (_, index) => Math.sin(index / 8) * 0.1), sampleRate: 24000 });
  assert.equal(receipt.ended, true);
  assert.equal(receipt.player, "macos-afplay");
  assert.equal(calls[0][0], "write");
  assert.deepEqual(calls[0][3], { mode: 0o600, flag: "wx" });
  assert.deepEqual(calls[1].slice(0, 2), ["spawn", "/usr/bin/afplay"]);
  assert.equal(calls.at(-1)[0], "unlink");
});

test("native playback is absent on platforms that retain renderer playback", () => {
  assert.equal(createNativeAudioPlayer({ platform: "win32" }), null);
});
