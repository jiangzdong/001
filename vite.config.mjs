import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { version: appVersion } = require("./package.json");
const { createSpeechService } = require("./electron/speech-service.cjs");
const { createAvatarService } = require("./electron/avatar-service.cjs");
const { createXiaoanHarness } = require("./electron/harness/index.cjs");

function combineSpeechChunks(chunks, result) {
  const usable = chunks.filter((chunk) => chunk?.samples?.length && Number(chunk.sampleRate) > 0);
  if (!result?.ok || !usable.length) return result;
  const sampleRate = Number(usable[0].sampleRate);
  const sampleCount = usable.reduce((total, chunk) => total + chunk.samples.length, 0);
  const samples = new Float32Array(sampleCount);
  const visemes = [];
  const providers = [];
  let sampleOffset = 0;
  let characterOffset = 0;
  for (const chunk of usable) {
    const chunkRate = Number(chunk.sampleRate) || sampleRate;
    const offsetMs = sampleOffset / sampleRate * 1000;
    samples.set(chunk.samples, sampleOffset);
    for (const event of chunk.visemes || []) {
      visemes.push({
        ...event,
        timeMs: Math.max(0, Number(event.timeMs) || 0) + offsetMs,
        ...(Number.isFinite(Number(event.endMs)) ? { endMs: Math.max(0, Number(event.endMs)) + offsetMs } : {}),
        ...(Number.isFinite(Number(event.characterIndex)) ? { characterIndex: Number(event.characterIndex) + characterOffset } : {}),
      });
    }
    const provider = String(chunk.alignment?.provider || "").trim();
    if (provider && !providers.includes(provider)) providers.push(provider);
    characterOffset += [...String(chunk.text || "")].length;
    sampleOffset += Math.round(chunk.samples.length * sampleRate / chunkRate);
  }
  return {
    ...result,
    ok: true,
    samples,
    sampleRate,
    visemes,
    alignment: {
      provider: providers.length === 1 ? providers[0] : "stream-aligned",
      chunkProviders: providers,
      chunkCount: usable.length,
    },
  };
}

