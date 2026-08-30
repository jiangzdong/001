const fs = require("fs");
const path = require("path");

const sharpModule = process.env.XIAOAN_SHARP_MODULE || "sharp";
const sharp = require(sharpModule);
const assetsDir = path.resolve(__dirname, "../public/assets");
const masterPath = path.join(assetsDir, "xiaoa-ditto-master-v1.0.3.png");
const jobs = [
  ["xiaoa-viseme-rest-v1.png", "xiaoa-viseme-rest-v4.png", "mouth"],
  ["xiaoa-viseme-a-v2.png", "xiaoa-viseme-a-v4.png", "mouth"],
  ["xiaoa-viseme-e-v2.png", "xiaoa-viseme-e-v4.png", "mouth"],
  ["xiaoa-viseme-o-v2.png", "xiaoa-viseme-o-v4.png", "mouth"],
  ["xiaoa-viseme-u-v1.png", "xiaoa-viseme-u-v4.png", "mouth"],
  ["xiaoa-viseme-f-v1.png", "xiaoa-viseme-f-v4.png", "mouth"],
  ["xiaoa-viseme-l-v1.png", "xiaoa-viseme-l-v4.png", "mouth"],
  ["xiaoa-viseme-s-v1.png", "xiaoa-viseme-s-v4.png", "mouth"],
  ["xiaoa-viseme-sh-v1.png", "xiaoa-viseme-sh-v4.png", "mouth"],
  ["xiaoa-blink-half-v4-generated.png", "xiaoa-blink-half-v5.png", "eyes"],
  ["xiaoa-blink-closed-v1.png", "xiaoa-blink-closed-v3.png", "eyes"],
  ["xiaoa-expression-smile-v1-raw.png", "xiaoa-expression-smile-v3.png", "expression"],
  ["xiaoa-expression-concern-v1-raw.png", "xiaoa-expression-concern-v3.png", "expression"],
  ["xiaoa-expression-encourage-v1-raw.png", "xiaoa-expression-encourage-v3.png", "expression"],
  ["xiaoa-expression-listening-v1-raw.png", "xiaoa-expression-listening-v3.png", "expression"],
];

function maskSvg(region) {
  const definitions = region === "mouth"
    // The solid core must replace both corners of the neutral master mouth.
    // A narrow mask leaves the master's smile crease visible beside an open
    // viseme and produces a visibly doubled/tilted mouth corner.
    ? [{ x: 470.5, y: 486, rx: 76, ry: 31, solid: 80 }]
    : region === "expression"
      ? [{ x: 416, y: 374, rx: 72, ry: 55, solid: 72 }, { x: 527, y: 374, rx: 78, ry: 57, solid: 72 }]
      : [{ x: 416, y: 391, rx: 52, ry: 24, solid: 84 }, { x: 527, y: 391, rx: 61, ry: 27, solid: 84 }];
  const gradients = definitions.map((ellipse, index) => `<radialGradient id="g${index}"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="${ellipse.solid}%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient>`).join("");
  const ellipses = definitions.map((ellipse, index) => `<ellipse cx="${ellipse.x}" cy="${ellipse.y}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="url(#g${index})"/>`).join("");
  return Buffer.from(`<svg width="941" height="1672" xmlns="http://www.w3.org/2000/svg"><defs>${gradients}</defs>${ellipses}</svg>`);
}

(async () => {
  const metadata = await sharp(masterPath).metadata();
  if (metadata.width !== 941 || metadata.height !== 1672) throw new Error("Unexpected portrait master dimensions");
  for (const [source, output, region] of jobs) {
    const sourcePath = path.join(assetsDir, source);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing generated source: ${source}`);
    // Keep generated pixels inside a geometry-locked region only. The mouth
    // ellipse contains lips and teeth while excluding both nasolabial areas.
    const overlay = await sharp(sourcePath)
      .resize(941, 1672, { fit: "fill" })
      .ensureAlpha()
      .composite([{ input: maskSvg(region), blend: "dest-in" }])
      .png()
      .toBuffer();
    await sharp(masterPath)
      .ensureAlpha()
      .composite([{ input: overlay, blend: "over" }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(assetsDir, output));
    console.log(`Exported ${output}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
