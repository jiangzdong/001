#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { canonicalJson } = require("../electron/qwen3-tts-provider.cjs");

const root = path.resolve(process.argv[2] || "");
const privateKeyPath = path.resolve(process.argv[3] || "");
const resourceVersion = String(process.argv[4] || "1.0.0").trim();
if (!process.argv[2] || !process.argv[3] || !resourceVersion) {
  throw new Error("用法：node scripts/build-qwen3-tts-resource-manifest.cjs <资源目录> <Ed25519私钥> <资源版本>");
}

async function walk(directory = root) {
  const output = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`资源包禁止符号链接：${filename}`);
    if (entry.isDirectory()) output.push(...await walk(filename));
    else if (entry.isFile() && entry.name !== "qwen3-tts-resource-manifest.json") output.push(filename);
  }
  return output;
}

function sha256(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const filenames = (await walk()).sort();
  const files = [];
  for (const filename of filenames) {
    files.push({ path: path.relative(root, filename).split(path.sep).join("/"), sha256: await sha256(filename) });
  }
  const unsigned = {
    version: "qwen3-tts-resource-pack-v1",
    resourceVersion,
    platform: "darwin",
    arch: "arm64",
    modelPath: "model",
    workerPath: "worker/qwen3_tts_worker.py",
    pythonPath: "runtime/bin/python3.12",
    files,
  };
  const privateKey = await fsp.readFile(privateKeyPath, "utf8");
  const manifest = { ...unsigned, signature: crypto.sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64") };
  await fsp.writeFile(path.join(root, "qwen3-tts-resource-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ root, resourceVersion, files: files.length })}\n`);
}

main().catch((cause) => { process.stderr.write(`${cause?.stack || cause}\n`); process.exitCode = 1; });
