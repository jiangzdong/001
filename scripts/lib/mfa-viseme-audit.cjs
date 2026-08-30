const { phonemeViseme } = require("../../electron/viseme-timeline.cjs");

function findTier(document, wantedName) {
  const tiers = document?.tiers;
  if (Array.isArray(tiers)) return tiers.find((tier) => String(tier?.name || "").toLowerCase() === wantedName);
  if (tiers && typeof tiers === "object") {
    const key = Object.keys(tiers).find((name) => name.toLowerCase() === wantedName);
    return key ? tiers[key] : null;
  }
  return null;
}

function parseMfaPhoneIntervals(document) {
  const tier = findTier(document, "phones");
  const entries = Array.isArray(tier?.entries) ? tier.entries : [];
  return entries.map((entry) => {
    if (Array.isArray(entry)) return { startMs: Number(entry[0]) * 1000, endMs: Number(entry[1]) * 1000, phone: String(entry[2] || "") };
    return {
      startMs: Number(entry?.begin ?? entry?.start ?? entry?.xmin) * 1000,
      endMs: Number(entry?.end ?? entry?.stop ?? entry?.xmax) * 1000,
      phone: String(entry?.label ?? entry?.text ?? entry?.phone ?? ""),
    };
  }).filter((entry) => Number.isFinite(entry.startMs) && Number.isFinite(entry.endMs) && entry.endMs >= entry.startMs);
}

function createMfaVisemeTimeline(document) {
  const intervals = parseMfaPhoneIntervals(document);
  const events = [];
  for (const interval of intervals) {
    const shape = phonemeViseme(interval.phone) || "REST";
    if (events.at(-1)?.shape === shape) {
      events.at(-1).endMs = Math.round(interval.endMs);
      events.at(-1).phones.push(interval.phone);
      continue;
    }
    events.push({
      timeMs: Math.round(interval.startMs),
      endMs: Math.round(interval.endMs),
      shape,
      phones: interval.phone ? [interval.phone] : [],
      role: shape === "CLOSED" ? "pause" : "mfa-phoneme",
    });
  }
  if (events.length && events[0].timeMs > 0) events.unshift({ timeMs: 0, endMs: events[0].timeMs, shape: "CLOSED", phones: [], role: "pause" });
  if (events.length && events.at(-1).shape !== "CLOSED") {
    events.push({ timeMs: events.at(-1).endMs, endMs: events.at(-1).endMs, shape: "CLOSED", phones: [], role: "pause" });
  }
  return events;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return Math.round(sorted[index]);
}

function compareVisemeTimelines(reference, runtime, thresholds = {}) {
  const referenceEvents = (Array.isArray(reference) ? reference : []).filter((event) => !["CLOSED", "REST"].includes(event?.shape));
  const runtimeEvents = Array.isArray(runtime?.visemes) ? runtime.visemes : Array.isArray(runtime) ? runtime : [];
  const candidates = runtimeEvents.filter((event) => !["CLOSED", "REST"].includes(event?.shape));
  const drifts = [];
  let matched = 0;
  const usedCandidates = new Set();
  for (const event of referenceEvents) {
    const sameShape = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter((item) => item.candidate?.shape === event.shape && !usedCandidates.has(item.index));
    if (!sameShape.length) continue;
    const nearest = sameShape.reduce((best, item) => {
      const drift = Math.abs((Number(item.candidate.timeMs) || 0) - (Number(event.timeMs) || 0));
      return !best || drift < best.drift ? { ...item, drift } : best;
    }, null);
    usedCandidates.add(nearest.index);
    matched += 1;
    drifts.push(nearest.drift);
  }
  const coverage = matched / Math.max(1, referenceEvents.length);
  const metrics = {
    referenceEventCount: referenceEvents.length,
    runtimeEventCount: candidates.length,
    matchedEventCount: matched,
    coverage: Number(coverage.toFixed(4)),
    medianDriftMs: percentile(drifts, 0.5),
    p95DriftMs: percentile(drifts, 0.95),
    maxDriftMs: drifts.length ? Math.round(Math.max(...drifts)) : null,
  };
  const limits = {
    minimumCoverage: Number(thresholds.minimumCoverage) || 0.7,
    maximumMedianDriftMs: Number(thresholds.maximumMedianDriftMs) || 90,
    maximumP95DriftMs: Number(thresholds.maximumP95DriftMs) || 180,
  };
  return {
    pass: metrics.coverage >= limits.minimumCoverage
      && metrics.medianDriftMs !== null && metrics.medianDriftMs <= limits.maximumMedianDriftMs
      && metrics.p95DriftMs !== null && metrics.p95DriftMs <= limits.maximumP95DriftMs,
    metrics,
    thresholds: limits,
  };
}

module.exports = { compareVisemeTimelines, createMfaVisemeTimeline, parseMfaPhoneIntervals };
