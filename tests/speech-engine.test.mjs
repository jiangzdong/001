import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Electron supplies the product version through process.getSystemVersion().
// Unit tests make that boundary explicit instead of comparing Darwin kernels.
process.getSystemVersion = () => "26.5.1";
const { createSpeechEngineSettings } = require("../electron/speech-engine-settings.cjs");
const { canonicalJson, createQwen3TtsProvider, macOSVersionSupported, verifyResourcePack } = require("../electron/qwen3-tts-provider.cjs");
const { createSpeechService } = require("../electron/speech-service.cjs");

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "xiaoan-speech-engine-")); }
function sha(filename) { return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"); }

function resourcePack(root, privateKey = null) {
  fs.mkdirSync(path.join(root, "model"), { recursive: true });
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "model", "weights.safetensors"), "weights");
  fs.writeFileSync(path.join(root, "worker.py"), "# worker");
  fs.writeFileSync(path.join(root, "runtime", "python"), "python");
  fs.chmodSync(path.join(root, "runtime", "python"), 0o700);
  const names = ["model/weights.safetensors", "worker.py", "runtime/python"];
  const manifest = {
    version: "qwen3-tts-resource-pack-v1", resourceVersion: "test-1", platform: "darwin", arch: "arm64",
    modelPath: "model", workerPath: "worker.py", pythonPath: "runtime/python",
    files: names.map((name) => ({ path: name, sha256: sha(path.join(root, name)) })),
  };
  if (privateKey) manifest.signature = crypto.sign(null, Buffer.from(canonicalJson(manifest)), privateKey).toString("base64");
  fs.writeFileSync(path.join(root, "qwen3-tts-resource-manifest.json"), JSON.stringify(manifest));
  return root;
}

