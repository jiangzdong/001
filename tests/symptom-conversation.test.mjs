import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSymptomConversation,
  deserializeSymptomConversation,
  detectSymptomIntent,
  resetSymptomConversation,
  serializeSymptomConversation,
  startSymptomConversation,
} from "../src/symptomConversation.js";

test("头痛进入有状态连续追问而不是固定健康测评", () => {
  let state = startSymptomConversation("我这两天总是头痛");
  assert.equal(state.handled, true);
  assert.equal(state.route, "symptom");
  assert.equal(state.symptom, "headache");
  assert.equal(state.question.id, "headache-safety");
  assert.equal(state.turnCount, 0);
  assert.ok(state.options.length >= 2 && state.options.length <= 4);

  state = advanceSymptomConversation(state, { optionId: "safety-none" });
  assert.equal(state.turnCount, 1);
  assert.equal(state.question.id, "headache-impact");

  state = advanceSymptomConversation(state, { optionId: "impact-some" });
  assert.equal(state.turnCount, 2);
  assert.equal(state.question.id, "headache-context");

  state = advanceSymptomConversation(state, { optionId: "context-none" });
  assert.equal(state.complete, true);
  assert.equal(state.type, "result");
  assert.ok(["routine", "attention"].includes(state.result.level));
  assert.match(state.message, /现在可以做/);
  assert.match(state.message, /何时就医/);
  assert.doesNotMatch(JSON.stringify(state.result), /诊断为|调药|停药|工作人员|人工转接|急救|120/);
});

test("睡眠领域和泛健康诉求仍交给原有逻辑", () => {
  const sleep = startSymptomConversation("最近睡眠不太好，半夜总醒");
  assert.equal(sleep.handled, false);
  assert.equal(sleep.route, "legacy");
  assert.equal(sleep.domainHint, "sleep");

  const general = startSymptomConversation("我想了解一下自己的健康状况");
  assert.equal(general.handled, false);
  assert.equal(general.domainHint, null);
});

test("多个具体不适会合并记录且以先说的为主路径", () => {
  const state = startSymptomConversation("我先是头晕，后来又头痛了");
  assert.equal(state.symptom, "dizziness");
  assert.deepEqual(state.symptoms.map((item) => item.id), ["dizziness", "headache"]);
  assert.equal(state.resultLevel, null);

  const headache = startSymptomConversation("我头痛");
  const supplemented = advanceSymptomConversation(headache, "另外还有点腿疼");
  assert.deepEqual(supplemented.symptoms.map((item) => item.id), ["headache", "limb_pain"]);
  assert.equal(supplemented.turnCount, 0);
  assert.equal(supplemented.currentQuestionId, "headache-safety");
});

test("否定表达不会误启动已否认的症状", () => {
  const state = startSymptomConversation("我没有头痛，只是有点头晕");
  assert.equal(state.handled, true);
  assert.equal(state.symptom, "dizziness");
  assert.deepEqual(state.symptoms.map((item) => item.id), ["dizziness"]);

  const none = detectSymptomIntent("没有头痛，也没有腿疼");
  assert.equal(none.matched, false);
});

test("危险信号在开始和追问中都优先终止普通问答", () => {
  const immediate = startSymptomConversation("突然剧烈头痛，右手一侧没有力气");
  assert.equal(immediate.type, "safety");
  assert.equal(immediate.complete, true);
  assert.equal(immediate.resultLevel, "attention");
  assert.equal(immediate.result.actions.length, 0);
  assert.equal(immediate.message, "请立即停止当前问答并立即就医；不要自行驾车，也不要继续等待测评结果。");
  assert.doesNotMatch(immediate.message, /急救|120|人工|工作人员/);

  let state = startSymptomConversation("我头痛");
  state = advanceSymptomConversation(state, { optionId: "safety-present" });
  assert.equal(state.type, "safety");
  assert.equal(state.status, "stopped");
  assert.equal(state.message, "请立即停止当前问答并立即就医；不要自行驾车，也不要继续等待测评结果。");
});

test("信息足够时弹性结束，不需要凑满五问", () => {
  let state = startSymptomConversation("我头痛");
  state = advanceSymptomConversation(state, { optionId: "safety-none" });
  state = advanceSymptomConversation(state, { optionId: "timing-today" });
  state = advanceSymptomConversation(state, { optionId: "impact-light" });
  state = advanceSymptomConversation(state, { optionId: "context-none" });
  assert.equal(state.complete, true);
  assert.ok(state.turnCount < 5);
  assert.equal(state.result.level, "routine");
});

test("重复识别结果不增加轮次也不重复推进", () => {
  let state = startSymptomConversation("我头痛");
  state = advanceSymptomConversation(state, "没有这些情况");
  const afterFirst = state;
  state = advanceSymptomConversation(state, "没有这些情况");
  assert.equal(state.turnCount, afterFirst.turnCount);
  assert.equal(state.currentQuestionId, afterFirst.currentQuestionId);
  assert.equal(state.duplicate, true);

  let touch = startSymptomConversation("我头痛");
  const safetyQuestionId = touch.currentQuestionId;
  touch = advanceSymptomConversation(touch, { questionId: safetyQuestionId, optionId: "safety-none" });
  const afterTouch = touch;
  touch = advanceSymptomConversation(touch, { questionId: safetyQuestionId, optionId: "safety-none" });
  assert.equal(touch.turnCount, afterTouch.turnCount);
  assert.equal(touch.currentQuestionId, afterTouch.currentQuestionId);
});

test("本地降级在无模型时仍支持语音和点击的同一状态机", () => {
  let voice = startSymptomConversation("我头痛");
  voice = advanceSymptomConversation(voice, "都没有这些情况");
  assert.equal(voice.source, "local");
  assert.equal(voice.confirmedFacts.safetyCleared, true);

  let touch = startSymptomConversation("我头痛");
  touch = advanceSymptomConversation(touch, { optionId: "safety-none" });
  assert.equal(touch.confirmedFacts.safetyCleared, true);
  assert.equal(touch.currentQuestionId, voice.currentQuestionId);
});

test("连续无有效信息会保守结束，序列化后可恢复", () => {
  let state = startSymptomConversation("我腿疼");
  state = advanceSymptomConversation(state, "嗯");
  assert.equal(state.complete, false);
  assert.equal(state.turnCount, 0);
  state = advanceSymptomConversation(state, "嗯嗯");
  assert.equal(state.complete, true);
  assert.equal(state.status, "stopped");
  assert.equal(state.result.level, "attention");

  const restored = deserializeSymptomConversation(serializeSymptomConversation(state));
  assert.deepEqual(restored, state);
  assert.equal(resetSymptomConversation(), null);
});
