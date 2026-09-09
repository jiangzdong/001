import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createQwen3TtsProvider } = require("../electron/qwen3-tts-provider.cjs");
const root = process.env.QWEN3_TTS_DEV_ROOT || "";

test("real legacy Qwen worker is safely correlated by the single active job and process generation", { skip: !root, timeout: 120000 }, async () => {
  const provider = createQwen3TtsProvider({
    platform: "darwin",
    arch: "arm64",
    allowUntrustedDevelopment: true,
    developmentResource: {
      pythonPath: path.join(root, ".venv-qwen3-tts/bin/python"),
      workerPath: path.join(root, "scripts/qwen3_tts_worker.py"),
      modelPath: path.join(root, "models/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit"),
      resourceVersion: "explicit-real-worker-integration",
    },
  });
  try {
    const checked = await provider.refresh();
    assert.equal(checked.ready, true);
    assert.equal(checked.untrustedDevelopment, true);
    const chunks = [];
    const result = await provider.synthesize({ text: "您好，欢迎使用小安语音服务。", requestId: "real-worker-integration", onChunk: (chunk) => chunks.push(chunk) });
    assert.equal(result.ok, true);
    assert.equal(result.engineUsed, "qwen3-tts");
    assert.equal(result.workerGeneration, 1);
    assert.equal(result.segmentation, "existing-punctuation-segmentation-v1");
    assert.ok(chunks.length > 0);
    assert.ok(chunks.every((chunk) => chunk.sampleRate === 24000 && chunk.samples.length > 0));
    assert.ok(result.metrics.every((metric) => metric.termination_reason === "eos"));
    assert.equal(provider.status().actualUsed, "qwen3-tts");
  } finally { provider.close(); }
});