function fakeSpawn(handler) {
  let generation = 0;
  const children = [];
  const spawn = () => {
    generation += 1;
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = () => { child.killed = true; };
    child.stdin = new Writable({ write(chunk, _encoding, done) { handler({ child, generation, request: JSON.parse(String(chunk).trim()) }); done(); } });
    children.push(child);
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({ status: "ready" })}\n`));
    return child;
  };
  return { spawn, children };
}

function pcm() { return Buffer.from(Int16Array.from([0, 1200, -1200]).buffer).toString("base64"); }
function complete(child, request, overrides = {}) {
  child.stdout.write(`${JSON.stringify({ status: "chunk", request_id: request.request_id, worker_generation: request.worker_generation, pcm_s16le_base64: pcm(), sample_rate: 24000 })}\n`);
  child.stdout.write(`${JSON.stringify({ status: "completed", request_id: request.request_id, worker_generation: request.worker_generation, metrics: { termination_reason: "eos" }, ...overrides })}\n`);
}

test("Qwen macOS compatibility uses product-version integer segments and fails closed", async () => {
  for (const version of ["26.1.9", "25.9", "25.5.0", "", "not-a-version"]) {
    assert.equal(macOSVersionSupported(version), false);
  }
  for (const version of ["26.2", "26.2.0", "26.10", "27.0"]) assert.equal(macOSVersionSupported(version), true);
  const root = resourcePack(temporary());
  let spawns = 0;
  const provider = createQwen3TtsProvider({ resourcePackPath: root, platform: "darwin", arch: "arm64", systemVersion: "26.1.9", allowUntrustedDevelopment: true, spawn: () => { spawns += 1; } });
  const state = provider.status();
  assert.equal(state.supported, false);
  assert.equal(state.code, "QWEN_UNSUPPORTED_MACOS_VERSION");
  assert.equal(state.currentMacOSVersion, "26.1.9");
  assert.equal(state.requiredMacOSVersion, "26.2.0");
  assert.equal((await provider.refresh()).code, "QWEN_UNSUPPORTED_MACOS_VERSION");
  await assert.rejects(provider.synthesize({ text: "不应启动。" }), (cause) => cause.code === "QWEN_UNSUPPORTED_MACOS_VERSION");
  assert.equal(spawns, 0);
  provider.close();
});

test("speech engine preference persists atomically and rejects qwen on Windows", () => {
  const filePath = path.join(temporary(), "speech-engine.json");
  const mac = createSpeechEngineSettings({ filePath, platform: "darwin", arch: "arm64" });
  assert.equal(mac.read().requested, "vits");
  assert.equal(mac.write("qwen3-tts").ok, true);
  assert.equal(createSpeechEngineSettings({ filePath, platform: "darwin", arch: "arm64" }).read().requested, "qwen3-tts");
  const win = createSpeechEngineSettings({ filePath, platform: "win32", arch: "x64" });
  assert.equal(win.read().requested, "vits");
  assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).requested, "vits");
  assert.equal(win.write("qwen3-tts").code, "SPEECH_ENGINE_UNSUPPORTED_PLATFORM");
  assert.equal(win.write("unknown").code, "SPEECH_ENGINE_INVALID");
});

test("resource pack is platform-bound, complete, hash verified and production-signed", async () => {
  const root = resourcePack(temporary());
  const development = await verifyResourcePack(root, { platform: "darwin", arch: "arm64", allowUntrustedDevelopment: true });
  assert.equal(development.ready, true); assert.equal(development.untrustedDevelopment, true);
  assert.equal((await verifyResourcePack(root, { platform: "darwin", arch: "arm64" })).code, "QWEN_RESOURCE_SIGNATURE_INVALID");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const signed = resourcePack(temporary(), privateKey);
  assert.equal((await verifyResourcePack(signed, { platform: "darwin", arch: "arm64", trustedPublicKeys: [publicKey] })).trust, "release-signed");
  assert.equal((await verifyResourcePack(root, { platform: "win32", arch: "x64" })).code, "QWEN_UNSUPPORTED_PLATFORM");
  fs.appendFileSync(path.join(root, "model", "weights.safetensors"), "tamper");
  assert.equal((await verifyResourcePack(root, { platform: "darwin", arch: "arm64", allowUntrustedDevelopment: true })).code, "QWEN_RESOURCE_HASH_MISMATCH");
  resourcePack(root); fs.writeFileSync(path.join(root, "undeclared.bin"), "x");
  assert.equal((await verifyResourcePack(root, { platform: "darwin", arch: "arm64", allowUntrustedDevelopment: true })).code, "QWEN_RESOURCE_MANIFEST_INCOMPLETE");
});

test("provider construction never synchronously reads or hashes the configured resource pack", () => {
  const root = resourcePack(temporary());
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (...args) => { reads += 1; return original(...args); };
  try {
    const provider = createQwen3TtsProvider({ resourcePackPath: root, platform: "darwin", arch: "arm64", allowUntrustedDevelopment: true });
    assert.equal(provider.status().configured, true);
    assert.equal(provider.status().validated, false);
    provider.close();
  } finally { fs.readFileSync = original; }
  assert.equal(reads, 0);
});

test("any declared model weight replacement after validation is rejected before spawn", async () => {
  const root = resourcePack(temporary());
  let spawns = 0;
  const provider = createQwen3TtsProvider({ resourcePackPath: root, platform: "darwin", arch: "arm64", allowUntrustedDevelopment: true, spawn: () => { spawns += 1; throw new Error("must not spawn"); } });
  assert.equal((await provider.refresh()).ready, true);
  fs.appendFileSync(path.join(root, "model", "weights.safetensors"), "replaced");
  await assert.rejects(provider.synthesize({ text: "拒绝执行。" }), (cause) => cause.code === "QWEN_RESOURCE_CHANGED_AFTER_VALIDATION");
  assert.equal(spawns, 0);
  assert.equal(provider.status().validated, false);
});

test("default VITS service startup never scans Qwen resource files", () => {
  const root = temporary();
  const qwenRoot = path.join(root, "qwen3-tts-resource-pack");
  resourcePack(qwenRoot);
  const original = fs.readFileSync;
  let qwenReads = 0;
  fs.readFileSync = (...args) => { if (String(args[0]).startsWith(qwenRoot)) qwenReads += 1; return original(...args); };
  let service;
  try {
    const app = { isPackaged: false, getAppPath: () => root, getPath: () => root };
    service = createSpeechService({ app });
    assert.equal(service.status().requested, "vits");
  } finally { service?.close(); fs.readFileSync = original; }
  assert.equal(qwenReads, 0);
});

test("qwen worker is single-resident, requests serialize and expose generation", async () => {
  const calls = [], pending = [];
  const fake = fakeSpawn(({ child, request }) => { calls.push(request); pending.push(() => complete(child, request)); });
  const provider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: fake.spawn, timeoutMs: 500, allowUntrustedDevelopment: true });
  const first = provider.synthesize({ text: "第一句。", requestId: "one" });
  const second = provider.synthesize({ text: "第二句。", requestId: "two" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.map((item) => item.request_id), ["one"]);
  pending.shift()(); await first;
  await new Promise((resolve) => setTimeout(resolve, 10)); pending.shift()();
  const result = await second;
  assert.equal(fake.children.length, 1);
  assert.equal(result.workerGeneration, 1);
  assert.equal(result.segmentation, "existing-punctuation-segmentation-v1");
  assert.ok(result.samples instanceof Float32Array);
});

test("qwen streaming releases only EOS-complete clauses without waiting for the whole answer", async () => {
  const pending = [], emitted = [];
  const fake = fakeSpawn(({ child, request }) => pending.push(() => complete(child, request)));
  const provider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: fake.spawn, timeoutMs: 500, allowUntrustedDevelopment: true });
  const work = provider.synthesize({ text: "第一句。第二句。", onChunk: (chunk) => emitted.push(chunk) });
  while (!pending.length) await new Promise((resolve) => setTimeout(resolve, 2));
  pending.shift()();
  while (!pending.length) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(emitted.length, 1);
  pending.shift()();
  const result = await work;
  assert.equal(emitted.length, 2);
  assert.equal(result.samples, undefined);
  assert.equal(result.chunkCount, 2);
});

test("qwen never retries or replays an earlier clause after streamed audio was published", async () => {
  const texts = [], emitted = [];
  const fake = fakeSpawn(({ child, request }) => {
    texts.push(request.text);
    if (texts.length === 1) complete(child, request);
    else child.stdout.write(`${JSON.stringify({ status: "failed", error: "second clause failed" })}\n`);
  });
  const provider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: fake.spawn, timeoutMs: 100, allowUntrustedDevelopment: true });
  await assert.rejects(provider.synthesize({ text: "第一句。第二句。", onChunk: (chunk) => emitted.push(chunk) }), (cause) => cause.code === "QWEN_PARTIAL_OUTPUT");
  assert.equal(texts.length, 2);
  assert.equal(texts[0], "第一句。");
  assert.equal(texts[1], "第二句。");
  assert.equal(emitted.length, 1);
  assert.equal(fake.children.length, 1);
});

test("qwen crash restarts once; a second crash opens the circuit", async () => {
  const fake = fakeSpawn(({ child }) => queueMicrotask(() => child.emit("exit", 9)));
  const provider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: fake.spawn, timeoutMs: 100, allowUntrustedDevelopment: true });
  await assert.rejects(provider.synthesize({ text: "崩溃。" }), (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  assert.equal(fake.children.length, 2);
  assert.equal(provider.status().ready, false);
  await assert.rejects(provider.synthesize({ text: "禁止继续。" }), (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  await provider.refresh({ resetCircuit: true });
  assert.equal(provider.status().circuitOpen, false);
  assert.equal(provider.status().ready, true);
});

test("a job queued before another job opens the circuit cannot punch through as generation three", async () => {
  const fake = fakeSpawn(({ child }) => queueMicrotask(() => child.emit("exit", 9)));
  const provider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: fake.spawn, timeoutMs: 100, allowUntrustedDevelopment: true });
  const first = provider.synthesize({ text: "任务甲。" });
  const alreadyQueued = provider.synthesize({ text: "任务乙。" });
  await assert.rejects(first, (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  await assert.rejects(alreadyQueued, (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  assert.equal(fake.children.length, 2);
  assert.equal(provider.status().workerGeneration, 2);
  provider.close();
});

test("circuit cooldown admits exactly one controlled recovery request", async () => {
  let clock = 1000, finishRecovery;
  const fake = fakeSpawn(({ child, generation, request }) => {
    if (generation <= 2) queueMicrotask(() => child.emit("exit", 9));
    else finishRecovery = () => complete(child, request);
  });
  const provider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: fake.spawn, timeoutMs: 100, allowUntrustedDevelopment: true, circuitCooldownMs: 100, now: () => clock });
  await assert.rejects(provider.synthesize({ text: "先熔断。" }), (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  await assert.rejects(provider.synthesize({ text: "冷却中。" }), (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  clock = 1101;
  const recovery = provider.synthesize({ text: "恢复探针。" });
  while (!finishRecovery) await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(provider.synthesize({ text: "禁止恢复风暴。" }), (cause) => cause.code === "QWEN_CIRCUIT_RECOVERY_IN_PROGRESS");
  finishRecovery();
  assert.equal((await recovery).ok, true);
  assert.equal(provider.status().circuitOpen, false);
  provider.close();
});

test("qwen timeout restarts once, isolates wrong request output and bounds its queue", async () => {
  const timeoutFake = fakeSpawn(() => {});
  const timeoutProvider = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: timeoutFake.spawn, timeoutMs: 12, allowUntrustedDevelopment: true });
  await assert.rejects(timeoutProvider.synthesize({ text: "超时。" }), (cause) => cause.code === "QWEN_CIRCUIT_OPEN");
  assert.equal(timeoutFake.children.length, 2);

  const wrongFake = fakeSpawn(({ child, request }) => {
    child.stdout.write(`${JSON.stringify({ status: "chunk", request_id: `${request.request_id}-late`, worker_generation: request.worker_generation, pcm_s16le_base64: pcm(), sample_rate: 24000 })}\n`);
  });
  const wrong = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: wrongFake.spawn, timeoutMs: 100, allowUntrustedDevelopment: true });
  await assert.rejects(wrong.synthesize({ text: "隔离迟到输出。" }), (cause) => cause.code === "QWEN_CIRCUIT_OPEN");

  const held = fakeSpawn(() => {});
  const bounded = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: held.spawn, timeoutMs: 20, maxQueue: 1, allowUntrustedDevelopment: true });
  const first = bounded.synthesize({ text: "占用队列。" });
  await assert.rejects(bounded.synthesize({ text: "超出队列。" }), (cause) => cause.code === "QWEN_QUEUE_FULL");
  await assert.rejects(first);
});

test("qwen EOS failures close output and active cancellation kills the worker", async () => {
  let activeRequest;
  const eosFake = fakeSpawn(({ child, request }) => {
    child.stdout.write(`${JSON.stringify({ status: "chunk", request_id: request.request_id, worker_generation: request.worker_generation, pcm_s16le_base64: pcm(), sample_rate: 24000 })}\n`);
    child.stdout.write(`${JSON.stringify({ status: "completed", request_id: request.request_id, worker_generation: request.worker_generation, metrics: { termination_reason: "length" } })}\n`);
  });
  const eos = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: eosFake.spawn, timeoutMs: 100, allowUntrustedDevelopment: true });
  await assert.rejects(eos.synthesize({ text: "必须完整。" }), (cause) => cause.code === "QWEN_EOS_REQUIRED");

  const cancelFake = fakeSpawn(({ request }) => { activeRequest = request; });
  const cancel = createQwen3TtsProvider({ resourcePackPath: resourcePack(temporary()), platform: "darwin", arch: "arm64", spawn: cancelFake.spawn, timeoutMs: 500, allowUntrustedDevelopment: true });
  const work = cancel.synthesize({ text: "取消我。", turnId: "turn-cancel" });
  while (!activeRequest) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(cancel.cancelTurn("turn-cancel"), true);
  await assert.rejects(work, (cause) => cause.code === "QWEN_CANCELLED");
  assert.equal(cancelFake.children[0].killed, true);
});

test("service reports explicit fallback metadata and strict mode never falls back", async () => {
  const root = temporary();
  const app = { isPackaged: false, getAppPath: () => root, getPath: () => root };
  fs.writeFileSync(path.join(root, "speech-engine.json"), JSON.stringify({ requested: "qwen3-tts" }));
  const unavailable = {
    status: () => ({ ready: false, code: "QWEN_RESOURCE_NOT_CONFIGURED", reason: "resource missing", resourceVersion: null }),
    synthesize: async () => { throw new Error("must not run"); }, cancelTurn: () => true, close: () => {},
  };
  const service = createSpeechService({ app, platform: "darwin", arch: "arm64", createQwenProvider: () => unavailable });
  assert.deepEqual(Object.fromEntries(Object.entries(service.status()).filter(([key]) => ["requested", "used", "degraded", "fallbackReason", "resourceVersion"].includes(key))), {
    requested: "qwen3-tts", used: "vits", degraded: true, fallbackReason: "resource missing", resourceVersion: null,
  });
  const normal = await service.synthesize({ text: "普通模式" });
  assert.equal(normal.engineRequested, "qwen3-tts"); assert.equal(normal.engineUsed, null); assert.equal(normal.degraded, true); assert.match(normal.fallbackReason, /QWEN_RESOURCE_NOT_CONFIGURED/);
  const strict = await service.synthesize({ text: "严格模式", strictEngine: true });
  assert.equal(strict.ok, false); assert.equal(strict.strictEngine, true); assert.equal(strict.engineUsed, null);
  service.close();

  const partialProvider = {
    status: () => ({ ready: true, resourceVersion: "test" }),
    synthesize: async ({ onChunk }) => { onChunk({ samples: new Float32Array([0.1]), sampleRate: 24000 }); throw Object.assign(new Error("second clause failed"), { code: "QWEN_EOS_REQUIRED" }); },
    cancelTurn: () => true, close: () => {},
  };
  const partialService = createSpeechService({ app, platform: "darwin", arch: "arm64", createQwenProvider: () => partialProvider });
  const partial = await partialService.synthesizeStream({ text: "第一句。第二句。" }, () => {});
  assert.equal(partial.ok, false); assert.equal(partial.partial, true); assert.equal(partial.engineUsed, "qwen3-tts");
  partialService.close();
});

test("an in-flight request freezes its selected engine and strict policy across a settings change", async () => {
  const root = temporary();
  fs.writeFileSync(path.join(root, "speech-engine.json"), JSON.stringify({ requested: "qwen3-tts" }));
  const app = { isPackaged: false, getAppPath: () => root, getPath: () => root };
  let rejectQwen;
  const qwen = {
    status: () => ({ ready: true, configured: true, validated: true, resourceVersion: "test" }),
    synthesize: () => new Promise((_resolve, reject) => { rejectQwen = reject; }),
    refresh: async () => ({ ready: true }), cancelTurn: () => true, close: () => {},
  };
  const service = createSpeechService({ app, platform: "darwin", arch: "arm64", createQwenProvider: () => qwen });
  const request = service.synthesize({ text: "冻结设置", strictEngine: true });
  while (!rejectQwen) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal((await service.setEngine("vits")).requested, "vits");
  rejectQwen(Object.assign(new Error("late failure"), { code: "QWEN_GENERATION_FAILED" }));
  const result = await request;
  assert.equal(result.ok, false);
  assert.equal(result.strictEngine, true);
  assert.equal(result.engineRequested, "qwen3-tts");
  assert.equal(result.engineUsed, null);
  service.close();
});
