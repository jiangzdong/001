const fs = require("fs");
const path = require("path");

function sanitizeMetrics(metrics) {
  const output = {};
  for (const [key, value] of Object.entries(metrics || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) output[key] = Math.round(value * 1000) / 1000;
    else if (typeof value === "boolean" || value === null) output[key] = value;
    else if (typeof value === "string" && /^(ok|error|cancelled|timeout|local|cloud|cache|none|ready|offline|online)$/.test(value)) output[key] = value;
  }
  return output;
}

function createRuntimeTelemetry({ directory, maxBytes = 2 * 1024 * 1024, memoryEntries = 80 } = {}) {
  const recent = [];
  const filename = directory ? path.join(directory, "runtime-metrics.jsonl") : "";

  function rotateIfNeeded() {
    if (!filename) return;
    try {
      if (fs.statSync(filename).size < maxBytes) return;
      const previous = `${filename}.previous`;
      try { fs.unlinkSync(previous); } catch {}
      fs.renameSync(filename, previous);
    } catch {}
  }

  function record(stage, event, metrics = {}) {
    const entry = {
      at: new Date().toISOString(),
      stage: String(stage || "runtime").replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "runtime",
      event: String(event || "event").replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "event",
      metrics: sanitizeMetrics(metrics),
    };
    recent.push(entry);
    if (recent.length > memoryEntries) recent.splice(0, recent.length - memoryEntries);
    if (filename) {
      try {
        fs.mkdirSync(directory, { recursive: true });
        rotateIfNeeded();
        fs.appendFileSync(filename, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {}
    }
    return entry;
  }

  return {
    record,
    snapshot() { return recent.map((entry) => ({ ...entry, metrics: { ...entry.metrics } })); },
    filename,
  };
}

module.exports = { createRuntimeTelemetry, sanitizeMetrics };
