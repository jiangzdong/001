function parseSseBuffer(source, { flush = false } = {}) {
  const normalized = String(source || "").replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = flush ? "" : parts.pop() || "";
  const complete = flush ? parts : parts;
  const events = complete
    .map((block) => block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n"))
    .filter(Boolean);
  return { events, remainder };
}

function decodeJsonStringPrefix(encoded) {
  let output = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const char = encoded[index];
    if (char !== "\\") {
      if (char === '"') return { value: output, complete: true };
      output += char;
      continue;
    }
    if (index + 1 >= encoded.length) break;
    const escaped = encoded[index + 1];
    if (escaped === "u") {
      const hex = encoded.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      output += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    output += Object.prototype.hasOwnProperty.call(map, escaped) ? map[escaped] : escaped;
    index += 1;
  }
  return { value: output, complete: false };
}

function extractJsonStringPrefix(source, key) {
  const text = String(source || "");
  const marker = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"\\s*:\\s*"`);
  const match = marker.exec(text);
  if (!match) return { value: "", complete: false, found: false };
  const decoded = decodeJsonStringPrefix(text.slice(match.index + match[0].length));
  return { ...decoded, found: true };
}

function createReplyDeltaTracker() {
  let delivered = "";
  return {
    update(rawJson) {
      const current = extractJsonStringPrefix(rawJson, "reply");
      if (!current.found || !current.value.startsWith(delivered)) return { delta: "", ...current };
      const delta = current.value.slice(delivered.length);
      delivered = current.value;
      return { delta, ...current };
    },
    value() { return delivered; },
  };
}

function normalizeDeepSeekChatResult(parsed, fallbackDomain = "general") {
  const intents = new Set(["health_answer", "health_question", "off_topic", "meta"]);
  const domains = new Set(["assessment", "glucose", "massage", "rehabilitation", "sleep", "brain", "exercise", "general"]);
  const nextActions = new Set(["answer", "ask", "plan", "medical_guidance", "resume"]);
  const reply = String(parsed?.reply || "").trim().slice(0, 240);
  if (!reply) return { ok: false, message: "AI 返回内容不完整" };
  const options = (Array.isArray(parsed?.options) ? parsed.options : []).slice(0, 4).map((item, index) => ({
    id: String(item?.id || `option-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || `option-${index + 1}`,
    label: String(item?.label || "").trim().slice(0, 18),
  })).filter((item) => item.label);
  return {
    ok: true,
    text: reply,
    intent: intents.has(parsed?.intent) ? parsed.intent : "health_question",
    domain: domains.has(parsed?.domain) ? parsed.domain : fallbackDomain,
    nextAction: nextActions.has(parsed?.nextAction) ? parsed.nextAction : "answer",
    redirectStyle: String(parsed?.redirectStyle || "no_redirect"),
    options: options.length >= 2 ? options : [],
  };
}

module.exports = {
  createReplyDeltaTracker,
  decodeJsonStringPrefix,
  extractJsonStringPrefix,
  normalizeDeepSeekChatResult,
  parseSseBuffer,
};
