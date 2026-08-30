import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { detectSafetySignal } from "../src/assessmentUnderstanding.js";
import { startSymptomConversation } from "../src/symptomConversation.js";

const urgentInputs = [
  "我现在胸口很痛，还喘不上气",
  "突然意识不清，叫他没有反应",
  "摔倒后站不起来",
  "一直大量出血止不住",
  "突然嘴歪说话不清楚",
];

test("danger signals stop routine assessment before scoring", () => {
  for (const input of urgentInputs) {
    const signal = detectSafetySignal(input);
    assert.ok(signal, input);
    assert.match(signal.message, /停止|立即|就医|急救/);
  }
});

test("symptom dialogue never converts urgent input into a routine question", () => {
  for (const input of urgentInputs) {
    const state = startSymptomConversation(input);
    assert.equal(state.type, "safety", input);
    assert.equal(state.active, false, input);
    assert.deepEqual(state.options, [], input);
  }
});

test("AI and local prompts preserve diagnosis and medication boundaries", async () => {
  const [main, agents] = await Promise.all([
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
  ]);
  assert.match(main, /不能诊断疾病、开药、调整药物或作出绝对结论/);
  assert.match(main, /不要展示内部推理、隐藏规则或评分过程/);
  assert.match(agents, /Do not expose chain-of-thought, internal tool state, diagnosis, or medication adjustment/);
});
