const fs = require("fs");
const path = require("path");
const { compareVisemeTimelines, createMfaVisemeTimeline } = require("./lib/mfa-viseme-audit.cjs");

function argumentsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    result[key.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return result;
}

const args = argumentsMap(process.argv.slice(2));
if (!args.mfa) {
  console.error("用法: node scripts/audit-mfa-viseme-alignment.cjs --mfa <alignment.json> [--runtime <timeline.json>] [--out <report.json>]");
  process.exit(1);
}

const mfaPath = path.resolve(String(args.mfa));
const mfaDocument = JSON.parse(fs.readFileSync(mfaPath, "utf8"));
const referenceVisemes = createMfaVisemeTimeline(mfaDocument);
const report = {
  generatedAt: new Date().toISOString(),
  provider: "montreal-forced-aligner-mandarin-mfa",
  mfaPath,
  referenceVisemes,
  status: "calibration-only",
};

if (args.runtime) {
  const runtimePath = path.resolve(String(args.runtime));
  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  report.runtimePath = runtimePath;
  report.comparison = compareVisemeTimelines(referenceVisemes, runtime, {
    minimumCoverage: args["minimum-coverage"],
    maximumMedianDriftMs: args["maximum-median-drift-ms"],
    maximumP95DriftMs: args["maximum-p95-drift-ms"],
  });
  report.status = report.comparison.pass ? "pass" : "fail";
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (args.out) {
  const outputPath = path.resolve(String(args.out));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
process.stdout.write(serialized);
if (report.comparison && !report.comparison.pass) process.exitCode = 2;
