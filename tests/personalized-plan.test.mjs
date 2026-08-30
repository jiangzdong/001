import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessmentQuestions } from "../src/skills/healthAssessment.js";
import { buildPersonalizedHealthPlan, PLAN_RULES } from "../src/skills/personalizedHealthPlan.js";

const scenarios = JSON.parse(await readFile(new URL("../test-data/assessment-plan-scenarios.json", import.meta.url), "utf8"));

function answersFor(scenario) {
  return assessmentQuestions.map((question) => {
    const option = question.options[scenario.answers[question.id]];
    return { id: question.id, answerId: option.id, label: option.label, score: option.score };
  });
}

test("批量测试集覆盖单领域、组合领域和边界答案", () => {
  assert.ok(scenarios.length >= 16);
  assert.ok(scenarios.some((item) => Object.values(item.answers).every((value) => value === 0)));
  assert.ok(scenarios.some((item) => Object.values(item.answers).every((value) => value === 2)));
  assert.ok(scenarios.some((item) => Object.values(item.answers).filter((value) => value > 0).length >= 5));
});

test("每个测试画像得到预期等级、主领域和首要行动", () => {
  for (const scenario of scenarios) {
    const result = buildPersonalizedHealthPlan(answersFor(scenario));
    assert.equal(result.level, scenario.expectedLevel, scenario.id);
    assert.equal(result.priorities[0]?.domain || null, scenario.expectedPrimaryDomain, scenario.id);
    assert.equal(result.actions[0]?.id, scenario.expectedFirstAction, scenario.id);
    assert.equal(result.actions.length, 3, scenario.id);
    assert.equal(new Set(result.actions.map((action) => action.domain)).size, result.actions.length, scenario.id);
  }
});

test("不同领域画像产生足够多的计划组合", () => {
  const signatures = scenarios.map((scenario) => buildPersonalizedHealthPlan(answersFor(scenario)).planSignature);
  assert.ok(new Set(signatures).size >= 12, `只有 ${new Set(signatures).size} 种计划组合`);
  const focused = scenarios.filter((scenario) => /-focus$/.test(scenario.id));
  assert.equal(new Set(focused.map((scenario) => buildPersonalizedHealthPlan(answersFor(scenario)).actions[0].id)).size, focused.length);
});

test("计划遵循 Skill 边界且不展示内部风险评分", () => {
  const visibleCopy = Object.values(PLAN_RULES).flatMap((rule) => Object.values(rule.actions)).flatMap((action) => [action.text, action.tracking]).join("\n");
  assert.doesNotMatch(visibleCopy, /诊断|治愈|停药|换药|加量|减量|人工转接|工作人员/);
  assert.match(visibleCopy, /不自行补服或改变用量/);
  for (const scenario of scenarios) {
    const result = buildPersonalizedHealthPlan(answersFor(scenario));
    assert.deepEqual(Object.keys(result).includes("riskScore"), false);
    assert.ok(["routine", "attention"].includes(result.level));
  }
});

test("八题包含状态、频率、依从性、事件和自评类型", () => {
  assert.deepEqual(new Set(assessmentQuestions.map((question) => question.type)), new Set(["condition", "frequency", "adherence", "event-count", "self-perception"]));
  assert.equal(assessmentQuestions.filter((question) => question.domain === "mobility").length, 2);
  assert.ok(assessmentQuestions.every((question) => ["assessment", "sleep", "brain", "exercise", "rehabilitation"].includes(question.skillDomain)));
  for (const scenario of scenarios) {
    const result = buildPersonalizedHealthPlan(answersFor(scenario));
    assert.ok(result.priorities.every((priority) => ["assessment", "sleep", "brain", "exercise", "rehabilitation"].includes(priority.skillDomain)));
  }
});
