import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const { buildVisemeUnits, createAlignedVisemes, createTimedVisemes, initialViseme, splitTtsProgressText, vowelViseme, vowelVisemes } = require("../electron/viseme-timeline.cjs");

test("streamed PCM batches retain only their matching spoken clauses", () => {
  assert.deepEqual(
    splitTtsProgressText("阿姨微笑着说，啊，诶，哦，乌，", 2),
    ["阿姨微笑着说，啊，", "诶，哦，", "乌，"],
  );
  assert.deepEqual(splitTtsProgressText("一句完整回答。", 2), ["一句完整回答。"]);
});

test("Mandarin initials cover the complete ten-shape mouth library", () => {
  assert.equal(initialViseme(["ㄅ", "ㄚ"]), "CLOSED");
  assert.equal(initialViseme(["f", "a"]), "F");
  assert.equal(initialViseme(["ㄌ", "ㄜ"]), "L");
  assert.equal(initialViseme(["x", "iao"]), "S");
  assert.equal(initialViseme(["sh", "ir"]), "SH");
  assert.equal(vowelViseme(["w", "o"]), "O");
  assert.equal(vowelViseme(["ㄩ"]), "U");
  assert.equal(vowelViseme(["ㄧ"]), "E");
});

test("zh-ll Bopomofo finals and Mandarin diphthongs map to the spoken mouth movement", () => {
  assert.deepEqual(vowelVisemes(["ㄢ", "ˉ"]), ["A"], "安 must visibly use A");
  assert.deepEqual(vowelVisemes(["ㄏ", "ㄠ", "ˇ"]), ["A", "O"], "好 must move from A to O");
  assert.deepEqual(vowelVisemes(["ㄨ", "ㄛ", "ˇ"]), ["O"], "我 uses W onset followed by O final");
  assert.deepEqual(vowelVisemes(["ㄕ", "ㄥ", "ˉ"]), ["E"], "声 uses a central E-family final");
  assert.deepEqual(vowelVisemes(["ㄕ", "ˋ"]), ["E"], "事 has an apical vowel even when zh-ll omits the final token");
  assert.deepEqual(vowelVisemes(["ㄋ", "ㄩ", "ˇ"]), ["U"]);
  assert.deepEqual(vowelVisemes(["h", "ao", "3"]), ["A", "O"]);
  assert.deepEqual(vowelVisemes(["x", "iao", "3"]), ["E", "O"]);
});

test("the bundled default Chinese TTS lexicon has complete visible-final coverage", () => {
  for (const relativePath of ["../models/sherpa-onnx-vits-zh-ll/lexicon.txt"]) {
    const lexicon = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    const unknown = [];
    let total = 0;
    for (const line of lexicon.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || [...parts[0]].length !== 1 || !/[\u3400-\u9fff]/u.test(parts[0])) continue;
      total += 1;
      if (vowelVisemes(parts.slice(1)).every((shape) => shape === "REST")) unknown.push(parts[0]);
    }
    assert.ok(total > 20_000);
    assert.deepEqual(unknown, [], relativePath);
  }
});

test("viseme units preserve punctuation as a real closed-mouth pause", () => {
  const pronunciations = new Map([
    ["发", ["f", "a"]],
    ["知", ["zh", "ir"]],
  ]);
  const shapes = buildVisemeUnits("发，知", pronunciations).map((unit) => unit.shape);
  assert.deepEqual(shapes, ["CLOSED", "F", "A", "CLOSED", "SH", "E", "CLOSED"]);
});

test("PCM alignment returns monotonic timestamped discrete events and acoustic silence anchors", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(900);
  for (let index = 100; index < 350; index += 1) samples[index] = Math.sin(index * 0.2) * 0.25;
  for (let index = 480; index < 780; index += 1) samples[index] = Math.sin(index * 0.17) * 0.22;
  const pronunciations = new Map([
    ["发", ["f", "a"]],
    ["知", ["zh", "ir"]],
  ]);
  const events = createTimedVisemes("发，知", pronunciations, samples, sampleRate);
  assert.equal(events[0].shape, "CLOSED");
  assert.equal(events.at(-1).shape, "CLOSED");
  assert.ok(events.some((event) => event.shape === "A"));
  assert.ok(events.some((event) => event.shape === "E"));
  assert.ok(events.every((event, index) => index === 0 || event.timeMs > events[index - 1].timeMs));
  assert.ok(events.every((event) => event.timeMs >= 0 && event.timeMs <= 900));
  assert.ok(events.slice(1).every((event, index) => event.timeMs - events[index].timeMs >= 140));
});

