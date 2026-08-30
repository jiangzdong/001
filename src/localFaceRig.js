const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export const localFaceRigSources = Object.freeze({
  CLOSED: "./assets/xiaoa-ditto-master-v1.0.3.png",
  REST: "./assets/xiaoa-viseme-rest-v4.png",
  A: "./assets/xiaoa-viseme-a-v4.png",
  E: "./assets/xiaoa-viseme-e-v4.png",
  O: "./assets/xiaoa-viseme-o-v4.png",
  U: "./assets/xiaoa-viseme-u-v4.png",
  F: "./assets/xiaoa-viseme-f-v4.png",
  L: "./assets/xiaoa-viseme-l-v4.png",
  S: "./assets/xiaoa-viseme-s-v4.png",
  SH: "./assets/xiaoa-viseme-sh-v4.png",
});

// Runtime channels mirror the independently controllable mouth actions exposed
// by common 52-blendshape face rigs. Keeping these channels separate prevents
// a single rectangular transform from dragging the upper lip, nose and chin as
// one object. Reference-video feature curves can replace these profiles later
// without changing the renderer contract.
export function buildLocalFaceActions({ viseme = "CLOSED", mouthOpen = 0, mouthWidth = 1, expression = "neutral", expressionStrength = 0 } = {}) {
  const label = localFaceRigSources[viseme] ? viseme : "CLOSED";
  // The viseme label selects texture only. Jaw aperture keeps following its
  // smoothed channel through CLOSED so pauses cannot snap the chin to idle.
  const aperture = clamp(mouthOpen);
  const width = clamp(mouthWidth, 0.7, 1.25);
  const expressionAmount = clamp(expressionStrength);
  const smile = expression === "smile" || expression === "encourage" ? expressionAmount : 0;
  const concern = expression === "concern" ? expressionAmount : 0;
  return {
    viseme: label,
    jawOpen: aperture * 0.72,
    mouthLowerDownLeft: aperture * 0.62,
    mouthLowerDownRight: aperture * 0.62,
    mouthUpperUpLeft: label === "A" ? aperture * 0.06 : 0,
    mouthUpperUpRight: label === "A" ? aperture * 0.06 : 0,
    mouthStretchLeft: clamp((width - 1) * 1.8, 0, 1),
    mouthStretchRight: clamp((width - 1) * 1.8, 0, 1),
    mouthPucker: clamp((1 - width) * 2.2, 0, 1),
    mouthSmileLeft: smile * 0.42,
    mouthSmileRight: smile * 0.42,
    browInnerUp: concern * 0.34,
    cheekSquintLeft: smile * 0.24,
    cheekSquintRight: smile * 0.24,
    noseTranslation: 0,
    neckTranslationLeft: 0,
    neckTranslationRight: 0,
  };
}

export function loadLocalFaceRigImages(ImageConstructor = globalThis.Image) {
  if (typeof ImageConstructor !== "function") return Promise.reject(new Error("Image constructor unavailable"));
  return Promise.all(Object.entries(localFaceRigSources).map(([label, source]) => new Promise((resolve, reject) => {
    const image = new ImageConstructor();
    image.decoding = "async";
    image.onload = () => resolve([label, image]);
    image.onerror = () => reject(new Error(`Unable to load local face rig asset: ${source}`));
    image.src = source;
  }))).then((entries) => new Map(entries));
}

function drawTexturedTriangle(context, image, source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const determinant = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(determinant) < 0.0001) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / determinant;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / determinant;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / determinant;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / determinant;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / determinant;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / determinant;
  context.save();
  context.beginPath();
  context.moveTo(d0.x, d0.y);
  context.lineTo(d1.x, d1.y);
  context.lineTo(d2.x, d2.y);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

