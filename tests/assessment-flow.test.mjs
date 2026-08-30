import assert from "node:assert/strict";
import test from "node:test";
import { advanceAssessment } from "../src/assessmentFlow.js";
import { assessmentQuestions } from "../src/skills/healthAssessment.js";

test("八题连续推进由本地状态机负责且每题只记录一次", () => {
  let state = { questionIndex: 0, answers: [] };
  for (let index = 0; index < assessmentQuestions.length; index += 1) {
    const next = advanceAssessment({ questions: assessmentQuestions, ...state, option: assessmentQuestions[index].options[index % 3] });
    assert.equal(next.answers.length, index + 1);
    assert.equal(next.complete, index === assessmentQuestions.length - 1);
    state = next;
  }
  assert.equal(state.answers.length, 8);
  assert.equal(new Set(state.answers.map((answer) => answer.id)).size, 8);
  assert.ok(state.answers.every((answer) => answer.answerId && Number.isInteger(answer.score)));
});

test("模型不能通过答案载荷改写本地分值", () => {
  const question = assessmentQuestions[0];
  const forged = { ...question.options[0], score: 99, label: "伪造答案" };
  const next = advanceAssessment({ questions: assessmentQuestions, questionIndex: 0, answers: [], option: forged });
  assert.equal(next.answers[0].score, 0);
  assert.equal(next.answers[0].label, "睡得很好");
});
