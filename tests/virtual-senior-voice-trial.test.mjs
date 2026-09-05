import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createVirtualSeniorVoiceTrial, speechSegments } = require("../electron/harness/virtual-senior-voice-trial.cjs");
const { REAL_ASR_PROVIDER } = require("../electron/harness/virtual-senior-asr-gate.cjs");
const { validateRoundTranscript } = require("../electron/harness/virtual-senior-voice-oracle.cjs");
const { manifestPayloadSha256, validateFixtureManifest } = require("../electron/harness/virtual-senior-voice-regression.cjs");
const question = "最新健康体征，是什么时候记录的？";
const pcm = () => ({ ok: true, samples: Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 8) * 0.1), sampleRate: 16000 });
const receipt = ({ audio }) => ({ ended: true, contextState: "running", muted: false, playedMs: audio.durationMs });
function fixture(overrides = {}) {
  const calls = [];
  const speech = { status: () => ({ ready: true }), synthesize: async (input) => { calls.push(["tts", input]); return pcm(); }, recognize: async () => ({ ok: true, text: question.slice(0, -1), provider: REAL_ASR_PROVIDER, trustedFinal: true }), cancelTurn: (id) => calls.push(["cancel", id]), ...overrides };
  return { speech, calls };
}
const input = (extra = {}) => ({ roundId: "vitals", question, turnId: "unit-voice-1", respond: async (text) => ({ answer: { speechText: "这是一条合成回复。" }, recognizedInput: text }), ...extra });

test("service detail requires spoken first-item context and reservation, while dependency retains the first service id", () => {
  assert.equal(validateRoundTranscript("service-detail", "刚才列出的第一项服务开放时间和预约要求是什么？").valid, true);
  assert.deepEqual(validateRoundTranscript("service-detail", "刚才列出的服务开放时间和预约要求是什么？").missing, ["第一项"]);
  assert.deepEqual(validateRoundTranscript("service-detail", "刚才列出的第一项服务开放时间是什么？").missing, ["预约"]);
});

test("knowledge, history and replay keep their specific business terms", () => {
  assert.equal(validateRoundTranscript("knowledge", "服务的使用说明在哪里？").valid, true);
  assert.deepEqual(validateRoundTranscript("knowledge", "服务的使用说命在哪里？").missing, ["使用说明"]);
  assert.equal(validateRoundTranscript("history", "查看近半年健康体征的记录。").valid, true);
  assert.deepEqual(validateRoundTranscript("history", "查看近半年健康体重的记录。").missing, ["健康体征"]);
  assert.equal(validateRoundTranscript("save-replay", "请重新提交刚才那份合成草稿，确认不会重复保存。").valid, true);
  assert.deepEqual(validateRoundTranscript("save-replay", "请提交刚才那份合成草稿，确认不会重复保存。").missing, ["重新提交"]);
});

test("immutable PCM fixture fails closed for duplicate rounds, wrong oracle, missing audio and SHA tampering", () => {
  const directory = path.resolve("QA-EXTERNAL/virtual-senior-community/voice-regression-v1");
  const source = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assert.doesNotThrow(() => validateFixtureManifest(source, directory));
  const altered = (change) => { const copy = structuredClone(source); change(copy); copy.integrity.payloadSha256 = manifestPayloadSha256(copy); return copy; };
  assert.throws(() => validateFixtureManifest(altered((m) => { m.entries[1].roundId = m.entries[0].roundId; }), directory), { code: "FIXTURE_ROUND_INVALID" });
  assert.throws(() => validateFixtureManifest(altered((m) => { m.oracleVersion = "wrong"; }), directory), { code: "FIXTURE_ORACLE_VERSION_INVALID" });
  assert.throws(() => validateFixtureManifest(altered((m) => { m.entries[0].pcmPath = "audio/missing.f32"; }), directory));
  assert.throws(() => validateFixtureManifest(altered((m) => { m.entries[0].sha256 = "0".repeat(64); }), directory), { code: "FIXTURE_PCM_SHA_MISMATCH" });
});

test("mandatory voice trial uses actual recognized text and records each stage, no PCM in report", async () => {
  const { speech, calls } = fixture();
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test" }).runRound(input());
  assert.equal(report.status, "passed");
  assert.equal(report.required, true);
  assert.equal(report.evidenceMode, "unit-test");
  assert.equal(report.microphone, "not-verified");
  assert.equal(report.acousticOutput, "not-verified");
  assert.equal(report.response.recognizedInput, question.slice(0, -1));
  assert.ok(Object.values(report.stages).every((s) => s.status === "passed"));
  assert.equal(calls.filter(([kind]) => kind === "tts").length, 2);
  assert.match(report.stages["question-tts"].audio.sha256, /^[a-f0-9]{64}$/);
  assert.ok(JSON.stringify(report).length < 5000);
});