export function renderLocalFaceRig(canvas, images, actions) {
  const master = images?.get?.("CLOSED");
  const texture = images?.get?.(actions?.viseme) || master;
  if (!canvas || !master || !texture) return false;
  const width = master.naturalWidth || master.width;
  const height = master.naturalHeight || master.height;
  if (!width || !height) return false;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  context.clearRect(0, 0, width, height);
  canvas.dataset.viseme = actions.viseme;
  canvas.dataset.rig = "local-mouth-chin-v2";
  canvas.dataset.jawOpen = clamp(actions.jawOpen).toFixed(4);
  canvas.dataset.lowerLeft = clamp(actions.mouthLowerDownLeft).toFixed(4);
  canvas.dataset.lowerRight = clamp(actions.mouthLowerDownRight).toFixed(4);
  canvas.dataset.noseTranslation = clamp(actions.noseTranslation, -1, 1).toFixed(4);
  canvas.dataset.neckLeft = clamp(actions.neckTranslationLeft, -1, 1).toFixed(4);
  canvas.dataset.neckRight = clamp(actions.neckTranslationRight, -1, 1).toFixed(4);
  canvas.dataset.cheekLeft = "0.0000";
  canvas.dataset.cheekRight = "0.0000";
  canvas.dataset.lowerLipOffsetPx = "0.000";
  canvas.dataset.chinOffsetPx = "0.000";
  canvas.dataset.mouthChinDistanceDeltaPx = "0.000";
  if (actions.viseme === "CLOSED" && clamp(actions.jawOpen) <= 0.003) return true;

  const buffer = canvas.__localFaceRigBuffer || canvas.ownerDocument?.createElement?.("canvas");
  const textureBuffer = canvas.__localFaceRigTextureBuffer || canvas.ownerDocument?.createElement?.("canvas");
  const mouthBuffer = canvas.__localFaceRigMouthBuffer || canvas.ownerDocument?.createElement?.("canvas");
  if (!buffer || !textureBuffer || !mouthBuffer) return false;
  canvas.__localFaceRigBuffer = buffer;
  canvas.__localFaceRigTextureBuffer = textureBuffer;
  canvas.__localFaceRigMouthBuffer = mouthBuffer;
  for (const target of [buffer, textureBuffer, mouthBuffer]) {
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
  }
  const meshContext = buffer.getContext("2d", { alpha: true });
  const textureContext = textureBuffer.getContext("2d", { alpha: true });
  const mouthContext = mouthBuffer.getContext("2d", { alpha: true });
  meshContext.clearRect(0, 0, width, height);
  textureContext.clearRect(0, 0, width, height);
  mouthContext.clearRect(0, 0, width, height);

  // The viseme files are full-size identity references, but the local channel
  // is only allowed to consume their lip ROI. Everything outside the mouth is
  // rebuilt from the rigid master portrait before the jaw mesh is applied.
  textureContext.drawImage(master, 0, 0);
  mouthContext.drawImage(texture, 0, 0);
  mouthContext.save();
  mouthContext.globalCompositeOperation = "destination-in";
  mouthContext.translate(width * 0.5, width * 0.515);
  mouthContext.scale(width * 0.09, width * 0.042);
  const mouthFeather = mouthContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  mouthFeather.addColorStop(0, "rgba(0,0,0,1)");
  mouthFeather.addColorStop(0.82, "rgba(0,0,0,1)");
  mouthFeather.addColorStop(1, "rgba(0,0,0,0)");
  mouthContext.fillStyle = mouthFeather;
  mouthContext.fillRect(-1, -1, 2, 2);
  mouthContext.restore();
  textureContext.drawImage(mouthBuffer, 0, 0);

  // Coordinates are identity-calibrated in image-width units. The patch ends
  // above the neck; its outer ring is fixed while internal lower-lip and chin
  // vertices move together. The upper-lip row receives only its own small AU.
  const columns = [0.392, 0.42, 0.455, 0.5, 0.545, 0.58, 0.608].map((value) => value * width);
  const rows = [0.47, 0.5, 0.528, 0.556, 0.585, 0.618, 0.65].map((value) => value * width);
  const sourceGrid = rows.map((y) => columns.map((x) => ({ x, y })));
  const destinationGrid = sourceGrid.map((row) => row.map((point) => ({ ...point })));
  const jaw = clamp(actions.jawOpen);
  const upperLift = (clamp(actions.mouthUpperUpLeft) + clamp(actions.mouthUpperUpRight)) * 0.5;
  const lowerDrop = (clamp(actions.mouthLowerDownLeft) + clamp(actions.mouthLowerDownRight)) * 0.5;
  const rowOffsets = [0, -0.0005 * upperLift, 0.0105 * lowerDrop, 0.009 * jaw, 0.009 * jaw, 0.009 * jaw, 0];
  const lowerLipOffsetPx = rowOffsets[2] * width;
  const chinOffsetPx = rowOffsets[5] * width;
  canvas.dataset.lowerLipOffsetPx = lowerLipOffsetPx.toFixed(3);
  canvas.dataset.chinOffsetPx = chinOffsetPx.toFixed(3);
  canvas.dataset.mouthChinDistanceDeltaPx = (chinOffsetPx - lowerLipOffsetPx).toFixed(3);

  for (let rowIndex = 0; rowIndex < destinationGrid.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < destinationGrid[rowIndex].length; columnIndex += 1) {
      const point = destinationGrid[rowIndex][columnIndex];
      const jawInterior = columnIndex >= 2 && columnIndex <= columns.length - 3;
      const boundary = rowIndex === 0 || rowIndex === destinationGrid.length - 1 || !jawInterior;
      if (!boundary) {
        point.y += rowOffsets[rowIndex] * width;
      }
    }
  }

  meshContext.save();
  meshContext.beginPath();
  meshContext.ellipse(width * 0.5, width * 0.56, width * 0.108, width * 0.09, 0, 0, Math.PI * 2);
  meshContext.clip();
  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns.length - 1; columnIndex += 1) {
      const s00 = sourceGrid[rowIndex][columnIndex];
      const s10 = sourceGrid[rowIndex][columnIndex + 1];
      const s01 = sourceGrid[rowIndex + 1][columnIndex];
      const s11 = sourceGrid[rowIndex + 1][columnIndex + 1];
      const d00 = destinationGrid[rowIndex][columnIndex];
      const d10 = destinationGrid[rowIndex][columnIndex + 1];
      const d01 = destinationGrid[rowIndex + 1][columnIndex];
      const d11 = destinationGrid[rowIndex + 1][columnIndex + 1];
      drawTexturedTriangle(meshContext, textureBuffer, [s00, s10, s11], [d00, d10, d11]);
      drawTexturedTriangle(meshContext, textureBuffer, [s00, s11, s01], [d00, d11, d01]);
    }
  }
  meshContext.restore();

  // The mesh is rectangular, but facial skin has no rectangular edge. A
  // symmetric elliptical alpha feather hides both grid boundaries after the
  // warp, preventing the one-sided cut line seen during wide-mouth visemes.
  meshContext.save();
  meshContext.globalCompositeOperation = "destination-in";
  meshContext.translate(width * 0.5, width * 0.56);
  meshContext.scale(width * 0.108, width * 0.09);
  const feather = meshContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  feather.addColorStop(0, "rgba(0,0,0,1)");
  feather.addColorStop(0.76, "rgba(0,0,0,1)");
  feather.addColorStop(0.9, "rgba(0,0,0,.72)");
  feather.addColorStop(1, "rgba(0,0,0,0)");
  meshContext.fillStyle = feather;
  meshContext.fillRect(-1, -1, 2, 2);
  meshContext.restore();
  context.drawImage(buffer, 0, 0);
  return true;
}
