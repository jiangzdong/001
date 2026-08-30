import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { readMultipartFrameStream } = require("../electron/frame-stream.cjs");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const endpoint = process.env.DITTO_URL || "http://127.0.0.1:8788";
const audioPath = process.argv.find((value) => value.startsWith("--audio="))?.slice(8)
  || path.join(projectRoot, "ditto-validation", "xiaoa-test-voice.wav");
const cancelAfterFrames = Number(process.argv.find((value) => value.startsWith("--cancel-after-frames="))?.split("=")[1] || 0);
const reportPath = process.argv.find((value) => value.startsWith("--report="))?.slice(9) || "";
const firstFramePath = path.join(projectRoot, "ditto-validation", "local-gpu-first-frame.jpg");

const healthBefore = await fetch(`${endpoint}/health`).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}));
const capabilities = await fetch(`${endpoint}/v1/capabilities`).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}));
if (!healthBefore.body?.ok) throw new Error(`Ditto health is not ready: ${JSON.stringify(healthBefore)}`);

const wav = await fs.readFile(audioPath);
const controller = new AbortController();
const startedAt = performance.now();
let firstFrameMs = null;
let firstFrameBytes = 0;
let frameCount = 0;
let lastTimestampMs = 0;
let metadata = null;
let canceled = false;
let firstFrameWritePromise = Promise.resolve();
const milestoneWrites = [];
const savedFrames = [];

const response = await fetch(`${endpoint}/v1/render/frames`, {
  method: "POST",
  headers: { "content-type": "audio/wav" },
  body: wav,
  signal: controller.signal,
});
if (!response.ok) throw new Error(`Frame stream failed (${response.status}): ${await response.text()}`);

try {
  await readMultipartFrameStream(response, {
    onFrame: ({ bytes, timestampMs }) => {
      frameCount += 1;
      lastTimestampMs = timestampMs;
      if (firstFrameMs == null) {
        firstFrameMs = performance.now() - startedAt;
        firstFrameBytes = bytes.length;
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error("First frame is not a JPEG image");
        firstFrameWritePromise = fs.writeFile(firstFramePath, bytes);
      }
      if ([70, 90, 120, 176].includes(frameCount)) {
        const milestonePath = path.join(projectRoot, "ditto-validation", `local-gpu-frame-${frameCount}.jpg`);
        savedFrames.push({ frame: frameCount, path: milestonePath });
        milestoneWrites.push(fs.writeFile(milestonePath, bytes));
      }
      if (cancelAfterFrames > 0 && frameCount >= cancelAfterFrames) {
        canceled = true;
        controller.abort();
      }
    },
    onMetadata: (value) => { metadata = value; },
  });
} catch (error) {
  if (!(canceled && error?.name === "AbortError")) throw error;
}

const elapsedMs = performance.now() - startedAt;
await firstFrameWritePromise;
await Promise.all(milestoneWrites);
await new Promise((resolve) => setTimeout(resolve, canceled ? 500 : 50));
const healthAfter = await fetch(`${endpoint}/health`).then(async (healthResponse) => ({
  status: healthResponse.status,
  body: await healthResponse.json(),
}));
const result = {
  endpoint,
  audioPath,
  canceled,
  cancelAfterFrames,
  firstFrameMs: firstFrameMs == null ? null : Math.round(firstFrameMs),
  firstFrameBytes,
  frameCount,
  lastTimestampMs,
  elapsedMs: Math.round(elapsedMs),
  observedFps: firstFrameMs == null || elapsedMs <= firstFrameMs ? 0 : Number(((frameCount - 1) * 1000 / (elapsedMs - firstFrameMs)).toFixed(2)),
  metadata,
  firstFramePath,
  savedFrames,
  healthBefore,
  capabilities,
  healthAfter,
};
console.log(JSON.stringify(result, null, 2));
if (reportPath) await fs.writeFile(path.resolve(reportPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (frameCount < 1) process.exitCode = 2;
if (!canceled && metadata?.complete !== true) process.exitCode = 3;
if (!healthAfter.body?.ok) process.exitCode = 4;
