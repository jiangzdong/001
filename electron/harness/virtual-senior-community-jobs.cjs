"use strict";

// QA-only, persisted job runner.  Community data is generated outside the
// renderer and never becomes a production Fixture fallback or packaged asset.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function safe(value, prefix) { const clean = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96); return clean || `${prefix}-${crypto.randomUUID()}`; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }

function createCommunityJobRunner({ projectRoot, reportRoot, nodePath, now = () => Date.now(), allowTestFaultInjection = false, testFaultStage = "" } = {}) {
  if (!projectRoot || !reportRoot || !nodePath) throw new Error("community job runner configuration missing");
  const jobs = new Map();
  fs.mkdirSync(reportRoot, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(reportRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { const job = readJson(path.join(reportRoot, entry.name, "job-manifest.json")); jobs.set(job.jobId, job); } catch {}
  }
  const active = new Map();
  const injectedStage = allowTestFaultInjection && ["generating", "validating", "sweeping"].includes(testFaultStage) ? testFaultStage : "";
  function persist(job) { const directory = path.join(reportRoot, job.jobId); fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); job.reportDirectory = directory; writeJson(path.join(directory, "job-manifest.json"), job); }
  function run(script, args, job, stage) {
    return new Promise((resolve, reject) => {
      const child = spawn(nodePath, [path.join(projectRoot, script), ...args], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      active.set(job.jobId, child);
      job.activePid = child.pid; job.stage = stage; job.status = "running"; job.progress = { stage, completed: job.completedStages.length, total: 3 }; persist(job);
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject); child.once("close", (code) => { active.delete(job.jobId); job.activePid = null; if (code === 0) resolve(stdout); else reject(Object.assign(new Error(stderr || `job stage ${stage} failed`), { code: "COMMUNITY_JOB_STAGE_FAILED" })); });
    });
  }
  function stageDirectory(job, stage) { job.stageAttempts ||= {}; const attempt = job.stageAttempts[stage] || 1; return path.join(job.reportDirectory, `${stage}-${attempt}`); }
  function injectTestFaultOnce(job, stage) {
    if (!injectedStage || injectedStage !== stage || job.qaFaultInjected?.[stage]) return;
    job.stage = stage; job.status = "running"; job.progress = { stage, completed: job.completedStages.length, total: 3 };
    job.qaFaultInjected ||= {}; job.qaFaultInjected[stage] = true; persist(job);
    throw Object.assign(new Error(`QA test-mode injected failure at ${stage}`), { code: "QA_INJECTED_STAGE_FAILURE" });
  }
  function stopForControl(job) { if (job.cancelRequested) { job.status = "cancelled"; job.stage = "cancelled"; job.completedAt = new Date(now()).toISOString(); persist(job); return true; } if (job.pauseRequested) { job.status = "paused"; job.stage = "paused"; job.pausedAt = new Date(now()).toISOString(); persist(job); return true; } return false; }
  async function start(input = {}) {
    const profile = ["smoke", "regression", "community-full", "stress"].includes(input.profile) ? input.profile : "community-full";
    const seed = Number.isFinite(Number(input.seed)) ? Number(input.seed) : 104729;
    const cohort = input.cohort && typeof input.cohort === "object" ? input.cohort : {};
    const jobId = safe(input.jobId || `community-${profile}-${now()}`, "community");
    if (jobs.get(jobId)?.status === "running") throw Object.assign(new Error("社区 QA 作业正在运行"), { code: "COMMUNITY_JOB_ACTIVE" });
    const existing = jobs.get(jobId);
    const job = existing || { jobVersion: "1.1.0", jobId, profile, seed, cohort, dataClassification: "synthetic-test-only", status: "queued", stage: "queued", progress: { stage: "queued", completed: 0, total: 3 }, createdAt: new Date(now()).toISOString(), reports: {}, errors: [], completedStages: [], stageAttempts: {} };
    job.profile = profile; job.seed = seed; job.cohort = cohort; job.pauseRequested = false; job.cancelRequested = false; job.completedStages ||= []; job.stageAttempts ||= {}; jobs.set(jobId, job); persist(job);
    const cohortJson = JSON.stringify(cohort);
    try {
      if (!job.completedStages.includes("generating")) { const datasetDirectory = stageDirectory(job, "generating"); injectTestFaultOnce(job, "generating"); await run("scripts/generate-virtual-senior-community-dataset.cjs", [`--profile=${profile}`, `--seed=${seed}`, `--out=${datasetDirectory}`], job, "generating"); job.reports.datasetManifest = path.join(datasetDirectory, "community-manifest.json"); job.completedStages.push("generating"); job.progress.completed = job.completedStages.length; persist(job); if (stopForControl(job)) return publicJob(job); }
      if (!job.completedStages.includes("validating")) { injectTestFaultOnce(job, "validating"); await run("scripts/validate-virtual-senior-community-dataset.cjs", [`--out=${path.dirname(job.reports.datasetManifest)}`], job, "validating"); job.reports.validation = path.join(path.dirname(job.reports.datasetManifest), "validation-report.json"); job.completedStages.push("validating"); job.progress.completed = job.completedStages.length; persist(job); if (stopForControl(job)) return publicJob(job); }
      if (!job.completedStages.includes("sweeping")) { const sweepDirectory = stageDirectory(job, "sweeping"); injectTestFaultOnce(job, "sweeping"); await run("scripts/run-virtual-senior-community-tool-sweep.cjs", [`--profile=${profile}`, `--seed=${seed}`, `--cohort=${cohortJson}`, `--out=${sweepDirectory}`], job, "sweeping"); job.reports.toolSweep = path.join(sweepDirectory, "tool-sweep-report.json"); job.completedStages.push("sweeping"); job.progress.completed = job.completedStages.length; persist(job); if (stopForControl(job)) return publicJob(job); }
      const validation = readJson(job.reports.validation); const sweep = readJson(job.reports.toolSweep);
      job.summary = { generated: true, validated: validation.valid === true, residents: validation.residents, totalRecords: validation.totalRecords, totalBytes: validation.totalBytes, manifestHash: validation.manifestHash, entityReports: validation.shardReports, fieldCoverage: validation.coverage, invariants: validation.invariants, matrix: sweep.totals, stateMatrix: sweep.matrix, dimensions: sweep.dimensions, residentSweep: sweep.residentSweep, pagination: sweep.pagination, idempotency: sweep.idempotency, valid: validation.valid === true && sweep.valid === true };
      job.status = job.summary.valid ? "completed" : "failed"; job.stage = job.summary.valid ? "validated" : "failed"; job.completedAt = new Date(now()).toISOString(); persist(job);
    } catch (error) { if (job.cancelRequested) { const interruptedStage = job.stage; job.stageAttempts[interruptedStage] = (job.stageAttempts[interruptedStage] || 1) + 1; job.status = "cancelled"; job.stage = "cancelled"; } else { const failedStage = job.stage; job.status = "failed"; job.stage = "failed"; job.failedStage = failedStage; job.stageAttempts[failedStage] = (job.stageAttempts[failedStage] || 1) + 1; job.errors.push({ code: error?.code || "COMMUNITY_JOB_FAILED", message: error?.message || String(error), stage: failedStage }); } job.completedAt = new Date(now()).toISOString(); persist(job); }
    return publicJob(job);
  }
  function publicJob(job) { if (!job) return null; return structuredClone(job); }
  function pause(jobId) { const job = jobs.get(String(jobId || "")); if (!job || job.status !== "running") return false; job.pauseRequested = true; persist(job); return true; }
  function cancel(jobId) { const job = jobs.get(String(jobId || "")); if (!job || job.status !== "running") return false; job.cancelRequested = true; active.get(job.jobId)?.kill("SIGTERM"); persist(job); return true; }
  function resume(jobId) { const job = jobs.get(String(jobId || "")); if (!job || !["paused", "cancelled", "failed"].includes(job.status)) throw Object.assign(new Error("社区作业不可恢复"), { code: "COMMUNITY_JOB_NOT_RESUMABLE" }); return start({ jobId: job.jobId, profile: job.profile, seed: job.seed, cohort: job.cohort }); }
  function rerunFailed(jobId) { const job = jobs.get(String(jobId || "")); if (!job || job.status !== "failed" || !job.failedStage) throw Object.assign(new Error("没有可重跑的失败阶段"), { code: "COMMUNITY_JOB_NO_FAILED_STAGE" }); job.completedStages = job.completedStages.filter((stage) => stage !== job.failedStage); job.stageAttempts[job.failedStage] = (job.stageAttempts[job.failedStage] || 1) + 1; persist(job); return resume(job.jobId); }
  return { cancel, latest: () => publicJob([...jobs.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1)), pause, rerunFailed, resume, start, status: (jobId) => publicJob(jobs.get(String(jobId || ""))) };
}

module.exports = { createCommunityJobRunner };
