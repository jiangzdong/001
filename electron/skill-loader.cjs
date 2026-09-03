const fs = require("fs");
const path = require("path");

const DOMAIN_FILES = {};

function inferDomain() { return "general"; }

function createSkillLoader({ app }) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "skills", "health-general-guidance-v1")
    : path.join(app.getAppPath(), "skills", "health-general-guidance-v1");

  function readRelative(relativePath) {
    const fullPath = path.resolve(root, relativePath);
    if (!fullPath.startsWith(`${path.resolve(root)}${path.sep}`) && fullPath !== path.resolve(root)) throw new Error("Skill 文件路径不安全");
    return fs.readFileSync(fullPath, "utf8");
  }

  function load({ domain, text = "", includeSafety = false, includeOffTopic = false } = {}) {
    const selectedDomain = "general";
    const files = ["SKILL.md"];
    return {
      domain: selectedDomain,
      files,
      content: files.map((file) => `\n## Runtime source: ${file}\n${readRelative(file)}`).join("\n"),
    };
  }

  return { load, inferDomain, root };
}

module.exports = { createSkillLoader, inferDomain, DOMAIN_FILES };
