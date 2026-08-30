function splitLongFragment(fragment, maxChars) {
  const pieces = [];
  let remaining = fragment;
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const boundary = Math.max(
      window.lastIndexOf("，"),
      window.lastIndexOf(","),
      window.lastIndexOf("、"),
      window.lastIndexOf("："),
      window.lastIndexOf(":"),
    );
    const cut = boundary >= Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

export function splitSpeechSegments(text, { minChars = 12, maxChars = 48 } = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [normalized];
  const fragments = sentences.flatMap((sentence) => splitLongFragment(sentence.trim(), maxChars)).filter(Boolean);
  const segments = [];
  for (const fragment of fragments) {
    const previous = segments.at(-1);
    const hasTerminalPunctuation = /[。！？!?；;]$/u.test(fragment);
    if (previous && fragment.length < minChars && !hasTerminalPunctuation && previous.length + fragment.length <= maxChars) {
      segments[segments.length - 1] = `${previous}${fragment}`;
    } else {
      segments.push(fragment);
    }
  }
  if (segments.length > 1 && segments[0].length < minChars && !/[。！？!?；;]$/u.test(segments[0]) && segments[0].length + segments[1].length <= maxChars) {
    segments.splice(0, 2, `${segments[0]}${segments[1]}`);
  }
  return segments;
}

export function createSpeechTurnId(sequence, now = Date.now()) {
  return `turn-${now.toString(36)}-${Math.max(0, Number(sequence) || 0).toString(36)}`;
}

export function createSpeechChunkQueue() {
  const chunks = [];
  const waiters = [];
  let closed = false;
  let failure = null;

  const settleNext = () => {
    while (waiters.length && (chunks.length || closed || failure)) {
      const waiter = waiters.shift();
      if (failure) waiter.reject(failure);
      else waiter.resolve(chunks.shift() || null);
    }
  };

  return {
    push(chunk) {
      if (closed || failure || !chunk) return false;
      chunks.push(chunk);
      settleNext();
      return true;
    },
    close() {
      closed = true;
      settleNext();
    },
    fail(error) {
      failure = error instanceof Error ? error : new Error(String(error || "语音流失败"));
      settleNext();
    },
    next() {
      if (failure) return Promise.reject(failure);
      if (chunks.length) return Promise.resolve(chunks.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    pending() { return chunks.length; },
  };
}

export function createIncrementalSpeechSegmenter({ minChars = 10, maxChars = 42 } = {}) {
  let buffer = "";
  let closed = false;

  const drain = ({ flush = false } = {}) => {
    const segments = [];
    while (buffer) {
      const terminal = buffer.search(/[。！？!?；;\n]/u);
      if (terminal >= 0) {
        const candidate = buffer.slice(0, terminal + 1).trim();
        buffer = buffer.slice(terminal + 1).trimStart();
        if (candidate) segments.push(candidate);
        continue;
      }
      if (buffer.length >= maxChars) {
        const window = buffer.slice(0, maxChars);
        const boundaries = ["，", ",", "、", "：", ":"].map((mark) => window.lastIndexOf(mark));
        const boundary = Math.max(...boundaries);
        const cut = boundary >= minChars ? boundary + 1 : maxChars;
        const candidate = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut).trimStart();
        if (candidate) segments.push(candidate);
        continue;
      }
      if (flush) {
        const candidate = buffer.trim();
        buffer = "";
        if (candidate) segments.push(candidate);
      }
      break;
    }
    return segments;
  };

  return {
    push(delta) {
      if (closed) return [];
      buffer += String(delta || "");
      return drain();
    },
    flush() {
      if (closed) return [];
      closed = true;
      return drain({ flush: true });
    },
    pending() { return buffer; },
  };
}
