const path = require("path");
const { createSpeechService } = require("../electron/speech-service.cjs");

const projectRoot = path.join(__dirname, "..");
const speech = createSpeechService({ app: { isPackaged: false, getAppPath: () => projectRoot } });

(async () => {
  const result = await speech.synthesize({ text: "妈妈您好，我是小安。", speed: 1, voiceId: "zh-ll-2" });
  if (!result.ok || !result.samples?.length) throw new Error("Viseme test returned no audio");
  const events = result.visemes || [];
  const shapes = new Set(events.map((event) => event?.shape));
  if (!shapes.has("CLOSED") || shapes.size < 3) throw new Error(`Viseme sequence is incomplete: ${[...shapes].join(",")}`);
  if (!events.every((event, index) => Number.isFinite(event?.timeMs) && (index === 0 || event.timeMs > events[index - 1].timeMs))) throw new Error("Viseme timestamps are not strictly monotonic");
  console.log(`VISEME OK: ${events.length} timestamped events, shapes=${[...shapes].join(",")}`);
})().finally(() => speech.close()).catch((error) => { console.error(error); process.exitCode = 1; });
