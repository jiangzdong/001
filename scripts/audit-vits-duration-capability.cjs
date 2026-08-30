const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const modelPath = path.join(projectRoot, "models", "sherpa-onnx-vits-zh-ll", "model.onnx");
const bindingPath = path.join(projectRoot, "node_modules", "sherpa-onnx-node", "types.js");
const model = fs.readFileSync(modelPath);
const binding = fs.readFileSync(bindingPath, "utf8");
const hasInternalDurationNode = model.includes(Buffer.from("/Ceil_output_0"));
const bindingExportsDurations = /phonemeDurations|durationFrames|durationSegments/.test(binding);
const report = {
  modelPath,
  modelHasInternalDurationNode: hasInternalDurationNode,
  nodeBindingExportsDurations: bindingExportsDurations,
  status: hasInternalDurationNode && bindingExportsDurations ? "available" : hasInternalDurationNode ? "internal-only" : "not-detected",
  runtimePriority: ["vits-native-phoneme-durations", "sensevoice-character-timestamps", "weighted-pcm-fallback"],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