test("a short streamed syllable retains its vowel before the closing pose", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(336);
  for (let index = 20; index < 310; index += 1) samples[index] = Math.sin(index * 0.2) * 0.24;
  const events = createTimedVisemes("乌，", new Map([["乌", ["ㄨ", "ˉ"]]]), samples, sampleRate);
  assert.ok(events.some((event) => event.shape === "U"));
  assert.equal(events.at(-1).shape, "CLOSED");
  assert.ok(events.every((event, index) => index === 0 || event.timeMs - events[index - 1].timeMs >= 120));
});

test("a later streamed PCM batch begins on its spoken vowel without a synthetic closed-mouth lead", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(336);
  for (let index = 10; index < 320; index += 1) samples[index] = Math.sin(index * 0.2) * 0.24;
  const events = createTimedVisemes("乌，", new Map([["乌", ["ㄨ", "ˉ"]]]), samples, sampleRate, { includeInitialClosure: false });
  assert.equal(events[0].shape, "U");
  assert.equal(events[0].timeMs, 0);
  assert.equal(events.at(-1).shape, "CLOSED");
});

test("a compact streamed phrase preserves consecutive visible vowels across punctuation", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(720);
  for (let index = 10; index < 700; index += 1) samples[index] = Math.sin(index * 0.19) * 0.24;
  const pronunciations = new Map([
    ["诶", ["ㄟ", "ˉ"]],
    ["哦", ["ㄛ", "ˊ"]],
    ["乌", ["ㄨ", "ˉ"]],
  ]);
  const events = createTimedVisemes("诶，哦，乌，", pronunciations, samples, sampleRate, { includeInitialClosure: false });
  const shapes = events.map((event) => event.shape);
  assert.ok(shapes.includes("E"));
  assert.ok(shapes.includes("O"));
  assert.ok(shapes.includes("U"));
  assert.equal(shapes.at(-1), "CLOSED");
});

test("SenseVoice character timestamps lead the audible syllable and retain sustained vowels", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(1600);
  for (let index = 80; index < 1450; index += 1) samples[index] = Math.sin(index * 0.17) * 0.24;
  const pronunciations = new Map([
    ["发", ["f", "a"]],
    ["知", ["zh", "ir"]],
  ]);
  const events = createAlignedVisemes("发知", pronunciations, samples, sampleRate, {
    tokens: ["发", "知"],
    timestamps: [0.2, 0.8],
  });
  assert.equal(events[0].shape, "CLOSED");
  assert.equal(events.at(-1).shape, "CLOSED");
  assert.ok(events.some((event) => event.shape === "A"));
  assert.ok(events.some((event) => event.shape === "E"));
  assert.ok(events.find((event) => event.shape === "A").timeMs <= 200, "visible vowel should not lag the acoustic timestamp");
  assert.ok(events.every((event, index) => index === 0 || event.timeMs > events[index - 1].timeMs));
});

test("SenseVoice timing is remapped onto the requested text after a recognition substitution", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(1800);
  for (let index = 70; index < 1700; index += 1) samples[index] = Math.sin(index * 0.13) * 0.22;
  const pronunciations = new Map([
    ["的", ["d", "e"]], ["经", ["j", "ing"]], ["验", ["y", "an"]],
    ["推", ["t", "ui"]], ["动", ["d", "ong"]],
  ]);
  const events = createAlignedVisemes("的经验推动", pronunciations, samples, sampleRate, {
    tokens: ["有", "经", "验", "推", "动"],
    timestamps: [0.18, 0.46, 0.74, 1.02, 1.3],
  });
  const finalCharacters = events.filter((event) => event.role === "final").map((event) => event.character);
  assert.deepEqual([...new Set(finalCharacters)], ["的", "经", "验", "推", "动"]);
  assert.ok(events.every((event, index) => index === 0 || event.timeMs > events[index - 1].timeMs));
});
