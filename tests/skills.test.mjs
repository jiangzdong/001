import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assessmentQuestions, calculateAssessmentResult } from "../src/skills/healthAssessment.js";
import { skillCatalog } from "../src/skills/index.js";
import { reportContent } from "../src/skills/reportExplanation.js";

test("skill catalog exposes the three project capabilities", () => {
  assert.deepEqual(skillCatalog.map((skill) => skill.id), [
    "health-assessment",
    "report-explanation",
    "health-action-plan",
  ]);
  assert.equal(new Set(skillCatalog.map((skill) => skill.entryScreen)).size, 3);
});

test("Harness active station skills are complete and exclude the legacy questionnaire", async () => {
  const names = [
    "station-advisor-global-v2",
    "station-public-info-v1",
    "member-self-service-v1",
    "identity-and-permission-v1",
    "health-general-guidance-v1",
  ];
  for (const name of names) {
    const content = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /TODO/);
  }
  const general = await readFile(new URL("../skills/health-general-guidance-v1/SKILL.md", import.meta.url), "utf8");
  assert.doesNotMatch(general, /有限轮次合同|语音与选项必须等价|七个业务领域/);
});

test("assessment remains an eight-question, two-level flow", () => {
  assert.equal(assessmentQuestions.length, 8);
  assert.equal(calculateAssessmentResult([]).level, "routine");

  const priorityAnswer = [{ id: "fall", label: "有过多次", score: 2 }];
  assert.equal(calculateAssessmentResult(priorityAnswer).level, "attention");
  assert.deepEqual(Object.keys(reportContent).sort(), ["attention", "routine"]);
});

test("generic health-management skill is older-adult focused and prototype independent", async () => {
  const entry = await readFile(new URL("../skills/health-management-v1/SKILL.md", import.meta.url), "utf8");
  const sources = await readFile(new URL("../skills/health-management-v1/references/权威资料与更新规则.md", import.meta.url), "utf8");

  assert.match(entry, /60岁及以上老年人/);
  assert.doesNotMatch(entry, /src\/skills|healthAssessment|八道题|总分\s*[≥>]/);
  assert.match(sources, /nhc\.gov\.cn/);
  assert.match(sources, /who\.int/);
  assert.match(sources, /cnsoc\.org/);
});

test("adaptive dialogue skill keeps turns finite and supports voice-touch equivalence", async () => {
  const entry = await readFile(new URL("../skills/health-management-adaptive-dialogue-v3/SKILL.md", import.meta.url), "utf8");
  const interaction = await readFile(new URL("../skills/health-management-adaptive-dialogue-v3/references/语音与选项等价交互.md", import.meta.url), "utf8");
  const protocol = await readFile(new URL("../skills/health-management-adaptive-dialogue-v3/references/简短方案与结构化协议.md", import.meta.url), "utf8");

  assert.match(entry, /最多 \*\*5个关键问题\*\*/);
  assert.match(entry, /意图澄清最多 \*\*1次\*\*/);
  assert.match(entry, /语音自由回答与触控选项回答/);
  assert.match(interaction, /两者必须产生相同语义结果/);
  assert.match(protocol, /"allow_voice": true/);
  assert.match(protocol, /行动不超过三项/);
});

test("three retained skill generations expose explicit major versions", async () => {
  const v1 = await readFile(new URL("../skills/health-management-v1/SKILL.md", import.meta.url), "utf8");
  const v2 = await readFile(new URL("../skills/health-management-multidomain-v2/SKILL.md", import.meta.url), "utf8");
  const v3 = await readFile(new URL("../skills/health-management-adaptive-dialogue-v3/SKILL.md", import.meta.url), "utf8");
  const index = await readFile(new URL("../skills/SKILL-VERSIONS.md", import.meta.url), "utf8");

  assert.match(v1, /version: "1\.0\.0"/);
  assert.match(v2, /version: "2\.4\.0"/);
  assert.match(v3, /version: "3\.0\.0"/);
  assert.match(index, /V1\.0\.0[\s\S]*V2\.4\.0[\s\S]*V3\.0\.0/);
});

test("multidomain v2.4 adopts concise answers, elastic limits, and varied redirection", async () => {
  const entry = await readFile(new URL("../skills/health-management-multidomain-v2/SKILL.md", import.meta.url), "utf8");
  const output = await readFile(new URL("../skills/health-management-multidomain-v2/references/输出模板与追踪指标.md", import.meta.url), "utf8");
  const turns = await readFile(new URL("../skills/health-management-multidomain-v2/references/有限轮次与结束条件.md", import.meta.url), "utf8");
  const offTopic = await readFile(new URL("../skills/health-management-multidomain-v2/references/非健康话题简答与引导.md", import.meta.url), "utf8");

  assert.match(entry, /通常不超过80个汉字/);
  assert.match(entry, /一至三项优先行动/);
  assert.match(entry, /用户明确要求完整方案时才展开模板/);
  assert.match(output, /默认使用简版/);
  assert.match(entry, /以5至8个关键问题为建议范围/);
  assert.match(entry, /单题最多澄清2次，全程最多澄清4次/);
  assert.match(entry, /最多问到12个关键问题/);
  assert.match(turns, /主要目标或领域澄清 \| 最多2次/);
  assert.match(turns, /建议5至8个，最多12个/);
  assert.match(turns, /继续完善/);
  assert.match(turns, /语音重试、停顿、自我修正和无效识别不计入关键问题数量/);
  assert.match(turns, /经过验证的量表/);
  assert.match(entry, /非健康或弱相关问题通常不超过两句/);
  assert.match(entry, /最近三次不连续复用相同句式/);
  assert.match(offTopic, /简答句/);
  assert.match(offTopic, /健康测评不是非健康问题的默认出口/);
  assert.match(offTopic, /连续两轮不得使用相同 `redirect_style`/);
});