for (const [name, options, code, status] of [
  ["missing models", { status: () => ({ ready: false }) }, "VOICE_MODELS_UNAVAILABLE", "blocked"],
  ["failed TTS", { synthesize: async () => ({ ok: false, message: "模型失败" }) }, "VOICE_SYNTHESIS_UNAVAILABLE", "blocked"],
  ["silent TTS", { synthesize: async () => ({ ...pcm(), samples: new Float32Array(1600) }) }, "VOICE_AUDIO_SILENT", "failed"],
  ["invalid PCM", { synthesize: async () => ({ ...pcm(), samples: Float32Array.from({ length: 1600 }, () => NaN) }) }, "VOICE_AUDIO_INVALID", "failed"],
  ["untrusted ASR", { recognize: async () => ({ ok: true, text: question, provider: "fake", trustedFinal: false }) }, "VOICE_ASR_UNAVAILABLE", "blocked"],
  ["wrong ASR", { recognize: async () => ({ ok: true, text: "天气怎么样", provider: REAL_ASR_PROVIDER, trustedFinal: true }) }, "VOICE_ASR_MISMATCH", "failed"],
  ["critical health term with low CER", { recognize: async () => ({ ok: true, text: question.replace("体征", "体重"), provider: REAL_ASR_PROVIDER, trustedFinal: true }) }, "VOICE_ASR_CRITICAL_TERMS", "failed"],
]) test(`${name} never invokes text fallback or passes mandatory speech`, async () => {
  const { speech } = fixture(options);
  let responses = 0;
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test" }).runRound(input({ respond: async () => { responses++; return "不应调用"; } }));
  assert.equal(report.status, status);
  assert.equal(report.error.code, code);
  assert.equal(responses, 0);
  assert.equal(report.stages["answer-playback"].status, "blocked");
  assert.ok(!Object.values(report.stages).some((s) => s.status === "not-run"));
});

for (const [name, playAudio] of [["no player", undefined], ["muted", (audio) => ({ ...receipt(audio), muted: true })], ["suspended", (audio) => ({ ...receipt(audio), contextState: "suspended" })], ["unfinished", (audio) => ({ ...receipt(audio), ended: false })], ["short", (audio) => ({ ...receipt(audio), playedMs: 1 })]]) test(`playback ${name} blocks speech completion`, async () => {
  const { speech } = fixture();
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio, evidenceMode: "unit-test" }).runRound(input());
  assert.equal(report.status, "blocked");
  assert.ok(report.error.code.startsWith("VOICE_PLAYBACK"));
});

test("real evidence rejects instantaneous playback receipts", async () => {
  const { speech } = fixture();
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt }).runRound(input());
  assert.equal(report.error.code, "VOICE_PLAYBACK_UNCONFIRMED");
  assert.equal(report.status, "blocked");
});

test("long answers are fully synthesized and played in bounded segments without truncation", async () => {
  const { speech, calls } = fixture();
  const answer = "合成健康记录，不作诊断。".repeat(110);
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test" }).runRound(input({ respond: async () => answer }));
  assert.equal(report.status, "passed");
  const texts = calls.filter(([kind]) => kind === "tts").slice(1).map(([, value]) => value.text);
  assert.equal(texts.join(""), answer);
  assert.ok(texts.every((text) => text.length <= 420));
  assert.equal(report.stages["answer-playback"].clips.length, texts.length);
  assert.equal(speechSegments(answer).join(""), answer);
});

test("cancel returns promptly during ASR and ignores its late result", async () => {
  const abort = new AbortController();
  let responses = 0, finishAsr;
  const { speech, calls } = fixture({ recognize: () => new Promise((resolve) => { finishAsr = resolve; abort.abort(); }) });
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test" }).runRound(input({ signal: abort.signal, respond: async () => { responses++; return "不能调用"; } }));
  assert.equal(report.status, "cancelled");
  finishAsr({ ok: true, text: question, provider: REAL_ASR_PROVIDER, trustedFinal: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(responses, 0);
  assert.ok(calls.some(([kind]) => kind === "cancel"));
});

test("a hanging stage times out rather than being skipped", async () => {
  const { speech } = fixture({ recognize: () => new Promise(() => {}) });
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test", timeoutMs: 25 }).runRound(input());
  assert.equal(report.status, "blocked");
  assert.equal(report.error.code, "VOICE_STAGE_TIMEOUT");
});

test("late synthesis cannot mutate a timed-out report", async () => {
  let late;
  const { speech } = fixture({ synthesize: () => new Promise((resolve) => { late = resolve; }) });
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test", timeoutMs: 20 }).runRound(input());
  const snapshot = JSON.stringify(report);
  late(pcm());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(report), snapshot);
});

test("partial long-answer playback cannot be marked fully passed", async () => {
  let count = 0;
  const { speech } = fixture({ synthesize: async () => ++count === 3 ? { ok: false } : pcm() });
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test" }).runRound(input({ respond: async () => "合成记录。".repeat(200) }));
  assert.equal(report.status, "blocked");
  assert.equal(report.stages["answer-playback"].status, "blocked");
  assert.equal(report.stages["answer-playback"].reason, "ANSWER_INCOMPLETE");
});

test("sensitive ASR is not retained in reports or passed to a responder", async () => {
  const text = "手机13800138000";
  const { speech } = fixture({ recognize: async () => ({ ok: true, text, provider: REAL_ASR_PROVIDER, trustedFinal: true }) });
  const report = await createVirtualSeniorVoiceTrial({ speech, playAudio: receipt, evidenceMode: "unit-test" }).runRound(input());
  assert.equal(report.error.code, "VOICE_SENSITIVE_TRANSCRIPT");
  assert.ok(!JSON.stringify(report).includes("13800138000"));
});
