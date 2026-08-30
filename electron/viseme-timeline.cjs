const VALID_VISEMES = new Set(["CLOSED", "REST", "A", "E", "O", "U", "F", "L", "S", "SH"]);
const TONE_TOKEN = /^\d+$|^[ˉˊˇˋ˙]$/;
const INITIAL_TOKEN = /^(?:b|p|m|f|v|l|n|d|t|g|k|h|z|c|s|j|q|x|zh|ch|sh|r|w|y|ㄅ|ㄆ|ㄇ|ㄈ|ㄌ|ㄋ|ㄉ|ㄊ|ㄍ|ㄎ|ㄏ|ㄗ|ㄘ|ㄙ|ㄐ|ㄑ|ㄒ|ㄓ|ㄔ|ㄕ|ㄖ|ㄨ|ㄧ)$/;

function splitTtsProgressText(text, maxSentences = 2) {
  const source = String(text || "");
  const groupSize = Math.max(1, Math.round(Number(maxSentences) || 1));
  const clauses = [];
  let clause = "";
  for (const character of source) {
    clause += character;
    if (/[，、。！？；：,.!?;:]/u.test(character)) {
      if (clause.trim()) clauses.push(clause);
      clause = "";
    }
  }
  if (clause.trim()) clauses.push(clause);
  if (clauses.length <= groupSize) return source.trim() ? [source] : [];
  const groups = [];
  for (let index = 0; index < clauses.length; index += groupSize) groups.push(clauses.slice(index, index + groupSize).join(""));
  return groups;
}

function initialViseme(tokens = []) {
  const initial = String(tokens[0] || "").toLowerCase();
  if (/^(?:b|p|m)$|^[ㄅㄆㄇ]$/.test(initial)) return "CLOSED";
  if (/^(?:f|v)$|^ㄈ$/.test(initial)) return "F";
  if (/^(?:l|n|d|t)$|^[ㄌㄋㄉㄊ]$/.test(initial)) return "L";
  if (/^(?:z|c|s|j|q|x)$|^[ㄗㄘㄙㄐㄑㄒ]$/.test(initial)) return "S";
  if (/^(?:zh|ch|sh|r)$|^[ㄓㄔㄕㄖ]$/.test(initial)) return "SH";
  if (/^w$|^ㄨ$/.test(initial)) return "U";
  return "REST";
}

function compactPronunciation(tokens = []) {
  const normalized = tokens
    .map((token) => String(token).trim().toLowerCase())
    .filter((token) => token && !TONE_TOKEN.test(token));
  const withoutInitial = normalized.length > 1 && INITIAL_TOKEN.test(normalized[0] || "") ? normalized.slice(1) : normalized;
  return withoutInitial.join("").replace(/[^a-züㄅ-ㄩ]/g, "");
}

function uniqueVisemes(shapes) {
  return shapes.filter((shape, index) => VALID_VISEMES.has(shape) && (index === 0 || shape !== shapes[index - 1]));
}

