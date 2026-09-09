"use strict";

const fs = require("fs");
const path = require("path");

const SPEECH_ENGINES = Object.freeze(["vits", "qwen3-tts"]);
const DEFAULT_SPEECH_ENGINE = "vits";

function normalizeSpeechEngine(value) {
  return SPEECH_ENGINES.includes(value) ? value : DEFAULT_SPEECH_ENGINE;
}

function createSpeechEngineSettings({ filePath, platform = process.platform, arch = process.arch } = {}) {
  if (!filePath) throw new Error("speech engine settings filePath is required");

  function persist(requested) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, requested }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      let requested = normalizeSpeechEngine(parsed?.requested);
      if (requested === "qwen3-tts" && (platform !== "darwin" || arch !== "arm64")) {
        requested = DEFAULT_SPEECH_ENGINE;
        persist(requested);
      }
      return { requested };
    } catch {
      return { requested: DEFAULT_SPEECH_ENGINE };
    }
  }

  function write(requested) {
    const normalized = normalizeSpeechEngine(requested);
    if (requested !== normalized) return { ok: false, code: "SPEECH_ENGINE_INVALID", requested: read().requested };
    if (normalized === "qwen3-tts" && (platform !== "darwin" || arch !== "arm64")) {
      return { ok: false, code: "SPEECH_ENGINE_UNSUPPORTED_PLATFORM", requested: read().requested };
    }
    persist(normalized);
    return { ok: true, requested: normalized };
  }

  return { read, write, engines: [...SPEECH_ENGINES] };
}

module.exports = { SPEECH_ENGINES, DEFAULT_SPEECH_ENGINE, normalizeSpeechEngine, createSpeechEngineSettings };
