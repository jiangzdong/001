import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createRuntimeTelemetry, sanitizeMetrics } = require("../electron/telemetry.cjs");

test("telemetry rejects health text and keeps numeric timing fields", () => {
  assert.deepEqual(sanitizeMetrics({ durationMs: 125.6789, ok: true, transcript: "我胸口疼", status: "ok" }), {
    durationMs: 125.679,
    ok: true,
    status: "ok",
  });
});

test("telemetry writes bounded JSON lines without dialogue content", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoan-telemetry-"));
  try {
    const telemetry = createRuntimeTelemetry({ directory, maxBytes: 256, memoryEntries: 2 });
    telemetry.record("asr", "complete", { durationMs: 100, ok: true, transcript: "隐私文本" });
    telemetry.record("tts", "complete", { durationMs: 200, ok: true });
    telemetry.record("avatar", "error", { durationMs: 300, ok: false });
    assert.equal(telemetry.snapshot().length, 2);
    const files = fs.readdirSync(directory);
    assert.ok(files.some((name) => name.startsWith("runtime-metrics.jsonl")));
    const combined = files.map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("\n");
    assert.doesNotMatch(combined, /隐私文本/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
