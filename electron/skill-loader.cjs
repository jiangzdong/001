const fs = require("fs");
const path = require("path");

const DOMAIN_FILES = {
  assessment: "references/domains/健康评测.md",
  glucose: "references/domains/血糖管理.md",
  massage: "references/domains/按摩健康指导.md",
  rehabilitation: "references/domains/康复管理.md",
  sleep: "references/domains/睡眠健康.md",
  brain: "references/domains/脑健康.md",
  exercise: "references/domains/运动康复.md",
};

function inferDomain(text = "") {
  if (/(血糖|低血糖|餐后糖|空腹糖)/.test(text)) return "glucose";
  if (/(按摩|按揉|推拿|穴位)/.test(text)) return "massage";
  if (/(康复|术后|辅具|功能训练)/.test(text)) return "rehabilitation";
  if (/(睡眠|失眠|睡不着|夜里.{0,4}醒|半夜.{0,4}醒|早醒)/.test(text)) return "sleep";
  if (/(记忆|记性|认知|健忘|脑健康)/.test(text)) return "brain";
  if (/(运动|锻炼|散步|平衡|力量训练)/.test(text)) return "exercise";
  return "assessment";
}

function createSkillLoader({ app }) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "skills", "health-management-multidomain-v2")
    : path.join(app.getAppPath(), "skills", "health-management-multidomain-v2");

  function readRelative(relativePath) {
    const fullPath = path.resolve(root, relativePath);
    if (!fullPath.startsWith(`${path.resolve(root)}${path.sep}`) && fullPath !== path.resolve(root)) throw new Error("Skill 文件路径不安全");
    return fs.readFileSync(fullPath, "utf8");
  }

  function load({ domain, text = "", includeSafety = false, includeOffTopic = false } = {}) {
    const selectedDomain = DOMAIN_FILES[domain] ? domain : inferDomain(text);
    const files = ["SKILL.md", DOMAIN_FILES[selectedDomain]];
    if (includeSafety) files.push("references/公共安全与禁忌.md");
    if (includeOffTopic) files.push("references/非健康话题简答与引导.md");
    return {
      domain: selectedDomain,
      files,
      content: files.map((file) => `\n## Runtime source: ${file}\n${readRelative(file)}`).join("\n"),
    };
  }

  return { load, inferDomain, root };
}

module.exports = { createSkillLoader, inferDomain, DOMAIN_FILES };
