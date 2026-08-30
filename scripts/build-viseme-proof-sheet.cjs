const fs = require("fs");
const path = require("path");

const sharp = require(process.env.XIAOAN_SHARP_MODULE || "sharp");
const projectRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(projectRoot, "public", "assets");
const outputPath = path.resolve(process.argv[2] || path.join(projectRoot, "qa", "viseme-asset-proof.png"));
const frames = [
  ["CLOSED", "xiaoa-ditto-master-v1.0.2.png"],
  ["REST", "xiaoa-viseme-rest-v3.png"],
  ["A", "xiaoa-viseme-a-v3.png"],
  ["E", "xiaoa-viseme-e-v3.png"],
  ["O", "xiaoa-viseme-o-v3.png"],
  ["U", "xiaoa-viseme-u-v3.png"],
  ["F", "xiaoa-viseme-f-v3.png"],
  ["L", "xiaoa-viseme-l-v3.png"],
  ["S", "xiaoa-viseme-s-v3.png"],
  ["SH", "xiaoa-viseme-sh-v3.png"],
];

(async () => {
  const tileWidth = 360;
  const tileHeight = 250;
  const columns = 5;
  const tiles = await Promise.all(frames.map(async ([label, file]) => {
    const crop = await sharp(path.join(assetsDir, file))
      .extract({ left: 350, top: 405, width: 240, height: 150 })
      .resize(tileWidth, 225, { fit: "fill" })
      .png()
      .toBuffer();
    const caption = Buffer.from(`<svg width="${tileWidth}" height="${tileHeight}"><rect y="225" width="${tileWidth}" height="25" fill="#082b35"/><text x="12" y="244" font-family="Arial" font-size="18" font-weight="700" fill="white">${label}</text></svg>`);
    return sharp(caption).composite([{ input: crop, top: 0, left: 0 }]).png().toBuffer();
  }));
  const rows = Math.ceil(tiles.length / columns);
  const canvas = sharp({ create: { width: tileWidth * columns, height: tileHeight * rows, channels: 4, background: "#d8e8ee" } });
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await canvas.composite(tiles.map((input, index) => ({ input, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * tileHeight }))).png().toFile(outputPath);
  console.log(outputPath);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