function localSpeechApi({ previewDeepSeekKey = "" } = {}) {
  let speechService;
  let avatarService;
  let agentHarness;
  let webDeepSeekKey = "";
  const isLoopback = (request) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(String(request.socket?.remoteAddress || ""));
  const readJson = (request) => new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("请求内容格式不正确")); }
    });
  });
  const sendJson = (response, statusCode, payload) => {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(payload));
  };
  const developmentKey = () => webDeepSeekKey || previewDeepSeekKey || process.env.DEEPSEEK_API_KEY || "";
  return {
    name: "xiaoan-local-speech-api",
    configureServer(server) {
      speechService = createSpeechService({
        app: { isPackaged: false, getAppPath: () => process.cwd() },
      });
      avatarService = createAvatarService({ cacheDir: path.join(process.cwd(), ".cache", "avatar-videos") });
      const stationAdvisorSkillPath = path.join(process.cwd(), "skills", "station-advisor-agent-v1", "SKILL.md");
      agentHarness = createXiaoanHarness({
        getDeepSeekKey: developmentKey,
        skillText: fs.existsSync(stationAdvisorSkillPath) ? fs.readFileSync(stationAdvisorSkillPath, "utf8") : "",
      });
      server.middlewares.use("/api/deepseek/status", (request, response, next) => {
        if (request.method !== "GET") { next(); return; }
        if (!isLoopback(request)) { sendJson(response, 403, { ok: false, message: "仅允许本机网页测试" }); return; }
        sendJson(response, 200, { ok: true, configured: Boolean(developmentKey()), storage: webDeepSeekKey ? "memory" : previewDeepSeekKey ? "local-preview" : process.env.DEEPSEEK_API_KEY ? "environment" : "none" });
      });
      server.middlewares.use("/api/deepseek/save", async (request, response, next) => {
        if (request.method !== "POST") { next(); return; }
        if (!isLoopback(request)) { sendJson(response, 403, { ok: false, message: "仅允许本机网页测试" }); return; }
        try {
          const key = String((await readJson(request)).key || "").trim();
          if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(key)) throw new Error("密钥格式不正确");
          webDeepSeekKey = key;
          sendJson(response, 200, { ok: true });
        } catch (error) {
          sendJson(response, 400, { ok: false, message: error?.message || "密钥未能保存" });
        }
      });
      server.middlewares.use("/api/deepseek/clear", (request, response, next) => {
        if (request.method !== "POST") { next(); return; }
        if (!isLoopback(request)) { sendJson(response, 403, { ok: false, message: "仅允许本机网页测试" }); return; }
        if (!webDeepSeekKey && (previewDeepSeekKey || process.env.DEEPSEEK_API_KEY)) { sendJson(response, 409, { ok: false, message: "当前密钥由本机预览配置提供，请在本机配置文件中管理" }); return; }
        webDeepSeekKey = "";
        sendJson(response, 200, { ok: true });
      });
      server.middlewares.use("/api/agent/status", (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(agentHarness.status()));
      });
      server.middlewares.use("/api/agent/turn", (request, response, next) => {
        if (request.method !== "POST" || request.url !== "/") { next(); return; }
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const result = await agentHarness.run(payload);
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify(result));
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: false, status: "recoverable_error", error: { code: "AGENT_API_ERROR", message: error?.message || "智能体暂时不可用" } }));
          }
        });
      });
      server.middlewares.use("/api/speech/status", (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(speechService.status()));
      });
      server.middlewares.use("/api/speech/recognize", (request, response, next) => {
        if (request.method !== "POST" || request.url !== "/") { next(); return; }
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const body = Buffer.concat(chunks);
            const alignedLength = body.byteLength - (body.byteLength % 4);
            const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + alignedLength);
            const result = await speechService.recognize({ samples: new Float32Array(arrayBuffer), sampleRate: 16000 });
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(result));
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: false, message: error?.message || "本地语音识别暂时不可用" }));
          }
        });
      });
      server.middlewares.use("/api/speech/recognize-preview", (request, response, next) => {
        if (request.method !== "POST" || request.url !== "/") { next(); return; }
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const body = Buffer.concat(chunks);
            const alignedLength = body.byteLength - (body.byteLength % 4);
            const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + alignedLength);
            const result = await speechService.recognizePreview({ samples: new Float32Array(arrayBuffer), sampleRate: 16000 });
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify(result));
          } catch {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: false, preview: true }));
          }
        });
      });
      server.middlewares.use("/api/speech/synthesize", (request, response, next) => {
        if (request.method !== "POST") { next(); return; }
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          let turnId = "";
          let completed = false;
          const cancelTurn = () => {
            if (!completed && turnId) speechService.cancelTurn(turnId);
          };
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const text = String(payload.text || "").trim().slice(0, 500);
            if (!text) throw new Error("缺少需要播报的文字");
            turnId = String(payload.turnId || "").trim().slice(0, 120);
            request.once("aborted", cancelTurn);
            response.once("close", cancelTurn);
            const speechChunks = [];
            const streamResult = await speechService.synthesizeStream({
              text,
              speed: payload.speed,
              voiceId: payload.voiceId,
              turnId,
            }, (chunk) => speechChunks.push(chunk));
            const result = combineSpeechChunks(speechChunks, streamResult);
            if (response.destroyed || response.writableEnded) return;
            response.statusCode = result?.ok ? 200 : 503;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            completed = true;
            response.end(JSON.stringify({
              ...result,
              samples: Array.from(result?.samples || []),
            }));
          } catch (error) {
            if (response.destroyed || response.writableEnded) return;
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            completed = true;
            response.end(JSON.stringify({ ok: false, message: error?.message || "本地语音合成暂时不可用" }));
          } finally {
            request.removeListener("aborted", cancelTurn);
            response.removeListener("close", cancelTurn);
          }
        });
      });
      server.middlewares.use("/api/avatar/status", async (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(await avatarService.status()));
      });
      server.middlewares.use("/api/avatar/render", (request, response, next) => {
        if (request.method !== "POST") { next(); return; }
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const turnId = String(payload.turnId || "").trim().slice(0, 120);
            const cancelTurn = () => { if (!response.writableEnded && turnId) avatarService.cancelTurn(turnId); };
            request.once("aborted", cancelTurn);
            response.once("close", cancelTurn);
            const result = await avatarService.renderText({
              text: payload.text,
              speed: payload.speed,
              voiceId: payload.voiceId,
              turnId,
              synthesize: (options) => speechService.synthesize(options),
            });
            request.removeListener("aborted", cancelTurn);
            response.removeListener("close", cancelTurn);
            if (!result.ok) throw new Error(result.message || "云端嘴型生成失败");
            response.statusCode = 200;
            response.setHeader("Content-Type", result.contentType);
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Cache-Hit", result.cacheHit ? "1" : "0");
            response.setHeader("X-Cache-Tier", result.cacheTier || "none");
            response.setHeader("X-Deduplicated", result.deduplicated ? "1" : "0");
            response.setHeader("X-Synth-Seconds", Number(result.synthSeconds || 0).toFixed(3));
            response.setHeader("X-Queue-Seconds", Number(result.queueSeconds || 0).toFixed(3));
            response.setHeader("X-Render-Seconds", Number(result.renderSeconds || 0).toFixed(3));
            response.setHeader("X-Total-Seconds", Number(result.totalSeconds || 0).toFixed(3));
            response.end(Buffer.from(result.bytes));
          } catch (error) {
            if (response.destroyed || response.writableEnded) return;
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ok: false, message: error?.message || "云端数字人暂时不可用" }));
          }
        });
      });
      return () => {
        agentHarness?.clearSession?.("station-advisor");
        speechService?.close();
      };
    },
  };
}

