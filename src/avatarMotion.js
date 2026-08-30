const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export function smoothingAlpha(deltaMs, timeConstantMs) {
  const elapsed = Math.min(80, Math.max(0, Number(deltaMs) || 0));
  const timeConstant = Math.max(1, Number(timeConstantMs) || 1);
  return 1 - Math.exp(-elapsed / timeConstant);
}

export function sampleBlinkEnvelope(elapsedMs, { closeMs = 130, holdMs = 65, openMs = 210 } = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const closeDuration = Math.max(1, Number(closeMs) || 1);
  const holdDuration = Math.max(0, Number(holdMs) || 0);
  const openDuration = Math.max(1, Number(openMs) || 1);
  const holdEnd = closeDuration + holdDuration;
  const totalMs = holdEnd + openDuration;
  if (elapsed >= totalMs) return { amount: 0, complete: true, totalMs };
  if (elapsed < closeDuration) {
    const progress = elapsed / closeDuration;
    return { amount: progress * progress * (3 - 2 * progress), complete: false, totalMs };
  }
  if (elapsed < holdEnd) return { amount: 1, complete: false, totalMs };
  const progress = (elapsed - holdEnd) / openDuration;
  return { amount: (1 - progress) ** 1.35, complete: false, totalMs };
}

export function nextBlinkDelay(randomValue = 0.5, { mood = "neutral", speaking = false, doubleBlink = false } = {}) {
  const random = clamp01(randomValue);
  if (doubleBlink) return 135 + random * 65;
  const cadence = {
    concern: [2400, 2300],
    encourage: [3000, 2800],
    listening: [2200, 2300],
    smile: [3000, 3100],
    neutral: [2800, 3400],
  }[mood] || [2800, 3400];
  const speakingAdjustment = speaking ? 280 : 0;
  return Math.max(1900, cadence[0] + speakingAdjustment + cadence[1] * random);
}

export function createBlinkProfile(randomValue = 0.5, { speaking = false, doubleBlink = false } = {}) {
  const random = clamp01(randomValue);
  if (doubleBlink) return { closeMs: 92 + random * 18, holdMs: 36 + random * 14, openMs: 142 + random * 34 };
  return {
    closeMs: 112 + random * 28,
    holdMs: 48 + (1 - random) * 24,
    openMs: 178 + random * 48 + (speaking ? 12 : 0),
  };
}

export function inferSpeechMood(text) {
  const value = String(text || "");
  if (/(疼|痛|不适|难受|担心|异常|注意|风险|严重|及时就医|医生)/u.test(value)) return "concern";
  if (/(可以|建议|先|试试|一起|慢慢|坚持|帮助|改善|记录|保持|计划)/u.test(value)) return "encourage";
  if (/(您好|你好|很高兴|谢谢|做得很好|放心)/u.test(value)) return "smile";
  return "neutral";
}

export function createSpeechProsodyTimeline(text, durationMs) {
  const value = String(text || "");
  const characters = [...value];
  const duration = Math.max(1, Number(durationMs) || 1);
  const events = [];
  characters.forEach((character, index) => {
    if (!/[，、。！？；：,.!?;:]/u.test(character)) return;
    const terminal = /[。！？.!?]/u.test(character);
    events.push({
      timeMs: duration * ((index + 0.6) / Math.max(1, characters.length)),
      strength: terminal ? 1 : 0.58,
      direction: /[？?]/u.test(character) ? -1 : 1,
    });
  });
  return { durationMs: duration, events };
}

export function sampleSpeechProsody(timeline, elapsedMs) {
  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  let nod = 0;
  let tilt = 0;
  for (const event of events) {
    const distance = elapsed - (Number(event.timeMs) || 0);
    if (distance < -170 || distance > 260) continue;
    const width = distance < 0 ? 115 : 175;
    const pulse = Math.exp(-0.5 * (distance / width) ** 2) * clamp01(event.strength);
    nod += pulse * (event.direction === -1 ? -0.55 : 1);
    tilt += pulse * (event.direction === -1 ? 0.34 : -0.18);
  }
  return { nod: Math.max(-1, Math.min(1, nod)), tilt: Math.max(-1, Math.min(1, tilt)) };
}

export function sampleExpressionStrength({ mood = "neutral", speaking = false, elapsedMs = 0, energy = 0, prosody = {} } = {}) {
  const normalizedMood = ["smile", "concern", "encourage", "listening"].includes(mood) ? mood : "neutral";
  if (normalizedMood === "neutral") return 0;
  const base = { smile: 0.54, concern: 0.63, encourage: 0.57, listening: 0.5 }[normalizedMood];
  if (!speaking) return normalizedMood === "listening" ? 0.45 : Math.min(0.42, base);
  const onset = clamp01(Number(elapsedMs) / 640);
  const easedOnset = onset * onset * (3 - 2 * onset);
  // Expression follows sentence intent, not every syllable. Keep the slow
  // respiratory drift, but heavily attenuate PCM energy so eyebrows cannot
  // chatter with the waveform.
  const breath = 0.99 + Math.sin(Math.max(0, Number(elapsedMs)) * 0.00118 + 0.7) * 0.012;
  const energyLift = (clamp01(energy) - 0.38) * 0.018;
  const punctuationEase = 1 - Math.min(0.04, Math.abs(Number(prosody?.nod) || 0) * 0.035);
  return clamp01((base * breath + energyLift) * easedOnset * punctuationEase);
}