function vowelVisemes(tokens = []) {
  const spokenTokens = tokens.map((token) => String(token).trim().toLowerCase()).filter((token) => token && !TONE_TOKEN.test(token));
  const final = compactPronunciation(tokens);
  if (spokenTokens.at(-1) === "ㄇ" || spokenTokens.at(-1) === "m") return ["CLOSED"];
  if (spokenTokens.length === 1 && /^(?:z|c|s|zh|ch|sh|r|ㄗ|ㄘ|ㄙ|ㄓ|ㄔ|ㄕ|ㄖ)$/.test(spokenTokens[0] || "")) return ["E"];
  if (!final) return ["REST"];

  // Compound Mandarin finals need visible movement inside one syllable. Match
  // them before single vowels so ㄠ/ao does not collapse to a static A frame.
  if (/ㄧㄠ|iao/.test(final)) return ["E", "O"];
  if (/ㄧㄡ|iou|iu/.test(final)) return ["E", "U"];
  if (/ㄧ(?:ㄚ|ㄢ|ㄤ)|ia|ian|iang/.test(final)) return ["E", "A"];
  if (/ㄨㄛ|uo/.test(final)) return ["U", "O"];
  if (/ㄨㄟ|uei|ui/.test(final)) return ["U", "E"];
  if (/ㄨ(?:ㄚ|ㄞ|ㄢ|ㄤ)|ua|uai|uan|uang/.test(final)) return ["U", "A"];
  if (/ㄩㄝ|üe|ue|ve/.test(final)) return ["U", "E"];
  if (/ㄩㄢ|üan|van/.test(final)) return ["U", "A"];
  if (/ㄠ|ao/.test(final)) return ["A", "O"];
  if (/ㄞ|ai/.test(final)) return ["A", "E"];
  if (/ㄡ|ou/.test(final)) return ["O", "U"];

  if (/ㄚ|ㄢ|ㄤ|(?:^|[^a-z])a(?:n|ng)?$|aa|ae/.test(final)) return ["A"];
  if (/ㄛ|ong|(?:^|[^a-z])o/.test(final)) return ["O"];
  if (/ㄨ|ㄩ|ü|(?:^|[^a-z])[uv]/.test(final)) return ["U"];
  if (/ㄧ|ㄜ|ㄝ|ㄟ|ㄣ|ㄥ|ㄦ|i|e|er|ir/.test(final)) return ["E"];
  return ["REST"];
}

function vowelViseme(tokens = []) {
  return vowelVisemes(tokens)[0] || "REST";
}

function buildVisemeUnits(text, pronunciations = new Map(), { includeInitialClosure = true } = {}) {
  const units = includeInitialClosure ? [{ shape: "CLOSED", weight: 0.58, pause: true }] : [];
  for (const character of String(text || "")) {
    if (/\s/u.test(character)) {
      units.push({ shape: "CLOSED", weight: 0.5, pause: true });
      continue;
    }
    if (/[，、,]/u.test(character)) {
      units.push({ shape: "CLOSED", weight: 1.15, pause: true });
      continue;
    }
    if (/[。！？；：.!?;:]/u.test(character)) {
      units.push({ shape: "CLOSED", weight: 1.75, pause: true });
      continue;
    }
    const tokens = pronunciations.get(character) || [];
    const initial = initialViseme(tokens);
    const vowels = uniqueVisemes(vowelVisemes(tokens));
    if (initial !== "REST") units.push({ shape: initial, weight: 0.38, pause: false, role: "onset", character });
    const visibleVowels = vowels.length ? vowels : ["REST"];
    const vowelWeight = visibleVowels.length > 1 ? 0.58 : 0.92;
    for (const vowel of visibleVowels) units.push({ shape: vowel, weight: vowelWeight, pause: false, role: "final", character });
  }
  units.push({ shape: "CLOSED", weight: 0.78, pause: true });
  return units;
}

function analyzeEnvelope(samples, sampleRate, windowMs = 10) {
  const audio = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const rate = Math.max(1, Number(sampleRate) || 16000);
  const frameSize = Math.max(1, Math.round(rate * windowMs / 1000));
  const rms = [];
  let peak = 0;
  for (let offset = 0; offset < audio.length; offset += frameSize) {
    let energy = 0;
    const end = Math.min(audio.length, offset + frameSize);
    for (let index = offset; index < end; index += 1) energy += audio[index] * audio[index];
    const value = Math.sqrt(energy / Math.max(1, end - offset));
    rms.push(value);
    peak = Math.max(peak, value);
  }
  const durationMs = audio.length / rate * 1000;
  const threshold = Math.max(0.0015, peak * 0.075);
  let firstVoiced = rms.findIndex((value) => value >= threshold);
  let lastVoiced = -1;
  for (let index = rms.length - 1; index >= 0; index -= 1) {
    if (rms[index] >= threshold) { lastVoiced = index; break; }
  }
  if (firstVoiced < 0 || lastVoiced < firstVoiced) {
    firstVoiced = 0;
    lastVoiced = Math.max(0, rms.length - 1);
  }
  return {
    rms,
    peak,
    threshold,
    windowMs,
    durationMs,
    speechStartMs: Math.max(0, firstVoiced * windowMs - windowMs),
    speechEndMs: Math.min(durationMs, (lastVoiced + 2) * windowMs),
  };
}

