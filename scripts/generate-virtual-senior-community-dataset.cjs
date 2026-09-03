"use strict";
// Produces immutable QA-only NDJSON shards. It is intentionally never called
// by Electron startup. Buffered output avoids materialising millions of records.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createCommunityDataset, entityRecord, PROFILES } = require("../electron/harness/virtual-senior-community-dataset.cjs");

function arg(name, fallback) { const item = process.argv.find((value) => value.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : fallback; }
function writeShard(root, entity, count, dataset) {
  const file = path.join(root, `${entity}.ndjson`);
  const descriptor = fs.openSync(file, "wx", 0o600);
  const digest = crypto.createHash("sha256");
  let bytes = 0; let buffer = "";
  const flush = () => { if (!buffer) return; const chunk = Buffer.from(buffer, "utf8"); fs.writeSync(descriptor, chunk); digest.update(chunk); bytes += chunk.length; buffer = ""; };
  try {
    for (let index = 0; index < count; index += 1) { buffer += `${JSON.stringify(entityRecord(dataset, entity, index))}\n`; if (buffer.length >= 1024 * 1024) flush(); }
    flush();
  } finally { fs.closeSync(descriptor); }
  return { entity, records: count, bytes, sha256: `sha256:${digest.digest("hex")}`, file: path.basename(file) };
}

const profile = arg("profile", "community-full");
const seed = Number(arg("seed", "104729"));
const out = path.resolve(arg("out", path.join(process.cwd(), "QA-EXTERNAL", "virtual-senior-community", `dataset-${profile}-${seed}`)));
if (!Object.hasOwn(PROFILES, profile)) throw new Error("invalid profile");
if (fs.existsSync(out)) throw new Error(`refuse to overwrite existing QA dataset: ${out}`);
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const dataset = createCommunityDataset({ profile, seed });
try {
  const shards = Object.entries(dataset.entityCounts).map(([entity, count]) => writeShard(out, entity, count, dataset));
  const totalBytes = shards.reduce((sum, item) => sum + item.bytes, 0);
  const manifest = { ...dataset, outputClassification: "QA-EXTERNAL-only", totalBytes, shards, generationCommand: `node scripts/generate-virtual-senior-community-dataset.cjs --profile=${profile} --seed=${seed}` };
  const normalized = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = `sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
  fs.writeFileSync(path.join(out, "community-manifest.json"), normalized, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(out, "hash-list.json"), `${JSON.stringify({ manifestSha256, shards: shards.map(({ entity, file, records, bytes, sha256 }) => ({ entity, file, records, bytes, sha256 })) }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out, residents: dataset.residents, totalRecords: dataset.totalRecords, totalBytes, manifestHash: dataset.manifestHash, manifestSha256, shardCount: shards.length })}\n`);
} catch (error) {
  fs.writeFileSync(path.join(out, "generation-failed.json"), `${JSON.stringify({ message: error?.message || String(error) }, null, 2)}\n`, { mode: 0o600 });
  throw error;
}