export function sampleJawPose({ mouthOpen = 0, energy = 0, speaking = false } = {}) {
  if (!speaking) return { open: 0, drop: 0, scaleY: 1, scaleX: 1, cheek: 0 };
  const aperture = clamp01(mouthOpen);
  // Adult speech coordinates the mandible with the lips instead of translating
  // the whole lower face. Keep vowel aperture authoritative and reserve only a
  // tiny PCM accent; the visible replacement is limited to lower lip and chin.
  const open = clamp01(Math.pow(aperture, 0.9) * 0.84 + clamp01(energy) * 0.018);
  return {
    open,
    // A single lower-face replacement stretches from a fixed upper-lip pivot.
    // This preserves the prominent chin without stacking a second moving chin
    // over the stationary portrait.
    drop: 0,
    scaleY: 1 + open * 0.11,
    scaleX: 1,
    cheek: open * 0.08,
  };
}

export function sampleUpperBodyPose({ elapsedMs = 0, speaking = false, motion = 1, energy = 0, prosody = {}, moodTilt = 0, moodY = 0 } = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const amount = clamp01(motion);
  const breath = (Math.sin(elapsed * 0.00118 + 0.35) + 1) * 0.5;
  const chestBreath = breath * breath * (3 - 2 * breath);

  return {
    // Keep the source head, nose and both neck edges rigid. The prior whole-
    // portrait sway made one photographed neck contour appear to jitter more
    // than the other. Only the clavicle-below breathing layer moves now.
    x: 0,
    y: 0,
    tilt: 0,
    scale: 1,
    breath,
    chestRise: -0.12 * chestBreath * amount,
    chestScaleX: 1 + 0.006 * chestBreath * amount,
    chestScaleY: 1 + 0.0035 * chestBreath * amount,
  };
}

export function advanceVisemeBlend(state, desiredLabel, timestamp, durations = {}) {
  const now = Math.max(0, Number(timestamp) || 0);
  const desired = String(desiredLabel || "CLOSED");
  const openingMs = Math.max(1, Number(durations.openingMs) || 96);
  const changingMs = Math.max(1, Number(durations.changingMs) || 108);
  const closingMs = Math.max(1, Number(durations.closingMs) || 122);
  let next = state && typeof state === "object"
    ? { from: String(state.from || "CLOSED"), to: String(state.to || "CLOSED"), startedAt: Number(state.startedAt) || 0, durationMs: Math.max(1, Number(state.durationMs) || changingMs) }
    : { from: "CLOSED", to: "CLOSED", startedAt: now, durationMs: changingMs };

  const previousRaw = clamp01((now - next.startedAt) / next.durationMs);
  const previousMix = previousRaw * previousRaw * (3 - 2 * previousRaw);
  if (desired !== next.to) {
    const dominant = previousMix < 0.5 ? next.from : next.to;
    next = {
      from: dominant,
      to: desired,
      startedAt: now,
      durationMs: desired === "CLOSED" ? closingMs : dominant === "CLOSED" ? openingMs : changingMs,
    };
  }

  const raw = clamp01((now - next.startedAt) / next.durationMs);
  let mix = raw * raw * (3 - 2 * raw);
  // Keep one dominant frame for deterministic acceptance at the exact midpoint.
  if (Math.abs(mix - 0.5) < 0.0001) mix = 0.5001;
  const weights = {};
  if (next.from !== "CLOSED" && 1 - mix > 0.000001) weights[next.from] = (weights[next.from] || 0) + (1 - mix);
  if (next.to !== "CLOSED" && mix > 0.000001) weights[next.to] = (weights[next.to] || 0) + mix;
  return { ...next, mix, dominant: mix < 0.5 ? next.from : next.to, weights };
}