function nearestValleyTime(envelope, targetMs, searchMs) {
  const { rms, peak, windowMs, durationMs } = envelope;
  if (!rms.length) return Math.max(0, Math.min(durationMs, targetMs));
  const center = Math.round(targetMs / windowMs);
  const radius = Math.max(1, Math.round(searchMs / windowMs));
  let bestIndex = Math.max(0, Math.min(rms.length - 1, center));
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = Math.max(0, center - radius); index <= Math.min(rms.length - 1, center + radius); index += 1) {
    const distance = Math.abs(index - center) / radius;
    const score = rms[index] + distance * Math.max(peak, 0.001) * 0.18;
    if (score < bestScore) { bestScore = score; bestIndex = index; }
  }
  return Math.min(durationMs, bestIndex * windowMs);
}

function lcsAnchors(targetCharacters, recognizedEntries) {
  const rows = targetCharacters.length + 1;
  const columns = recognizedEntries.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let left = 1; left < rows; left += 1) {
    for (let right = 1; right < columns; right += 1) {
      table[left][right] = targetCharacters[left - 1].character === recognizedEntries[right - 1].character
        ? table[left - 1][right - 1] + 1
        : Math.max(table[left - 1][right], table[left][right - 1]);
    }
  }
  const anchors = [];
  let left = targetCharacters.length;
  let right = recognizedEntries.length;
  while (left > 0 && right > 0) {
    if (targetCharacters[left - 1].character === recognizedEntries[right - 1].character) {
      anchors.push({ targetIndex: targetCharacters[left - 1].index, timeMs: recognizedEntries[right - 1].timeMs });
      left -= 1;
      right -= 1;
    } else if (table[left - 1][right] >= table[left][right - 1]) left -= 1;
    else right -= 1;
  }
  return anchors.reverse();
}

function remapAlignedEntries(text, recognizedEntries, envelope) {
  const target = [...String(text || "")]
    .filter((character) => !/\s/u.test(character))
    .map((character, index) => ({ character, index }));
  const comparableTarget = target.filter((item) => !/[，、。！？；：,.!?;:]/u.test(item.character));
  const comparableRecognized = recognizedEntries.filter((item) => !/[，、。！？；：,.!?;:]/u.test(item.character));
  const anchors = lcsAnchors(comparableTarget, comparableRecognized);
  const matchRatio = anchors.length / Math.max(1, Math.max(comparableTarget.length, comparableRecognized.length));
  if (anchors.length < 2 || matchRatio < 0.35) return { entries: [], matchRatio };

  const startMs = Math.max(0, Number(envelope.speechStartMs) || 0);
  const endMs = Math.max(startMs + 1, Number(envelope.speechEndMs) || Number(envelope.durationMs) || 1);
  const points = [
    { targetIndex: -1, timeMs: startMs },
    ...anchors,
    { targetIndex: target.length, timeMs: endMs },
  ];
  const remapped = target.map((item) => {
    let right = points.findIndex((point) => point.targetIndex >= item.index);
    if (right < 0) right = points.length - 1;
    const next = points[right];
    const previous = points[Math.max(0, right - 1)];
    if (next.targetIndex === item.index) return { character: item.character, characterIndex: item.index, timeMs: next.timeMs };
    const span = Math.max(1, next.targetIndex - previous.targetIndex);
    const progress = (item.index - previous.targetIndex) / span;
    return { character: item.character, characterIndex: item.index, timeMs: previous.timeMs + (next.timeMs - previous.timeMs) * progress };
  });
  let previousTime = 0;
  return {
    entries: remapped.map((entry) => {
      const timeMs = Math.round(Math.max(previousTime, Math.min(endMs, entry.timeMs)));
      previousTime = timeMs;
      return { ...entry, timeMs };
    }),
    matchRatio,
  };
}

