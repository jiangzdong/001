"use strict";
// Validates immutable dataset shards without loading them in memory.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
function arg(name) { const item = process.argv.find((value) => value.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : ""; }
function sha256(file) { return new Promise((resolve, reject) => { const hash = crypto.createHash("sha256"); const input = fs.createReadStream(file); input.on("data", (chunk) => hash.update(chunk)); input.on("error", reject); input.on("end", () => resolve(`sha256:${hash.digest("hex")}`)); }); }
function piiOrSecret(value) { return /(api[_-]?key|secret|password|@(?:gmail|qq|163)\.com|1[3-9]\d{9}|\b\d{17}[\dXx]\b)/i.test(value); }
const REQUIRED = Object.freeze({
  residents: ["seniorId", "ageBand", "speechPace", "permissionState", "healthState", "memberState"],
  identityEvents: ["seniorId", "consentId", "captureToken", "eventType", "consentState", "occurredAt"],
  healthLabels: ["seniorId", "labelId", "labelType", "level", "observedAt"],
  indicatorEvidence: ["seniorId", "evidenceId", "metric", "value", "unit", "observedAt", "timeWindow"],
  healthEvaluations: ["seniorId", "evaluationId", "evaluationType", "status", "evaluatedAt"],
  riskAssessments: ["seniorId", "assessmentId", "level", "evidenceIds", "createdAt"],
  memberAccounts: ["seniorId", "accountId", "memberState", "pointsBalance", "authorizationId"],
  pointLedger: ["seniorId", "ledgerId", "direction", "points", "balanceAfter", "occurredAt"],
  rechargeRecords: ["seniorId", "rechargeId", "amount", "currency", "status", "paidAt"],
  consumptionRecords: ["seniorId", "consumptionId", "amount", "currency", "status", "consumedAt"],
  stationServices: ["serviceId", "name", "enabled", "updatedAt"],
  stationActivities: ["activityId", "serviceId", "title", "status", "startsAt", "endsAt", "timezone"],
  knowledgeArticles: ["knowledgeId", "title", "category", "publishedAt", "expiresAt", "updatedAt"],
});
function hasFields(row, fields) { return (fields || []).every((field) => Object.hasOwn(row, field)); }
function validTime(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validMoney(value) { return typeof value === "string" && /^\d+\.\d{2}$/.test(value); }
function invariant(expected = 0) { return { expected, actual: 0, failures: [], valid: true }; }
function failInvariant(target, item) { target.valid = false; if (target.failures.length < 50) target.failures.push(item); }
async function inspectShard(root, shard, residentIds, relations) {
  const file = path.join(root, shard.file);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) throw new Error(`invalid shard path: ${shard.file}`);
  let records = 0; let malformed = 0; let piiHits = 0; let foreignKeys = 0; let schemaFailures = 0; let amountFailures = 0; let timeFailures = 0; const distributions = {};
  const input = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of input) { if (!line) continue; records += 1; try { const row = JSON.parse(line); if (row.dataClassification !== "synthetic-test-only" || row.synthetic !== true) malformed += 1; if (piiOrSecret(line)) piiHits += 1; if (!hasFields(row, REQUIRED[shard.entity])) schemaFailures += 1; if (row.seniorId != null && shard.entity !== "residents" && !residentIds.has(String(row.seniorId))) foreignKeys += 1; if (shard.entity === "residents") { residentIds.add(String(row.seniorId)); for (const key of ["ageBand", "speechPace", "permissionState", "healthState", "memberState", "dataQuality"]) { const value = String(row[key] || "missing"); distributions[key] ||= {}; distributions[key][value] = (distributions[key][value] || 0) + 1; } }
    relations.invariants.organization.actual += 1; if (row.tenantId !== 10001 || row.orgId !== 10001) failInvariant(relations.invariants.organization, { entity: shard.entity, id: row.id, tenantId: row.tenantId, orgId: row.orgId });
    if (shard.entity === "residents") relations.residentRecords.set(String(row.seniorId), row);
    if (shard.entity === "identityEvents") { relations.invariants.identity.actual += 1; const ordinal = Math.floor((Number(row.sequence) - 1) / relations.residents) + 1; const consent = `consent-${row.seniorId}-${ordinal}`; const capture = `capture-${row.seniorId}-${ordinal}`; if (row.consentId !== consent || row.captureToken !== capture || relations.consents.has(row.consentId) || relations.captures.has(row.captureToken)) failInvariant(relations.invariants.identity, { seniorId: row.seniorId, consentId: row.consentId, captureToken: row.captureToken }); relations.consents.add(row.consentId); relations.captures.add(row.captureToken); }
    if (shard.entity === "healthLabels") (relations.labelIds.get(String(row.seniorId)) || relations.labelIds.set(String(row.seniorId), new Set()).get(String(row.seniorId))).add(row.labelId);
    if (shard.entity === "healthEvaluations") (relations.evaluationIds.get(String(row.seniorId)) || relations.evaluationIds.set(String(row.seniorId), new Set()).get(String(row.seniorId))).add(row.evaluationId);
    if (shard.entity === "indicatorEvidence") { const ordinal = Math.floor((Number(row.sequence) - 1) / relations.residents) + 1; const expected = `evidence-${row.seniorId}-${ordinal}`; if (row.evidenceId !== expected) failInvariant(relations.invariants.riskEvidence, { seniorId: row.seniorId, evidenceId: row.evidenceId, expected }); relations.evidenceCounts.set(String(row.seniorId), (relations.evidenceCounts.get(String(row.seniorId)) || 0) + 1); relations.evidenceIds.add(row.evidenceId); }
    if (shard.entity === "riskAssessments") for (const evidenceId of row.evidenceIds || []) { relations.invariants.riskEvidence.actual += 1; const match = /^evidence-(\d+)-(\d+)$/.exec(String(evidenceId)); if (!match || String(match[1]) !== String(row.seniorId) || Number(match[2]) < 1 || Number(match[2]) > 120 || !relations.evidenceIds.has(evidenceId)) failInvariant(relations.invariants.riskEvidence, { seniorId: row.seniorId, evidenceId }); }
    if (shard.entity === "memberAccounts") relations.accounts.set(String(row.seniorId), row);
    if (shard.entity === "pointLedger") { relations.invariants.ledger.actual += 1; const seniorId = String(row.seniorId); const prior = relations.ledgerBalances.get(seniorId) || 0; const points = Number(row.points); const balanceAfter = Number(row.balanceAfter); const next = row.direction === "credit" ? prior + points : row.direction === "debit" ? prior - points : NaN; if (!Number.isInteger(points) || points < 0 || !Number.isInteger(balanceAfter) || balanceAfter < 0 || balanceAfter !== next) failInvariant(relations.invariants.ledger, { seniorId, ledgerId: row.ledgerId, direction: row.direction, points: row.points, balanceAfter: row.balanceAfter, expectedBalanceAfter: next }); relations.ledgerBalances.set(seniorId, balanceAfter); }
    if (shard.entity === "stationServices") relations.services.add(row.serviceId);
    if (shard.entity === "stationActivities") { relations.invariants.serviceActivity.actual += 1; if (!relations.services.has(row.serviceId)) failInvariant(relations.invariants.serviceActivity, { activityId: row.activityId, serviceId: row.serviceId }); }
    if (["rechargeRecords", "consumptionRecords"].includes(shard.entity) && (!validMoney(row.amount) || row.currency !== "CNY")) amountFailures += 1; for (const field of ["occurredAt", "observedAt", "evaluatedAt", "createdAt", "paidAt", "consumedAt", "updatedAt", "startsAt", "endsAt", "publishedAt", "expiresAt"]) if (Object.hasOwn(row, field) && !validTime(row[field])) timeFailures += 1; if (shard.entity === "stationActivities" && validTime(row.startsAt) && validTime(row.endsAt) && Date.parse(row.endsAt) < Date.parse(row.startsAt)) { timeFailures += 1; failInvariant(relations.invariants.serviceActivity, { activityId: row.activityId, reason: "end-before-start" }); } } catch { malformed += 1; } }
  const digest = await sha256(file);
  return { entity: shard.entity, records, bytes: fs.statSync(file).size, sha256: digest, valid: records === shard.records && digest === shard.sha256 && malformed === 0 && piiHits === 0 && foreignKeys === 0 && schemaFailures === 0 && amountFailures === 0 && timeFailures === 0, malformed, piiHits, foreignKeys, schemaFailures, amountFailures, timeFailures, distributions };
}
async function main() {
  const root = path.resolve(arg("out"));
  if (!root || !fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) throw new Error("--out must be a non-symlink dataset directory");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "community-manifest.json"), "utf8"));
  if (manifest.dataClassification !== "synthetic-test-only" || !Array.isArray(manifest.shards)) throw new Error("invalid synthetic manifest");
  const residentShard = manifest.shards.find((item) => item.entity === "residents"); if (!residentShard) throw new Error("residents shard missing");
  const residentIds = new Set(); const relations = { residents: manifest.residents, consents: new Set(), captures: new Set(), evidenceCounts: new Map(), evidenceIds: new Set(), labelIds: new Map(), evaluationIds: new Map(), residentRecords: new Map(), accounts: new Map(), ledgerBalances: new Map(), services: new Set(), invariants: { identity: invariant(manifest.entityCounts.identityEvents), riskEvidence: invariant(manifest.entityCounts.riskAssessments), memberBalance: invariant(manifest.residents), ledger: invariant(manifest.entityCounts.pointLedger), authorization: invariant(manifest.residents), organization: invariant(manifest.totalRecords), toolExportReferences: invariant(manifest.residents * 125), serviceActivity: invariant(manifest.entityCounts.stationActivities) } };
  const reports = [await inspectShard(root, residentShard, residentIds, relations)];
  for (const shard of manifest.shards) if (shard.entity !== "residents") reports.push(await inspectShard(root, shard, residentIds, relations));
  for (const seniorId of residentIds) { if ((relations.evidenceCounts.get(seniorId) || 0) !== 120) failInvariant(relations.invariants.riskEvidence, { seniorId, evidenceCount: relations.evidenceCounts.get(seniorId) || 0 }); const resident = relations.residentRecords.get(seniorId); const account = relations.accounts.get(seniorId); relations.invariants.memberBalance.actual += 1; const actual = relations.ledgerBalances.get(seniorId); const expected = Number(account?.pointsBalance); if (!Number.isFinite(expected) || actual !== expected) failInvariant(relations.invariants.memberBalance, { seniorId, expected, actual }); relations.invariants.authorization.actual += 1; const expectedAuthorization = resident?.permissionState === "verified-self" ? resident.authorizationId : null; if (!account || account.accountId !== `member-${seniorId}` || account.memberState !== resident?.memberState || account.authorizationId !== expectedAuthorization) failInvariant(relations.invariants.authorization, { seniorId, expectedAuthorization, accountAuthorization: account?.authorizationId, permissionState: resident?.permissionState }); const labels = relations.labelIds.get(seniorId) || new Set(); const evaluations = relations.evaluationIds.get(seniorId) || new Set(); const references = [`label-${seniorId}-1`, ...Array.from({ length: 4 }, (_, index) => `eval-${seniorId}-${index + 1}`), ...Array.from({ length: 120 }, (_, index) => `evidence-${seniorId}-${index + 1}`)]; for (const reference of references) { relations.invariants.toolExportReferences.actual += 1; const found = reference.startsWith("label-") ? labels.has(reference) : reference.startsWith("eval-") ? evaluations.has(reference) : relations.evidenceIds.has(reference); if (!found) failInvariant(relations.invariants.toolExportReferences, { seniorId, reference }); } }
  for (const item of Object.values(relations.invariants)) item.valid = item.failures.length === 0;
  const totalRecords = reports.reduce((sum, item) => sum + item.records, 0); const totalBytes = reports.reduce((sum, item) => sum + item.bytes, 0);
  const coverage = reports.find((item) => item.entity === "residents")?.distributions || {};
  const expectedDimensions = { ageBand: 4, speechPace: 3, permissionState: 6, healthState: 7, memberState: 5, dataQuality: 4 };
  const distributionValid = Object.entries(expectedDimensions).every(([key, minimum]) => Object.keys(coverage[key] || {}).length >= minimum);
  const invariantValid = Object.values(relations.invariants).every((item) => item.valid);
  const valid = reports.every((item) => item.valid) && totalRecords === manifest.totalRecords && totalBytes === manifest.totalBytes && residentIds.size === manifest.residents && distributionValid && invariantValid;
  const result = { valid, root, residents: residentIds.size, totalRecords, totalBytes, manifestHash: manifest.manifestHash, coverage: { dimensions: coverage, distributionValid }, invariants: relations.invariants, shardReports: reports };
  fs.writeFileSync(path.join(root, "validation-report.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ valid, residents: result.residents, totalRecords, totalBytes, shards: reports.length })}\n`); if (!valid) process.exitCode = 1;
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
