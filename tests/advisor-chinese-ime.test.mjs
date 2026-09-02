import test from "node:test";
import assert from "node:assert/strict";
import { advisorChineseQuickPhrases, getAdvisorChineseCandidates, normalizeAdvisorPinyin } from "../src/advisorChineseIme.js";
import { readFile } from "node:fs/promises";

test("Chinese kiosk IME normalizes touch input without retaining unsafe symbols", () => {
  assert.equal(normalizeAdvisorPinyin("Jin-Tian 123"), "jintian");
  assert.equal(normalizeAdvisorPinyin("a".repeat(40)).length, 28);
});

test("Chinese kiosk IME prioritizes exact station-domain candidates", () => {
  assert.equal(getAdvisorChineseCandidates("jintian")[0], "今天");
  assert.equal(getAdvisorChineseCandidates("badujin")[0], "八段锦");
  assert.equal(getAdvisorChineseCandidates("jiankangjiangtang")[0], "健康讲堂");
  assert.deepEqual(getAdvisorChineseCandidates(""), advisorChineseQuickPhrases);
});

test("in-app keyboard exposes a ten-key number row and touch-safe controls", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../src/AdvisorChineseKeyboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/station-advisor.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /const numberRow = \["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"\]/);
  assert.match(source, /aria-label="数字键区"/);
  assert.match(source, /label=\{`数字 \$\{number\}`\}/);
  assert.match(styles, /touch-action: manipulation/);
  assert.match(styles, /-webkit-tap-highlight-color: transparent/);
});
