const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targets = ["models", "dist", "electron", "skills"].map((name) => path.join(root, name));

function directorySize(target) {
  if (!fs.existsSync(target)) return 0;
  const stats = fs.statSync(target);
  if (stats.isFile()) return stats.size;
  return fs.readdirSync(target, { withFileTypes: true }).reduce((total, entry) => total + directorySize(path.join(target, entry.name)), 0);
}

function collect(target, depth = 0) {
  if (!fs.existsSync(target)) return [];
  const stats = fs.statSync(target);
  if (stats.isFile()) return [{ path: path.relative(root, target), bytes: stats.size }];
  const direct = fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
    const filename = path.join(target, entry.name);
    return { path: path.relative(root, filename), bytes: directorySize(filename), directory: entry.isDirectory() };
  });
  if (depth > 0) return direct;
  return direct.flatMap((entry) => entry.directory ? [entry, ...collect(path.join(root, entry.path), depth + 1)] : [entry]);
}

const entries = targets.flatMap((target) => collect(target)).sort((a, b) => b.bytes - a.bytes);
const report = {
  generatedAt: new Date().toISOString(),
  totalBytes: targets.reduce((total, target) => total + directorySize(target), 0),
  groups: Object.fromEntries(targets.map((target) => [path.basename(target), directorySize(target)])),
  largest: entries.slice(0, 20),
  note: "离线 ASR/TTS 模型是功能资源。只有在产品确认减少音色或改为联网下载后才能删除。",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