function createTimedVisemes(text, pronunciations, samples, sampleRate, { includeInitialClosure = true } = {}) {
  const units = buildVisemeUnits(text, pronunciations, { includeInitialClosure });
  const envelope = analyzeEnvelope(samples, sampleRate);
  const totalWeight = units.reduce((total, unit) => total + unit.weight, 0) || 1;
  const speechSpan = Math.max(80, envelope.speechEndMs - envelope.speechStartMs);
  const candidates = [];
  let consumed = 0;
  // A still-image library cannot display every phoneme without looking like a
  // flipbook. Keep the full PCM-relative timeline, then reduce only visible
  // poses. 140 ms caps the apparent switch rate near seven changes per second.
  const compactPhrase = envelope.durationMs < 900;
  const minimumEventMs = compactPhrase ? 120 : 140;
  const endTime = Math.round(Math.max(0, envelope.durationMs));
  const compactFinals = uniqueVisemes(units
    .filter((unit) => unit.role === "final" && !unit.pause && !["CLOSED", "REST"].includes(unit.shape))
    .map((unit) => unit.shape));
  const compactSequence = compactPhrase && compactFinals.length
    ? [...(includeInitialClosure ? ["CLOSED"] : []), ...compactFinals, "CLOSED"]
    : [];
  const compactIntervals = Math.max(0, compactSequence.length - 1);
  if (compactIntervals && compactIntervals * minimumEventMs <= endTime) {
    const closeAt = Math.max(compactIntervals * minimumEventMs, endTime - minimumEventMs);
    const spacing = closeAt / compactIntervals;
    return compactSequence.map((shape, index) => ({ timeMs: Math.round(index * spacing), shape }));
  }
  let lastCandidateTime = -1;

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    let timeMs;
    if (index === 0) timeMs = 0;
    else if (index === units.length - 1) timeMs = envelope.speechEndMs;
    else {
      const target = envelope.speechStartMs + speechSpan * (consumed / totalWeight);
      timeMs = nearestValleyTime(envelope, target, unit.pause ? 170 : 45);
    }
    timeMs = Math.round(Math.max(0, Math.min(envelope.durationMs, timeMs)));
    timeMs = Math.max(lastCandidateTime + 1, timeMs);
    const shape = VALID_VISEMES.has(unit.shape) ? unit.shape : "REST";
    if ((!candidates.length || candidates.at(-1).shape !== shape) && timeMs <= envelope.durationMs) {
      candidates.push({ timeMs, shape, role: unit.role || "pause", pause: Boolean(unit.pause), character: unit.character || "" });
      lastCandidateTime = timeMs;
    }
    consumed += unit.weight;
  }

  const events = [];
  for (const candidate of candidates) {
    // In a compact streamed phrase, an intermediate punctuation closure can
    // consume the entire next vowel. Preserve the spoken targets and rebuild
    // one clean terminal closure below.
    if (compactPhrase && candidate.pause && events.length) continue;
    if (!events.length) {
      events.push({ ...candidate, timeMs: 0 });
      continue;
    }
    const previous = events.at(-1);
    if (candidate.shape === previous.shape) continue;
    const gap = candidate.timeMs - previous.timeMs;
    if (gap >= minimumEventMs) {
      events.push(candidate);
      continue;
    }
    // Within one short syllable the sustained vowel carries more visible
    // information than a one-frame tongue/consonant pose.
    if (candidate.role === "final" && previous.role === "onset" && candidate.character === previous.character) {
      previous.shape = candidate.shape;
      previous.role = candidate.role;
      continue;
    }
    // Keep the initial closed mouth while avoiding an immediate pop at start.
    if (events.length === 1 && previous.timeMs === 0 && previous.shape === "CLOSED") {
      events.push({ ...candidate, timeMs: Math.min(Math.round(envelope.durationMs), minimumEventMs) });
    }
  }

  if (!events.length) events.push({ timeMs: 0, shape: "REST" });
  // The unit builder already contributes a terminal CLOSED event. Rebuild the
  // tail here so both the final visible phoneme and the closed-mouth ending
  // have a full dwell instead of being compressed against the buffer end.
  if (events.length > 1 && events.at(-1).shape === "CLOSED") events.pop();
  if (events.at(-1).shape !== "CLOSED") {
    // Do not squeeze a final phoneme and the closing mouth into the last few
    // milliseconds. A too-short tail is less accurate perceptually than
    // holding the preceding vowel and closing cleanly with the real audio end.
    while (events.length > 1 && endTime - events.at(-1).timeMs < minimumEventMs) events.pop();
    const closeAt = Math.min(endTime, Math.max(events.at(-1).timeMs + minimumEventMs, endTime - minimumEventMs));
    if (closeAt > events.at(-1).timeMs) events.push({ timeMs: closeAt, shape: "CLOSED" });
  }
  return events.slice(0, 1200).map(({ timeMs, shape, character = "", role = "pause" }) => ({ timeMs, shape, character, role }));
}

