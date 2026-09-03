import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createSkillLoader, inferDomain } = require("../electron/skill-loader.cjs");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loader = createSkillLoader({ app: { isPackaged: false, getAppPath: () => projectRoot } });

test("运行时只加载站点产品的通用健康 Skill", () => {
  const sleep = loader.load({ text: "我半夜总是醒" });
  assert.equal(sleep.domain, "general");
  assert.deepEqual(sleep.files, ["SKILL.md"]);
  assert.match(sleep.content, /普通健康咨询/);
  assert.doesNotMatch(sleep.content, /有限轮次合同|七个业务领域/);
});

test("旧领域参数不再改变运行时 Skill", () => {
  const result = loader.load({ domain: "assessment", includeSafety: true, includeOffTopic: true });
  assert.equal(inferDomain("饭后血糖有点高"), "general");
  assert.deepEqual(result.files, ["SKILL.md"]);
});