function stationAdvisorAssets() {
  const avatarAssets = [
    "xiaoa-fullbody-extension-v1.0.0.png",
    "xiaoa-ditto-master-v1.0.3.png",
    "xiaoa-viseme-rest-v5.png",
    "xiaoa-viseme-a-v5.png",
    "xiaoa-viseme-e-v5.png",
    "xiaoa-viseme-o-v10.png",
    "xiaoa-viseme-u-v8.png",
    "xiaoa-viseme-mbp-v5.png",
    "xiaoa-viseme-f-v5.png",
    "xiaoa-viseme-l-v5.png",
    "xiaoa-viseme-ndt-v5.png",
    "xiaoa-viseme-s-v5.png",
    "xiaoa-viseme-sh-v5.png",
    "xiaoa-mouth-mask-rest-v1.png",
    "xiaoa-mouth-mask-a-v1.png",
    "xiaoa-mouth-mask-e-v1.png",
    "xiaoa-mouth-mask-o-v1.png",
    "xiaoa-mouth-mask-u-v1.png",
    "xiaoa-mouth-mask-mbp-v1.png",
    "xiaoa-mouth-mask-f-v1.png",
    "xiaoa-mouth-mask-l-v1.png",
    "xiaoa-mouth-mask-ndt-v1.png",
    "xiaoa-mouth-mask-s-v1.png",
    "xiaoa-mouth-mask-sh-v1.png",
    "xiaoa-expression-smile-v4.png",
    "xiaoa-expression-concern-v4.png",
    "xiaoa-expression-encourage-v4.png",
    "xiaoa-expression-listening-v4.png",
    "xiaoa-expression-clarify-v1.png",
    "xiaoa-blink-half-v6.png",
    "xiaoa-blink-closed-v4.png",
  ];
  return {
    name: "station-advisor-assets",
    closeBundle() {
      const outputAssets = path.resolve("dist/client/assets");
      fs.mkdirSync(outputAssets, { recursive: true });
      for (const assetName of avatarAssets) {
        const sourceAvatar = path.resolve("public/assets", assetName);
        const outputAvatar = path.join(outputAssets, assetName);
        try {
          fs.linkSync(sourceAvatar, outputAvatar);
        } catch {
          fs.copyFileSync(sourceAvatar, outputAvatar);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // This is read only by Vite's local Node process. It is never placed in the
  // client bundle or returned by a browser API.
  const previewEnv = loadEnv(mode, process.cwd(), "DEEPSEEK_");
  return {
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: {
      outDir: "dist/client",
      copyPublicDir: false,
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react(), localSpeechApi({ previewDeepSeekKey: previewEnv.DEEPSEEK_API_KEY }), stationAdvisorAssets()],
  };
});
