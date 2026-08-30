function firstArray(source, keys) {
  for (const key of keys) {
    if (Array.isArray(source?.[key]) && source[key].length) return source[key];
  }
  return [];
}

function extractNativeDurationAlignment(generated, sampleRate = 16000) {
  const source = generated && typeof generated === "object" ? generated : {};
  const segments = firstArray(source, ["phonemeSegments", "durationSegments", "segments"]);
  if (segments.length && segments.every((item) => item && typeof item === "object")) {
    return {
      provider: "vits-native-phoneme-durations",
      segments,
      unit: "milliseconds",
      durationCount: segments.length,
    };
  }

  const tokens = firstArray(source, ["phonemes", "durationTokens", "tokens"]);
  const durations = firstArray(source, ["phonemeDurations", "durationFrames", "durations"]);
  if (!tokens.length || tokens.length !== durations.length) return null;
  const hopLength = Math.max(1, Number(source.hopLength) || 256);
  const rate = Math.max(1, Number(source.sampleRate) || Number(sampleRate) || 16000);
  return {
    provider: "vits-native-phoneme-durations",
    tokens,
    durations,
    unit: String(source.durationUnit || (source.durationFrames ? "frames" : "frames")),
    frameShiftMs: Number(source.frameShiftMs) || hopLength / rate * 1000,
    durationCount: durations.length,
  };
}

function nativeDurationCapability(generated) {
  const alignment = extractNativeDurationAlignment(generated);
  return alignment
    ? { status: "available", provider: alignment.provider, durationCount: alignment.durationCount }
    : { status: "upstream-api-unavailable", provider: "none", durationCount: 0 };
}

module.exports = { extractNativeDurationAlignment, nativeDurationCapability };