export function sampleVisemeTimeline(timeline, performanceNow = 0) {
  const visemes = Array.isArray(timeline?.visemes) ? timeline.visemes : [];
  const durationMs = Number(timeline?.durationMs) || 0;
  if (!visemes.length || durationMs <= 0) return { current: "REST", next: "REST", mix: 0, progress: 0 };

  const contextTime = Number(timeline?.audioContext?.currentTime);
  const contextStart = Number(timeline?.startedAtContext);
  const elapsedMs = Number.isFinite(contextTime) && Number.isFinite(contextStart)
    ? (contextTime - contextStart) * 1000
    : Number(performanceNow) - (Number(timeline?.startedAtPerformance) || 0);
  const progress = Math.min(0.999999, Math.max(0, elapsedMs / durationMs));
  if (typeof visemes[0] === "object" && visemes[0] !== null) {
    const clampedElapsed = Math.max(0, elapsedMs);
    let low = 0;
    let high = visemes.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((Number(visemes[middle]?.timeMs) || 0) <= clampedElapsed) low = middle;
      else high = middle - 1;
    }
    const current = visemes[low]?.shape || "REST";
    const next = visemes[Math.min(low + 1, visemes.length - 1)]?.shape || current;
    const currentTime = Number(visemes[low]?.timeMs) || 0;
    const nextTime = Number(visemes[Math.min(low + 1, visemes.length - 1)]?.timeMs) || currentTime;
    const eventSpan = Math.max(0, nextTime - currentTime);
    // Real lips spend roughly a tenth of a second coarticulating between
    // neighboring sounds. A slightly wider window removes the card-flip look
    // without shifting the character timestamp itself.
    const transitionMs = Math.min(124, Math.max(78, eventSpan * 0.52));
    const transitionStart = Math.max(currentTime, nextTime - transitionMs);
    const rawMix = nextTime > transitionStart ? clamp01((clampedElapsed - transitionStart) / (nextTime - transitionStart)) : 0;
    const mix = rawMix * rawMix * (3 - 2 * rawMix);
    return { current, next, mix, progress, discrete: false, eventIndex: low, transitionMs };
  }
  const position = progress * Math.max(0, visemes.length - 1);
  const index = Math.floor(position);
  const rawMix = position - index;
  const mix = rawMix * rawMix * (3 - 2 * rawMix);
  return {
    current: visemes[index] || "REST",
    next: visemes[Math.min(index + 1, visemes.length - 1)] || visemes[index] || "REST",
    mix,
    progress,
  };
}

export function blendVisemeProfiles(profiles, sample) {
  const current = profiles[sample?.current] || profiles.REST;
  const next = profiles[sample?.next] || current;
  const mix = clamp01(sample?.mix);
  return {
    open: current.open + (next.open - current.open) * mix,
    width: current.width + (next.width - current.width) * mix,
    radius: mix < 0.5 ? current.radius : next.radius,
    label: sample?.discrete ? sample?.current || "REST" : mix < 0.5 ? sample?.current || "REST" : sample?.next || "REST",
  };
}

export function sampleMouthAperture({ profileOpen = 0, energy = 0, timelineDriven = false, speaking = false } = {}) {
  if (!speaking) return 0;
  const authoredOpen = clamp01(profileOpen);
  const speechEnergy = clamp01(energy);
  // Timestamped visemes already describe when the mouth should be open. PCM
  // energy is only a restrained accent here; using it as the primary driver
  // makes sustained vowels collapse and reopen at every waveform valley.
  const base = timelineDriven ? 0.72 : 0.1;
  const accent = timelineDriven ? 0.22 : 0.92;
  return clamp01(authoredOpen * (base + speechEnergy * accent));
}

export function updateVisemeGate(state, level, timestamp, speaking = true) {
  const now = Math.max(0, Number(timestamp) || 0);
  const energy = clamp01(level);
  if (!speaking) return { open: false, closeAt: now };
  let open = Boolean(state?.open);
  let closeAt = Math.max(0, Number(state?.closeAt) || 0);
  if (energy >= 0.075) {
    open = true;
    closeAt = now + 130;
  } else if (energy > 0.028 && open) closeAt = Math.max(closeAt, now + 70);
  else if (open && now >= closeAt) open = false;
  return { open, closeAt };
}

export function stabilizeVisemeLabel(state, desiredLabel, timestamp, speaking = true, { timestamped = false } = {}) {
  const now = Math.max(0, Number(timestamp) || 0);
  if (!speaking) return { displayed: "CLOSED", candidate: "CLOSED", candidateSince: now, changedAt: now };
  const desired = String(desiredLabel || "CLOSED");
  let displayed = String(state?.displayed || "CLOSED");
  let candidate = String(state?.candidate || displayed);
  let candidateSince = Math.max(0, Number(state?.candidateSince) || 0);
  let changedAt = Math.max(0, Number(state?.changedAt) || 0);
  if (candidate !== desired) {
    candidate = desired;
    candidateSince = now;
  }
  const candidateHoldMs = timestamped ? 8 : desired === "CLOSED" ? 96 : displayed === "CLOSED" ? 56 : 72;
  const minimumDwellMs = timestamped ? 64 : displayed === "CLOSED" ? 84 : 136;
  if (desired !== displayed && now - candidateSince >= candidateHoldMs && now - changedAt >= minimumDwellMs) {
    displayed = desired;
    changedAt = now;
  }
  return { displayed, candidate, candidateSince, changedAt };
}

export function shouldUseAuthenticAvatar(conversationState) {
  return Boolean(
    conversationState?.handled
    && conversationState?.type !== "safety"
    && !conversationState?.safetySignal,
  );
}