function createAlignedVisemes(text, pronunciations, samples, sampleRate, alignment = {}) {
  const envelope = analyzeEnvelope(samples, sampleRate);
  const rawTokens = Array.isArray(alignment?.tokens) ? alignment.tokens : [];
  const rawTimestamps = Array.isArray(alignment?.timestamps) ? alignment.timestamps : [];
  const entries = [];
  for (let index = 0; index < Math.min(rawTokens.length, rawTimestamps.length); index += 1) {
    const token = String(rawTokens[index] || "").trim();
    const seconds = Number(rawTimestamps[index]);
    if (!token || token.startsWith("<|") || !Number.isFinite(seconds)) continue;
    for (const character of token) entries.push({ character, timeMs: Math.round(seconds * 1000) });
  }
  const remapped = remapAlignedEntries(text, entries, envelope);
  if (remapped.entries.length < 2) return createTimedVisemes(text, pronunciations, samples, sampleRate);
  entries.splice(0, entries.length, ...remapped.entries);

  const candidates = [{ timeMs: 0, shape: "CLOSED", role: "pause", priority: 4 }];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const nextTime = entries[index + 1]?.timeMs ?? envelope.speechEndMs;
    const syllableMs = Math.max(100, Math.min(520, nextTime - entry.timeMs));
    if (/[，、,]/u.test(entry.character)) {
      candidates.push({ timeMs: entry.timeMs, shape: "CLOSED", role: "pause", priority: 4, character: entry.character, characterIndex: entry.characterIndex });
      continue;
    }
    if (/[。！？；：.!?;:]/u.test(entry.character)) {
      candidates.push({ timeMs: entry.timeMs, shape: "CLOSED", role: "pause", priority: 5, character: entry.character, characterIndex: entry.characterIndex });
      continue;
    }
    const pronunciation = pronunciations.get(entry.character) || [];
    const onset = initialViseme(pronunciation);
    const finals = uniqueVisemes(vowelVisemes(pronunciation));
    const onsetAt = Math.max(0, entry.timeMs - Math.min(58, syllableMs * 0.24));
    // Only closures and labiodentals require a separate externally visible
    // consonant pose. Tongue-only L/S/SH onsets made the still-image library
    // chatter without improving what a viewer can actually see.
    if (/^(?:CLOSED|F)$/.test(onset) && onset !== finals[0]) {
      const priority = 3;
      candidates.push({ timeMs: onsetAt, shape: onset, role: "onset", priority, character: entry.character, characterIndex: entry.characterIndex });
    }
    const visibleFinals = finals.length ? finals : ["REST"];
    // Visible articulation normally leads the audible vowel. Starting the
    // sustained target shortly before the acoustic timestamp prevents the
    // familiar "voice first, lips later" effect.
    const firstFinalAt = Math.max(0, entry.timeMs - Math.min(34, syllableMs * 0.18));
    candidates.push({ timeMs: firstFinalAt, shape: visibleFinals[0], role: "final", priority: 3, character: entry.character, characterIndex: entry.characterIndex });
    if (visibleFinals.length > 1) {
      candidates.push({ timeMs: Math.min(envelope.durationMs, entry.timeMs + syllableMs * 0.46), shape: visibleFinals[1], role: "final", priority: 3, character: entry.character, characterIndex: entry.characterIndex });
    }
  }
  candidates.push({ timeMs: envelope.speechEndMs, shape: "CLOSED", role: "pause", priority: 5 });
  candidates.sort((a, b) => a.timeMs - b.timeMs || b.priority - a.priority);

  // Preserve every aligned syllable final. A 72 ms visual floor is long enough
  // to avoid one-frame chatter at 60 Hz, while allowing normal Mandarin at
  // roughly four to six syllables per second. Onsets may be replaced by the
  // final of the same syllable; finals from different characters are retained
  // even when they share the same mouth shape so text/timing remains exact.
  const minimumEventMs = 72;
  const events = [];
  for (const candidate of candidates) {
    const timeMs = Math.round(Math.max(0, Math.min(envelope.durationMs, candidate.timeMs)));
    const shape = VALID_VISEMES.has(candidate.shape) ? candidate.shape : "REST";
    if (!events.length) {
      events.push({ ...candidate, timeMs: 0, shape });
      continue;
    }
    const previous = events.at(-1);
    if (shape === previous.shape && candidate.character === previous.character) continue;
    const gap = timeMs - previous.timeMs;
    if (candidate.role === "final" && candidate.character && candidate.character !== previous.character) {
      events.push({ ...candidate, timeMs: Math.max(previous.timeMs + 1, timeMs), shape });
      continue;
    }
    if (gap >= minimumEventMs) {
      events.push({ ...candidate, timeMs, shape });
      continue;
    }
    if (candidate.role === "final" && previous.role === "onset" && candidate.character === previous.character) {
      previous.shape = shape;
      previous.role = "final";
      previous.priority = candidate.priority;
      continue;
    }
    if (events.length === 1 && previous.timeMs === 0 && previous.shape === "CLOSED" && candidate.role === "final") {
      events.push({ ...candidate, timeMs: Math.min(Math.round(envelope.durationMs), minimumEventMs), shape });
      continue;
    }
    if ((candidate.priority || 0) > (previous.priority || 0) && events.length > 1) {
      previous.shape = shape;
      previous.role = candidate.role;
      previous.priority = candidate.priority;
      previous.character = candidate.character || previous.character;
    }
  }
  const endTime = Math.round(envelope.durationMs);
  if (events.length > 1 && events.at(-1).shape === "CLOSED") events.pop();
  while (events.length > 1 && endTime - events.at(-1).timeMs < minimumEventMs) events.pop();
  const closeAt = Math.max(events.at(-1)?.timeMs + minimumEventMs || 0, endTime - minimumEventMs);
  if (closeAt <= endTime && events.at(-1)?.shape !== "CLOSED") events.push({ timeMs: closeAt, shape: "CLOSED", priority: 5 });
  return events.slice(0, 1200).map(({ timeMs, shape, character = "", characterIndex = -1, role = "pause" }) => ({ timeMs, shape, character, characterIndex, role }));
}

module.exports = {
  analyzeEnvelope,
  buildVisemeUnits,
  createAlignedVisemes,
  createTimedVisemes,
  initialViseme,
  splitTtsProgressText,
  vowelViseme,
  vowelVisemes,
};
