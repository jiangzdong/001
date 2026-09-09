"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function encodeMonoPcm16Wav(samples, sampleRate) {
  if (!samples?.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new TypeError("Invalid PCM audio");
  const output = Buffer.allocUnsafe(44 + samples.length * 2);
  output.write("RIFF", 0); output.writeUInt32LE(36 + samples.length * 2, 4); output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write("data", 36); output.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    output.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), 44 + index * 2);
  }
  return output;
}

function createNativeAudioPlayer({ platform = process.platform, spawnProcess = spawn, writeFile = fs.writeFile, unlink = fs.unlink, tmpRoot = os.tmpdir() } = {}) {
  if (platform !== "darwin") return null;
  return async function play({ samples, sampleRate, signal } = {}) {
    const file = path.join(tmpRoot, `xiaoan-voice-${crypto.randomUUID()}.wav`);
    const startedAt = performance.now();
    await writeFile(file, encodeMonoPcm16Wav(samples, sampleRate), { mode: 0o600, flag: "wx" });
    try {
      return await new Promise((resolve, reject) => {
        const child = spawnProcess("/usr/bin/afplay", [file], { stdio: "ignore" });
        const abort = () => child.kill("SIGTERM");
        signal?.addEventListener("abort", abort, { once: true });
        child.once("error", reject);
        child.once("exit", (code, killedSignal) => {
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted || killedSignal) reject(Object.assign(new Error("原生音频播放已停止"), { code: "CANCELLED", status: "cancelled" }));
          else if (code !== 0) reject(Object.assign(new Error("macOS 原生音频播放失败"), { code: "VOICE_NATIVE_PLAYBACK_FAILED" }));
          else resolve({ ended: true, contextState: "running", muted: false, playedMs: performance.now() - startedAt, player: "macos-afplay" });
        });
      });
    } finally {
      await unlink(file).catch(() => {});
    }
  };
}

module.exports = { encodeMonoPcm16Wav, createNativeAudioPlayer };
