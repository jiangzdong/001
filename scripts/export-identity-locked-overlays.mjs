import fs from "node:fs/promises";
import path from "node:path";

const cdpUrl = process.env.XIAOAN_CDP_URL || "http://127.0.0.1:9229";
const targets = await fetch(`${cdpUrl}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("Electron page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};

await send("Runtime.enable");

const assetsDir = path.resolve("public/assets");
const jobs = [
  ["xiaoa-viseme-rest-v1.png", "xiaoa-viseme-rest-v3.png", "mouth"],
  ["xiaoa-viseme-a-v2.png", "xiaoa-viseme-a-v3.png", "mouth"],
  ["xiaoa-viseme-e-v2.png", "xiaoa-viseme-e-v3.png", "mouth"],
  ["xiaoa-viseme-o-v2.png", "xiaoa-viseme-o-v3.png", "mouth"],
  ["xiaoa-viseme-u-v1.png", "xiaoa-viseme-u-v3.png", "mouth"],
  ["xiaoa-viseme-f-v1.png", "xiaoa-viseme-f-v3.png", "mouth"],
  ["xiaoa-viseme-l-v1.png", "xiaoa-viseme-l-v3.png", "mouth"],
  ["xiaoa-viseme-s-v1.png", "xiaoa-viseme-s-v3.png", "mouth"],
  ["xiaoa-viseme-sh-v1.png", "xiaoa-viseme-sh-v3.png", "mouth"],
  ["xiaoa-blink-half-v3-raw.png", "xiaoa-blink-half-v3.png", "eyes"],
  ["xiaoa-blink-half-v4-generated.png", "xiaoa-blink-half-v4.png", "eyes"],
  ["xiaoa-blink-closed-v1.png", "xiaoa-blink-closed-v2.png", "eyes"],
  ["xiaoa-expression-smile-v1-raw.png", "xiaoa-expression-smile-v2.png", "expression"],
  ["xiaoa-expression-concern-v1-raw.png", "xiaoa-expression-concern-v2.png", "expression"],
  ["xiaoa-expression-encourage-v1-raw.png", "xiaoa-expression-encourage-v2.png", "expression"],
  ["xiaoa-expression-listening-v1-raw.png", "xiaoa-expression-listening-v2.png", "expression"],
];

for (const [source, output, region] of jobs) {
  const dataUrl = await evaluate(`(async () => {
    const load = async (url) => {
      const image = new Image();
      image.src = new URL(url, document.baseURI).href;
      await image.decode();
      return image;
    };
    const [master, generated] = await Promise.all([
      load('./assets/xiaoa-ditto-master-v1.0.2.png'),
      load('./assets/${source}'),
    ]);
    if (master.naturalWidth !== generated.naturalWidth || master.naturalHeight !== generated.naturalHeight) throw new Error('Overlay dimensions do not match the portrait master');
    const width = master.naturalWidth;
    const height = master.naturalHeight;
    const masterCanvas = document.createElement('canvas');
    const generatedCanvas = document.createElement('canvas');
    const outputCanvas = document.createElement('canvas');
    for (const canvas of [masterCanvas, generatedCanvas, outputCanvas]) { canvas.width = width; canvas.height = height; }
    const masterContext = masterCanvas.getContext('2d', { willReadFrequently: true });
    const generatedContext = generatedCanvas.getContext('2d', { willReadFrequently: true });
    const outputContext = outputCanvas.getContext('2d');
    masterContext.drawImage(master, 0, 0);
    generatedContext.drawImage(generated, 0, 0);
    const masterPixels = masterContext.getImageData(0, 0, width, height);
    const generatedPixels = generatedContext.getImageData(0, 0, width, height);
    const outputPixels = new ImageData(new Uint8ClampedArray(masterPixels.data), width, height);
    const ellipses = ${JSON.stringify(region === "mouth"
      ? [{ x: 470.5, y: 478.5, rx: 58, ry: 25 }]
      : region === "expression"
        ? [{ x: 416, y: 374, rx: 72, ry: 55 }, { x: 527, y: 374, rx: 78, ry: 57 }]
        : [{ x: 416, y: 391, rx: 52, ry: 24 }, { x: 527, y: 391, rx: 61, ry: 27 }])};
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let spatial = 0;
        for (const ellipse of ellipses) {
          const distance = Math.sqrt(((x - ellipse.x) / ellipse.rx) ** 2 + ((y - ellipse.y) / ellipse.ry) ** 2);
          spatial = Math.max(spatial, Math.max(0, Math.min(1, (1 - distance) / ${region === "mouth" ? ".4" : region === "expression" ? ".28" : ".16"})));
        }
        if (spatial <= 0) continue;
        const offset = (y * width + x) * 4;
        const dr = Math.abs(masterPixels.data[offset] - generatedPixels.data[offset]);
        const dg = Math.abs(masterPixels.data[offset + 1] - generatedPixels.data[offset + 1]);
        const db = Math.abs(masterPixels.data[offset + 2] - generatedPixels.data[offset + 2]);
        const difference = Math.max(dr, dg, db);
        const alpha = spatial;
        if (alpha <= 0) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          const original = masterPixels.data[offset + channel];
          const replacement = generatedPixels.data[offset + channel];
          outputPixels.data[offset + channel] = Math.round(original + (replacement - original) * alpha);
        }
      }
    }
    outputContext.putImageData(outputPixels, 0, 0);
    return outputCanvas.toDataURL('image/png');
  })()`);
  const payload = dataUrl.replace(/^data:image\/png;base64,/, "");
  await fs.writeFile(path.join(assetsDir, output), Buffer.from(payload, "base64"));
  console.log(`Exported ${output}`);
}

socket.close();
