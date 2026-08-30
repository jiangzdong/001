import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createSkillLoader, inferDomain } = require("../electron/skill-loader.cjs");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loader = createSkillLoader({ app: { isPackaged: false, getAppPath: () => projectRoot } });

test("多领域 Skill 根据当前问题只加载主文件和一个领域参考", () => {
  const sleep = loader.load({ text: "我半夜总是醒" });
  assert.equal(sleep.domain, "sleep");
  assert.deepEqual(sleep.files, ["SKILL.md", "references/domains/睡眠健康.md"]);
  assert.match(sleep.content, /老年健康多领域管理/);
  assert.match(sleep.content, /睡眠健康/);
  assert.doesNotMatch(sleep.content, /## Runtime source: references\/domains\/血糖管理\.md/);
});

test("测评安全场景按需额外加载公共安全文件但不加载全部资料", () => {
  const assessment = loader.load({ domain: "assessment", includeSafety: true });
  assert.equal(assessment.files.length, 3);
  assert.ok(assessment.files.includes("references/domains/健康评测.md"));
  assert.ok(assessment.files.includes("references/公共安全与禁忌.md"));
  assert.ok(assessment.files.every((file) => !file.includes("血糖管理")));
});

test("普通对话加载 V2 非健康话题简答与去重复规则", () => {
  const chat = loader.load({ text: "今天星期几", includeOffTopic: true });
  assert.ok(chat.files.includes("references/非健康话题简答与引导.md"));
  assert.match(chat.content, /先尊重并回应用户/);
  assert.match(chat.content, /最近三次不得输出完全相同的引导句/);
  assert.match(chat.content, /健康测评不是非健康问题的默认出口/);
});

test("七领域路由可识别典型用户表达", () => {
  assert.equal(inferDomain("饭后血糖有点高"), "glucose");
  assert.equal(inferDomain("想做平衡训练"), "exercise");
  assert.equal(inferDomain("最近记性差"), "brain");
});
