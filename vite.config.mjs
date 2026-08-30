import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { version: appVersion } = require("./package.json");
const { createSpeechService } = require("./electron/speech-service.cjs");
const { createAvatarService } = require("./electron/avatar-service.cjs");

function localSpeechApi() {
  let speechService;
  let avatarService;
  return {
    name: "xiaoan-local-speech-api",
    configureServer(server) {
      speechService = createSpeechService({
        app: { isPackaged: false, getAppPath: () => process.cwd() },
      });
      avatarService = createAvatarService({ cacheDir: path.join(process.cwd(), ".cache", "avatar-videos") });
      server.middlewares.use("/api/speech/status", (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(speechService.status()));
      });
      server.middlewares.use("/api/speech/recognize", (request, response, next) => {
        if (request.method !== "POST") { next(); return; }
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
      return () => speechService?.close();
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "dist/client",
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
  plugins: [react(), localSpeechApi()],
});
