const fs = require("fs");
const path = require("path");
const sharp = require(process.env.XIAOAN_SHARP_MODULE || "sharp");

const root = path.resolve(__dirname, "..");
const assets = path.join(root, "public", "assets");
const outputDir = path.resolve(process.env.XIAOAN_QA_DIR || path.join(root, "qa", "facial-assets-v1.4.13"));
const masterName = "xiaoa-ditto-master-v1.0.3.png";
const visemes = ["rest", "a", "e", "o", "u", "f", "l", "s", "sh"];
const regions = {
  leftNasolabial: { left: 380, top: 425, width: 35, height: 27 },
  rightNasolabial: { left: 527, top: 425, width: 35, height: 27 },
  mouthCore: { left: 402, top: 454, width: 138, height: 70 },
};

const meanAbsoluteDifference = (left, right) => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / left.length;
};

async function rawRegion(file, region) {
  return sharp(path.join(assets, file)).extract(region).removeAlpha().raw().toBuffer();
}

(async () => {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), master: masterName, regions, frames: {}, failures: [] };
  const master = {};
  for (const [name, region] of Object.entries(regions)) master[name] = await rawRegion(masterName, region);
  for (const label of visemes) {
    const file = `xiaoa-viseme-${label}-v4.png`;
    const metrics = {};
    for (const [name, region] of Object.entries(regions)) metrics[name] = meanAbsoluteDifference(master[name], await rawRegion(file, region));
    report.frames[label.toUpperCase()] = metrics;
    if (metrics.leftNasolabial > 0.08 || metrics.rightNasolabial > 0.08) report.failures.push(`${label}:nasolabial-drift`);
    if (["a", "e", "o", "u"].includes(label) && metrics.mouthCore < 2.5) report.failures.push(`${label}:mouth-shape-missing`);
  }
  report.result = report.failures.length ? "FAIL" : "PASS";
  const reportPath = path.join(outputDir, "report.json");
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ reportPath, result: report.result, failures: report.failures, frames: report.frames }, null, 2));
  if (report.failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
