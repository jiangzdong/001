import assert from "node:assert/strict";
import test from "node:test";
import { assessmentQuestions } from "../src/skills/healthAssessment.js";
import { detectSafetySignal, localInterpretAssessment } from "../src/assessmentUnderstanding.js";

const question = (id) => assessmentQuestions.find((item) => item.id === id);

test("自由口语可映射到结构化答案，不依赖固定关键词 includes", () => {
  assert.equal(localInterpretAssessment({ question: question("sleep"), text: "我这几天半夜老醒，醒了就难睡" }).answerId, "sleep-poor");
  assert.equal(localInterpretAssessment({ question: question("selfRating"), text: "身体也就凑合吧" }).answerId, "self-average");
  assert.equal(localInterpretAssessment({ question: question("activity"), text: "最近基本没怎么动，也不太出门" }).answerId, "activity-rare");
});

test("否定句与数字表达不会反向误判", () => {
  assert.equal(localInterpretAssessment({ question: question("fall"), text: "一次都没摔过" }).answerId, "fall-none");
  assert.equal(localInterpretAssessment({ question: question("medicine"), text: "我一次都没忘过吃药" }).answerId, "medicine-on-time");
  assert.equal(localInterpretAssessment({ question: question("fall"), text: "摔过两次" }).answerId, "fall-multiple");
});

test("歧义回答进入一次澄清并最多给两个候选", () => {
  const first = localInterpretAssessment({ question: question("sleep"), text: "有时候吧，说不好" });
  assert.equal(first.needsClarification, true);
  assert.ok(first.candidates.length <= 2);
  const repeated = localInterpretAssessment({ question: question("sleep"), text: "还是不清楚", clarificationAttempt: 1 });
  assert.match(repeated.clarificationPrompt, /点击最接近/);
});

test("危险信号优先于普通答案映射", () => {
  const signal = detectSafetySignal("昨晚睡得还行，但现在胸口剧烈疼痛");
  assert.equal(signal.type, "chest");
  const result = localInterpretAssessment({ question: question("sleep"), text: "睡得很好，但是喘不上气" });
  assert.equal(result.answerId, null);
  assert.equal(result.safetySignal.type, "breathing");
  assert.equal(detectSafetySignal("我没有胸痛，睡得还可以"), null);
});

test("AI 不可用时本地理解仍返回可解释的置信度与依据", () => {
  const result = localInterpretAssessment({ question: question("walking"), text: "偶尔走路会打晃" });
  assert.equal(result.source, "local");
  assert.equal(result.answerId, "walking-occasional");
  assert.ok(result.confidence >= .8);
  assert.match(result.rationale, /口语语义/);
});
