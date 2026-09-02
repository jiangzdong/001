const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export const localFaceRigSources = Object.freeze({
  CLOSED: "./assets/xiaoa-ditto-master-v1.0.3.png",
  REST: "./assets/xiaoa-viseme-rest-v5.png",
  A: "./assets/xiaoa-viseme-a-v5.png",
  E: "./assets/xiaoa-viseme-e-v5.png",
  O: "./assets/xiaoa-viseme-o-v10.png",
  U: "./assets/xiaoa-viseme-u-v8.png",
  MBP: "./assets/xiaoa-viseme-mbp-v5.png",
  F: "./assets/xiaoa-viseme-f-v5.png",
  L: "./assets/xiaoa-viseme-l-v5.png",
  NDT: "./assets/xiaoa-viseme-ndt-v5.png",
  S: "./assets/xiaoa-viseme-s-v5.png",
  SH: "./assets/xiaoa-viseme-s-v5.png",
});

export const localFaceRigMaskSources = Object.freeze({
  REST: "./assets/xiaoa-mouth-mask-rest-v1.png",
  A: "./assets/xiaoa-mouth-mask-a-v1.png",
  E: "./assets/xiaoa-mouth-mask-e-v1.png",
  O: "./assets/xiaoa-mouth-mask-o-v1.png",
  U: "./assets/xiaoa-mouth-mask-u-v1.png",
  MBP: "./assets/xiaoa-mouth-mask-mbp-v1.png",
  F: "./assets/xiaoa-mouth-mask-f-v1.png",
  L: "./assets/xiaoa-mouth-mask-l-v1.png",
  NDT: "./assets/xiaoa-mouth-mask-ndt-v1.png",
  S: "./assets/xiaoa-mouth-mask-s-v1.png",
  SH: "./assets/xiaoa-mouth-mask-sh-v1.png",
});

export const stationHomeFullBodySource = "./assets/xiaoa-fullbody-extension-v1.0.0.png";

export const stationHomeFaceMapping = Object.freeze({
  containerWidthCqw: 100,
  containerHeightCqw: 177.8,
  scale: 0.64744,
  translateXCqw: 4.73,
  translateYCqw: -0.43,
});

const jawResponseByViseme = Object.freeze({
  CLOSED: 0.18,
  REST: 0.16,
  A: 0.66,
  E: 0.34,
  O: 0.42,
  U: 0.16,
  MBP: 0.05,
  F: 0.12,
  L: 0.42,
  NDT: 0.12,
  S: 0.18,
  SH: 0.2,
});

// Runtime channels mirror the independently controllable mouth actions exposed
// by common 52-blendshape face rigs. Keeping these channels separate prevents
// a single rectangular transform from dragging the upper lip, nose and chin as
// one object. Reference-video feature curves can replace these profiles later
// without changing the renderer contract.
export function buildLocalFaceActions({ viseme = "CLOSED", mouthOpen = 0, mouthWidth = 1, expression = "neutral", expressionStrength = 0, mouthBlend = null } = {}) {
  const label = localFaceRigSources[viseme] ? viseme : "CLOSED";
  // The viseme label selects texture only. Jaw aperture keeps following its
  // smoothed channel through CLOSED so pauses cannot snap the chin to idle.
  const aperture = clamp(mouthOpen);
  const width = clamp(mouthWidth, 0.7, 1.25);
  const expressionAmount = clamp(expressionStrength);
  const smile = expression === "smile" || expression === "encourage" ? expressionAmount : 0;
  const concern = expression === "concern" ? expressionAmount : 0;
  const jawResponse = jawResponseByViseme[label] ?? jawResponseByViseme.REST;
  const blendFrom = localFaceRigSources[mouthBlend?.from] ? mouthBlend.from : label;
  const blendTo = localFaceRigSources[mouthBlend?.to] ? mouthBlend.to : label;
  return {
    viseme: label,
    mouthBlend: { from: blendFrom, to: blendTo, mix: clamp(mouthBlend?.mix ?? 1) },
    // The mandible does not follow every visible lip aperture equally. A and O
    // recruit it strongly; bilabial, labiodental and alveolar consonants mostly
    // articulate at the lips or tongue while the chin remains restrained.
    jawOpen: aperture * jawResponse,
    mouthLowerDownLeft: aperture * 0.68,
    mouthLowerDownRight: aperture * 0.68,
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

export function loadLocalFaceRigImage(source, ImageConstructor = globalThis.Image) {
  if (typeof ImageConstructor !== "function") return Promise.reject(new Error("Image constructor unavailable"));
  return new Promise((resolve, reject) => {
    const image = new ImageConstructor();
    image.decoding = "async";
    image.onload = () => Promise.resolve(typeof image.decode === "function" ? image.decode() : undefined)
      .catch(() => undefined)
      .then(() => resolve(image));
    image.onerror = () => reject(new Error(`Unable to load local face rig asset: ${source}`));
    image.src = source;
  });
}

export function loadLocalFaceRigImages(ImageConstructor = globalThis.Image) {
  return Promise.all(Object.entries(localFaceRigSources).map(async ([label, source]) => {
    const [image, mouthMask] = await Promise.all([
      loadLocalFaceRigImage(source, ImageConstructor),
      localFaceRigMaskSources[label] ? loadLocalFaceRigImage(localFaceRigMaskSources[label], ImageConstructor) : null,
    ]);
    image.__localFaceRigMouthMask = mouthMask;
    return [label, image];
  })).then((entries) => new Map(entries));
}

/**
 * Reprojects the station's real full-body portrait into the close-portrait
 * coordinate system used by the authored visemes. The station canvas is then
 * transformed back by CSS, so every non-lip pixel lands on the exact base
 * portrait instead of flashing a second face/skin exposure during speech.
 */
export function createStationHomeFaceMaster(canvas, fullBodyImage, mapping = stationHomeFaceMapping) {
  const width = fullBodyImage?.naturalWidth || fullBodyImage?.width;
  const height = fullBodyImage?.naturalHeight || fullBodyImage?.height;
  const mapped = canvas?.ownerDocument?.createElement?.("canvas");
  if (!mapped || !width || !height) return null;

  mapped.width = width;
  mapped.height = height;
  const context = mapped.getContext("2d", { alpha: true });
  if (!context) return null;

  const containerWidth = Number(mapping.containerWidthCqw) || 100;
  const containerHeight = Number(mapping.containerHeightCqw) || (height / width * containerWidth);
  const scale = Number(mapping.scale) || 1;
  const translateX = Number(mapping.translateXCqw) || 0;
  const translateY = Number(mapping.translateYCqw) || 0;
  const fitScale = Math.max(containerWidth / width, containerHeight / height);
  const fitOffsetX = (containerWidth - width * fitScale) * 0.5;
  const fitOffsetY = (containerHeight - height * fitScale) * 0.5;
  const closeHeightCqw = height / width * containerWidth;

  // Compact rig canvases are positioned in cqw units, not through object-fit.
  // Convert their transformed element coordinates back into source pixels of
  // the full-body image, including the tiny object-fit:cover crop.
  const sourceLeft = (containerWidth * 0.5 + scale * (0 - containerWidth * 0.5) + translateX - fitOffsetX) / fitScale;
  const sourceTop = (scale * 0 + translateY - fitOffsetY) / fitScale;
  const sourceRight = (containerWidth * 0.5 + scale * (containerWidth - containerWidth * 0.5) + translateX - fitOffsetX) / fitScale;
  const sourceBottom = (scale * closeHeightCqw + translateY - fitOffsetY) / fitScale;
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  const clippedLeft = Math.max(0, sourceLeft);
  const clippedTop = Math.max(0, sourceTop);
  const clippedRight = Math.min(width, sourceRight);
  const clippedBottom = Math.min(height, sourceBottom);
  if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

  const destinationLeft = (clippedLeft - sourceLeft) / sourceWidth * width;
  const destinationTop = (clippedTop - sourceTop) / sourceHeight * height;
  const destinationWidth = (clippedRight - clippedLeft) / sourceWidth * width;
  const destinationHeight = (clippedBottom - clippedTop) / sourceHeight * height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    fullBodyImage,
    clippedLeft, clippedTop, clippedRight - clippedLeft, clippedBottom - clippedTop,
    destinationLeft, destinationTop, destinationWidth, destinationHeight,
  );
  mapped.__localFaceRigIdentity = "station-home-fullbody-v1";
  mapped.__localFaceRigKeepIdlePatch = true;
  mapped.__stationHomeFaceMapping = { sourceLeft, sourceTop, sourceWidth, sourceHeight };
  return mapped;
}

function getPreparedJawTexture(canvas, master, texture, viseme, width, height) {
  const sourceLeft = width * 0.34;
  const sourceTop = width * 0.455;
  const sourceRight = width * 0.66;
  const sourceBottom = width * 0.62;
  const cropLeft = Math.max(0, Math.floor(sourceLeft) - 2);
  const cropTop = Math.max(0, Math.floor(sourceTop) - 2);
  const cropRight = Math.min(width, Math.ceil(sourceRight) + 2);
  const cropBottom = Math.min(height, Math.ceil(sourceBottom) + 2);
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;
  const masterIdentity = master.__localFaceRigIdentity || "portrait-master";
  const cacheIdentity = `v34:${masterIdentity}:${width}x${height}`;
  if (canvas.__localFaceRigPreparedTextureIdentity !== cacheIdentity) {
    canvas.__localFaceRigPreparedTextureIdentity = cacheIdentity;
    canvas.__localFaceRigPreparedTextures = new Map();
    canvas.__localFaceRigPreparedIdentity = null;
  }
  const cache = canvas.__localFaceRigPreparedTextures;
  if (cache.has(texture)) return cache.get(texture);

  const identityLayer = canvas.__localFaceRigPreparedIdentity || canvas.ownerDocument?.createElement?.("canvas");
  const mouthLayer = canvas.ownerDocument?.createElement?.("canvas");
  if (!identityLayer || !mouthLayer) return null;
  if (identityLayer.width !== cropWidth) identityLayer.width = cropWidth;
  if (identityLayer.height !== cropHeight) identityLayer.height = cropHeight;
  mouthLayer.width = cropWidth;
  mouthLayer.height = cropHeight;
  const identityContext = identityLayer.getContext("2d", { alpha: true });
  const mouthContext = mouthLayer.getContext("2d", { alpha: true });
  if (!identityContext || !mouthContext) return null;
  identityContext.imageSmoothingEnabled = true;
  identityContext.imageSmoothingQuality = "high";
  mouthContext.imageSmoothingEnabled = true;
  mouthContext.imageSmoothingQuality = "high";

  // Cache the identity jaw separately from the authored mouth. Baking both
  // into one photographic rectangle made the renderer resample stationary
  // philtrum and cheek pixels on every viseme frame. Even a sub-pixel match
  // then exposed a horizontal tone seam in the final Electron compositor.
  if (!canvas.__localFaceRigPreparedIdentity) {
    identityContext.clearRect(0, 0, cropWidth, cropHeight);
    identityContext.drawImage(master, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    canvas.__localFaceRigPreparedIdentity = identityLayer;
  }
  // Transfer only the visual delta from the authored CLOSED portrait to the
  // selected viseme. This preserves the station portrait's own skin colour and
  // sampling everywhere while still replacing the old mouth corners, teeth,
  // lips and oral cavity. A photographed ellipse copied surrounding skin and
  // could never hide its tone boundary in the final Electron compositor.
  const referenceClosed = master.__localFaceRigReferenceClosed || master;
  if (viseme === "CLOSED") {
    mouthContext.clearRect(0, 0, cropWidth, cropHeight);
    const entry = { identityCanvas: identityLayer, mouthCanvas: mouthLayer, left: cropLeft, top: cropTop };
    cache.set(texture, entry);
    return entry;
  }
  const authoredMask = texture.__localFaceRigMouthMask;
  const textureSample = canvas.ownerDocument?.createElement?.("canvas");
  const referenceSample = canvas.ownerDocument?.createElement?.("canvas");
  const maskSample = canvas.ownerDocument?.createElement?.("canvas");
  if (!authoredMask || !textureSample || !referenceSample || !maskSample) return null;
  for (const target of [textureSample, referenceSample, maskSample]) {
    target.width = cropWidth;
    target.height = cropHeight;
  }
  const textureSampleContext = textureSample.getContext("2d", { alpha: true, willReadFrequently: true });
  const referenceSampleContext = referenceSample.getContext("2d", { alpha: true, willReadFrequently: true });
  const maskSampleContext = maskSample.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!textureSampleContext || !referenceSampleContext || !maskSampleContext) return null;
  textureSampleContext.imageSmoothingEnabled = true;
  textureSampleContext.imageSmoothingQuality = "high";
  referenceSampleContext.imageSmoothingEnabled = true;
  referenceSampleContext.imageSmoothingQuality = "high";

  // Normal conversation does not use the authored A frame at its full photo
  // aperture. Compress both reference and target around the upper-lip border;
  // their difference therefore contains articulation, not shifted skin.
  const mouthUpperAnchorY = width * 0.5075 - cropTop;
  const mouthTextureScaleY = viseme === "A" ? 0.72 : 1;
  const drawAlignedSample = (targetContext, sourceImage) => {
    targetContext.clearRect(0, 0, cropWidth, cropHeight);
    targetContext.save();
    targetContext.translate(0, mouthUpperAnchorY);
    targetContext.scale(1, mouthTextureScaleY);
    targetContext.translate(0, -mouthUpperAnchorY);
    targetContext.drawImage(sourceImage, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    targetContext.restore();
  };
  drawAlignedSample(textureSampleContext, texture);
  drawAlignedSample(referenceSampleContext, referenceClosed);

  // The offline alpha is the union of the CLOSED and target MediaPipe outer-
  // lip polygons, dilated by five pixels and softly feathered. Compress it less
  // than the A texture so the original closed-mouth corners remain covered.
  const mouthMaskScaleY = viseme === "A" ? 0.86 : 1;
  maskSampleContext.clearRect(0, 0, cropWidth, cropHeight);
  maskSampleContext.save();
  maskSampleContext.translate(0, mouthUpperAnchorY);
  maskSampleContext.scale(1, mouthMaskScaleY);
  maskSampleContext.translate(0, -mouthUpperAnchorY);
  maskSampleContext.drawImage(authoredMask, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  maskSampleContext.restore();

  const identityPixels = identityContext.getImageData(0, 0, cropWidth, cropHeight);
  const texturePixels = textureSampleContext.getImageData(0, 0, cropWidth, cropHeight);
  const referencePixels = referenceSampleContext.getImageData(0, 0, cropWidth, cropHeight);
  const maskPixels = maskSampleContext.getImageData(0, 0, cropWidth, cropHeight);
  const mouthPixels = mouthContext.createImageData(cropWidth, cropHeight);
  const pixelCount = cropWidth * cropHeight;

  // Match the authored mouth's local skin exposure to the exact station
  // identity using a clean ring just outside the MediaPipe lip alpha. A single
  // small RGB offset preserves real lip/teeth texture without the saturation
  // streaks produced by per-pixel photographic subtraction.
  const colorDelta = [0, 0, 0];
  let colorSamples = 0;
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const pixel = y * cropWidth + x;
      const index = pixel * 4;
      const normalizedX = (cropLeft + x - width * 0.492) / (width * 0.085);
      const normalizedY = (cropTop + y - width * 0.52) / (width * 0.06);
      const inColourRing = normalizedX * normalizedX + normalizedY * normalizedY <= 1;
      const referenceLuma = (referencePixels.data[index] * 0.21) + (referencePixels.data[index + 1] * 0.72) + (referencePixels.data[index + 2] * 0.07);
      if (inColourRing && maskPixels.data[index + 3] < 12 && referenceLuma > 138 && referenceLuma < 250) {
        colorDelta[0] += identityPixels.data[index] - referencePixels.data[index];
        colorDelta[1] += identityPixels.data[index + 1] - referencePixels.data[index + 1];
        colorDelta[2] += identityPixels.data[index + 2] - referencePixels.data[index + 2];
        colorSamples += 1;
      }
    }
  }
  const channelOffsets = colorDelta.map((value) => clamp(value / Math.max(1, colorSamples), -32, 32));
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 4;
    // The offline mask includes a generous union ring around both lip shapes.
    // Limit its visible coverage to the anatomical lip core and feather the
    // last fifth. This retains the authored mouth while excluding the dark
    // cheek/corner pixels that read as a duplicate closed mouth at 4K.
    const sourceX = cropLeft + (pixel % cropWidth);
    const sourceY = cropTop + Math.floor(pixel / cropWidth);
    const coreRadiusX = width * (viseme === "A" ? 0.082 : 0.074);
    const coreRadiusY = width * 0.065;
    const coreDistance = Math.hypot((sourceX - width * 0.492) / coreRadiusX, (sourceY - width * 0.522) / coreRadiusY);
    const coreAlpha = coreDistance <= 0.8 ? 1 : clamp((1 - coreDistance) / 0.2);
    mouthPixels.data[index] = clamp(texturePixels.data[index] + channelOffsets[0], 0, 255);
    mouthPixels.data[index + 1] = clamp(texturePixels.data[index + 1] + channelOffsets[1], 0, 255);
    mouthPixels.data[index + 2] = clamp(texturePixels.data[index + 2] + channelOffsets[2], 0, 255);
    mouthPixels.data[index + 3] = Math.round(maskPixels.data[index + 3] * coreAlpha);
  }
  mouthContext.putImageData(mouthPixels, 0, 0);
  mouthLayer.__localFaceRigColourOffset = channelOffsets;
  const entry = { identityCanvas: identityLayer, mouthCanvas: mouthLayer, left: cropLeft, top: cropTop };
  cache.set(texture, entry);
  return entry;
}

export function prepareLocalFaceRigTextures(canvas, images) {
  const master = images?.get?.("CLOSED");
  if (!canvas || !master || !images?.entries) return 0;
  const width = master.naturalWidth || master.width;
  const height = master.naturalHeight || master.height;
  if (!width || !height) return 0;
  for (const [viseme, texture] of images.entries()) {
    if (!getPreparedJawTexture(canvas, master, texture, viseme, width, height)) return 0;
  }
  const count = canvas.__localFaceRigPreparedTextures?.size || 0;
  canvas.dataset.textureCache = "split-jaw-mouth-roi";
  canvas.dataset.preparedTextures = String(count);
  return count;
}

function getPreparedJawBlend(canvas, images, master, actions, width, height) {
  const fromLabel = localFaceRigSources[actions?.mouthBlend?.from] ? actions.mouthBlend.from : actions.viseme;
  const toLabel = localFaceRigSources[actions?.mouthBlend?.to] ? actions.mouthBlend.to : actions.viseme;
  const mix = clamp(actions?.mouthBlend?.mix ?? 1);
  const fromTexture = images.get(fromLabel) || master;
  const toTexture = images.get(toLabel) || master;
  const fromEntry = getPreparedJawTexture(canvas, master, fromTexture, fromLabel, width, height);
  if (!fromEntry) return null;
  // Cross-fading two photographic mouths produces a visible double lip at the
  // midpoint even when both source portraits are perfectly registered. Keep
  // the eased jaw/lower-face motion continuous, but show exactly one authored
  // lip texture per display frame. The swap happens once at the same 0.5
  // threshold used by the public dominant-viseme state, so there is no blur,
  // texture chatter, or audio/visual label disagreement.
  const useTarget = fromLabel !== toLabel && mix >= 0.5;
  const toEntry = useTarget ? getPreparedJawTexture(canvas, master, toTexture, toLabel, width, height) : null;
  if (useTarget && !toEntry) return null;
  const textureFrame = useTarget ? toLabel : fromLabel;
  const selectedEntry = useTarget ? toEntry : fromEntry;

  // Keep one stable CanvasImageSource for Chromium's GPU upload path. Returning
  // a different prepared canvas on every phoneme boundary can evict/re-upload
  // textures and stall a 4K compositor even though each source is small.
  const mouthDisplayCanvas = canvas.__localFaceRigMouthDisplayBuffer || canvas.ownerDocument?.createElement?.("canvas");
  if (!mouthDisplayCanvas) return null;
  canvas.__localFaceRigMouthDisplayBuffer = mouthDisplayCanvas;
  if (mouthDisplayCanvas.width !== selectedEntry.mouthCanvas.width) mouthDisplayCanvas.width = selectedEntry.mouthCanvas.width;
  if (mouthDisplayCanvas.height !== selectedEntry.mouthCanvas.height) mouthDisplayCanvas.height = selectedEntry.mouthCanvas.height;
  const displayContext = mouthDisplayCanvas.getContext("2d", { alpha: true });
  if (!displayContext) return null;
  displayContext.globalCompositeOperation = "copy";
  displayContext.drawImage(selectedEntry.mouthCanvas, 0, 0);
  displayContext.globalCompositeOperation = "source-over";
  canvas.dataset.textureBlend = `${fromLabel}>${toLabel}@${mix.toFixed(3)}`;
  canvas.dataset.textureFrame = textureFrame;
  canvas.dataset.texturePolicy = "split-mouth-dominant-sharp-stable-buffer";
  return {
    identityCanvas: selectedEntry.identityCanvas,
    mouthCanvas: mouthDisplayCanvas,
    left: selectedEntry.left,
    top: selectedEntry.top,
  };
}

export function renderLocalFaceRig(canvas, images, actions) {
  const renderStartedAt = globalThis.performance?.now?.() || Date.now();
  const recordRenderDuration = () => {
    const durationMs = (globalThis.performance?.now?.() || Date.now()) - renderStartedAt;
    const previous = canvas?.__localFaceRigPerformance || { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
    canvas.__localFaceRigPerformance = {
      count: previous.count + 1,
      totalMs: previous.totalMs + durationMs,
      maxMs: Math.max(previous.maxMs, durationMs),
      lastMs: durationMs,
    };
  };
  const master = images?.get?.("CLOSED");
  const texture = images?.get?.(actions?.viseme) || master;
  if (!canvas || !master || !texture) return false;
  const width = master.naturalWidth || master.width;
  const height = master.naturalHeight || master.height;
  if (!width || !height) return false;
  // The station canvas itself is also reduced to the lower-face crop. This
  // avoids uploading a transparent 941 x 1672 texture to the GPU for every jaw
  // update on a 4K portrait display. The generic avatar keeps its legacy full-
  // frame canvas layout for compatibility with its existing object-fit rules.
  const renderRegionLeft = Math.max(0, Math.floor(width * 0.32));
  const renderRegionTop = Math.max(0, Math.floor(width * 0.455));
  const renderRegionRight = Math.min(width, Math.ceil(width * 0.68));
  const renderRegionBottom = Math.min(height, Math.ceil(width * 0.62));
  const renderRegionWidth = renderRegionRight - renderRegionLeft;
  const renderRegionHeight = renderRegionBottom - renderRegionTop;
  const compactStationCanvas = canvas.classList?.contains?.("station-advisor-digital-human__local-rig");
  const outputWidth = compactStationCanvas ? renderRegionWidth : width;
  const outputHeight = compactStationCanvas ? renderRegionHeight : height;
  if (canvas.width !== outputWidth) canvas.width = outputWidth;
  if (canvas.height !== outputHeight) canvas.height = outputHeight;
  if (compactStationCanvas && canvas.dataset.compactLayout !== "lower-face-v2") {
    canvas.style.inset = "auto";
    canvas.style.left = `${(renderRegionLeft / width * 100).toFixed(4)}cqw`;
    canvas.style.top = `${(renderRegionTop / width * 100).toFixed(4)}cqw`;
    canvas.style.width = `${(renderRegionWidth / width * 100).toFixed(4)}cqw`;
    canvas.style.height = `${(renderRegionHeight / width * 100).toFixed(4)}cqw`;
    canvas.style.objectFit = "fill";
    canvas.style.objectPosition = "0 0";
    canvas.dataset.compactLayout = "lower-face-v2";
  }
  // Publish a completed lower-face frame in one copy. Let Chromium queue the
  // upload normally; desynchronized 2D contexts can block this renderer while
  // Windows is busy compiling or the GPU command queue is saturated.
  const context = canvas.getContext("2d", { alpha: true });
  canvas.dataset.viseme = actions.viseme;
  canvas.dataset.rig = "local-mouth-chin-v34";
  canvas.dataset.mouthMaskPolicy = "mediapipe-lip-core-feather-color-matched";
  canvas.dataset.mouthTextureScaleY = actions.viseme === "A" ? "0.720" : "1.000";
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
  canvas.dataset.renderRegion = `${renderRegionWidth}x${renderRegionHeight}`;
  if (actions.viseme === "CLOSED" && clamp(actions.jawOpen) <= 0.003) {
    context.clearRect(0, 0, outputWidth, outputHeight);
    canvas.dataset.textureFrame = "CLOSED";
    canvas.dataset.texturePolicy = "split-mouth-dominant-sharp-stable-buffer";
    canvas.dataset.textureCache = "split-jaw-mouth-roi";
    recordRenderDuration();
    return true;
  }

  // All expensive masking and blur work stays inside the anatomical lower-face
  // box. At the 941 px source width this is roughly 340 x 180 pixels instead of
  // four 941 x 1672 full-frame buffers on every animation tick.
  const buffer = canvas.__localFaceRigBuffer || canvas.ownerDocument?.createElement?.("canvas");
  const mouthBuffer = canvas.__localFaceRigMouthBuffer || canvas.ownerDocument?.createElement?.("canvas");
  const maskBuffer = canvas.__localFaceRigMaskBuffer || canvas.ownerDocument?.createElement?.("canvas");
  const compositeBuffer = canvas.__localFaceRigCompositeBuffer || canvas.ownerDocument?.createElement?.("canvas");
  if (!buffer || !mouthBuffer || !maskBuffer || !compositeBuffer) return false;
  canvas.__localFaceRigBuffer = buffer;
  canvas.__localFaceRigMouthBuffer = mouthBuffer;
  canvas.__localFaceRigMaskBuffer = maskBuffer;
  canvas.__localFaceRigCompositeBuffer = compositeBuffer;
  for (const target of [buffer, mouthBuffer, maskBuffer, compositeBuffer]) {
    if (target.width !== renderRegionWidth) target.width = renderRegionWidth;
    if (target.height !== renderRegionHeight) target.height = renderRegionHeight;
  }
  const meshContext = buffer.getContext("2d", { alpha: true });
  const mouthRenderContext = mouthBuffer.getContext("2d", { alpha: true });
  const maskContext = maskBuffer.getContext("2d", { alpha: true });
  const compositeContext = compositeBuffer.getContext("2d", { alpha: true });
  meshContext.clearRect(0, 0, renderRegionWidth, renderRegionHeight);
  mouthRenderContext.clearRect(0, 0, renderRegionWidth, renderRegionHeight);
  maskContext.clearRect(0, 0, renderRegionWidth, renderRegionHeight);
  compositeContext.clearRect(0, 0, renderRegionWidth, renderRegionHeight);
  const preparedFaceLayers = getPreparedJawBlend(canvas, images, master, actions, width, height);
  if (!preparedFaceLayers) return false;
  canvas.dataset.textureCache = "split-jaw-mouth-roi";
  canvas.dataset.preparedTextures = String(canvas.__localFaceRigPreparedTextures.size);

  // The active region follows the anatomical jaw contour and ends at the chin
  // tip. The neck, collar and shoulders never enter this deformation field.
  // The first immobile row sits below the nose. Nothing at or above the nasal
  // base can enter either the texture replacement or the displacement field.
  const rows = [0.489, 0.505, 0.52, 0.548, 0.595].map((value) => value * width);
  const jaw = clamp(actions.jawOpen);
  const jawArc = Math.pow(jaw, 0.86);
  const upperLift = (clamp(actions.mouthUpperUpLeft) + clamp(actions.mouthUpperUpRight)) * 0.5;
  // The authored viseme supplies lip articulation; this mesh supplies the
  // mandible. Preserve the visible height of the chin instead of stretching or
  // collapsing it while the upper lip, nose and outer cheeks remain locked.
  // MediaPipe overlay calibration: the authored open-mouth texture already
  // moves the lower lip, so only a small additional lip offset is needed.
  // The authored viseme already lowers the visible lip. The chin contour then
  // follows it as one connected mandibular unit; there is no detached chin
  // plate and no shoulder translation.
  // Rows 0-2 belong to the immobile maxilla/upper lip. Only rows 3-4 belong
  // to the lower lip and mandible. Pulling row 2 down made the upper lip follow
  // the jaw, which is anatomically wrong and visually reads as a sliding mask.
  const rowOffsets = [0, -0.0006 * upperLift, -0.0012 * upperLift, 0.016 * jawArc, 0.024 * jawArc];
  const upperLipOffsetPx = rowOffsets[2] * width;
  const lowerLipOffsetPx = rowOffsets[3] * width;
  const chinOffsetPx = rowOffsets[4] * width;
  canvas.dataset.upperLipOffsetPx = upperLipOffsetPx.toFixed(3);
  // Keep the calibrated lower-face geometry continuous with the base portrait.
  // The station's chin must retain its authored position and height; mouth
  // residual cleanup is handled by the lip alpha above, never by shortening or
  // replacing this lower-face contour.
  canvas.dataset.lowerLipOffsetPx = lowerLipOffsetPx.toFixed(3);
  canvas.dataset.chinOffsetPx = chinOffsetPx.toFixed(3);
  canvas.dataset.mouthChinDistanceDeltaPx = (chinOffsetPx - lowerLipOffsetPx).toFixed(3);
  canvas.dataset.jawLayerPolicy = "continuous-jaw-geometry-preserved";

  const offsetAt = (sourceY) => {
    let segment = 0;
    while (segment < rows.length - 2 && sourceY > rows[segment + 1]) segment += 1;
    const segmentSpan = Math.max(1, rows[segment + 1] - rows[segment]);
    const mix = clamp((sourceY - rows[segment]) / segmentSpan);
    return rowOffsets[segment] + (rowOffsets[segment + 1] - rowOffsets[segment]) * mix;
  };

  // Deform a continuous area of the station portrait's own chin instead of
  // laying a narrow photographed band under the mouth. The broad feather is
  // still wholly inside the face, but it spans enough vertical skin that the
  // motion reads as one mandible and cannot expose repeated horizontal strips.
  maskContext.clearRect(0, 0, renderRegionWidth, renderRegionHeight);
  maskContext.save();
  const jawMaskCenterY = width * 0.563 + offsetAt(width * 0.563) * width;
  maskContext.translate(width * 0.492 - renderRegionLeft, jawMaskCenterY - renderRegionTop);
  maskContext.scale(width * 0.105, width * 0.048);
  const jawFeather = maskContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  jawFeather.addColorStop(0, "rgba(0,0,0,0.74)");
  jawFeather.addColorStop(0.46, "rgba(0,0,0,0.68)");
  jawFeather.addColorStop(0.72, "rgba(0,0,0,0.34)");
  jawFeather.addColorStop(0.9, "rgba(0,0,0,0.08)");
  jawFeather.addColorStop(1, "rgba(0,0,0,0)");
  maskContext.fillStyle = jawFeather;
  maskContext.fillRect(-1, -1, 2, 2);
  maskContext.restore();

  const sourceLeft = width * 0.37;
  const sourceWidth = width * 0.245;
  const stripHeight = 1;
  if (jaw > 0.003) {
    // One-pixel destination intervals meet at the same warped boundary. The
    // old three-pixel slices overlapped by almost two pixels and printed a
    // comb-like shadow below the lower lip in the final 4K compositor.
    for (let sourceY = rows[2]; sourceY < rows.at(-1); sourceY += stripHeight) {
      const offset = offsetAt(sourceY);
      const nextY = Math.min(rows.at(-1), sourceY + stripHeight);
      const nextOffset = offsetAt(nextY);
      const destinationTop = sourceY + offset * width;
      const destinationBottom = nextY + nextOffset * width;
      const destinationHeight = Math.max(0.5, destinationBottom - destinationTop);
      meshContext.drawImage(
        preparedFaceLayers.identityCanvas,
        sourceLeft - preparedFaceLayers.left, sourceY - preparedFaceLayers.top, sourceWidth, nextY - sourceY,
        sourceLeft - renderRegionLeft, destinationTop - renderRegionTop, sourceWidth, destinationHeight,
      );
    }
    meshContext.globalCompositeOperation = "destination-in";
    meshContext.drawImage(maskBuffer, 0, 0);
    meshContext.globalCompositeOperation = "source-over";
    compositeContext.drawImage(buffer, 0, 0);
  }

  // Warp the authored lip ROI independently. Upper-lip strips stay anchored;
  // only the lower part follows the mandibular curve. Its own alpha envelope
  // is the sole texture-replacement boundary, so no nose or cheek pixels can
  // leak into the final frame.
  // Render the whole guarded lower-face envelope, not only the central lip
  // aperture. The alpha mask remains the sole visible boundary, while this
  // wider source span replaces both original mouth corners instead of leaving
  // their dark closed-mouth pixels visible beside an open viseme.
  const mouthSourceLeft = width * 0.37;
  const mouthSourceWidth = width * 0.245;
  const mouthTop = width * 0.486;
  const mouthBottom = width * 0.548;
  const mouthStripHeight = 1;
  for (let sourceY = mouthTop; sourceY < mouthBottom; sourceY += mouthStripHeight) {
    const offset = offsetAt(sourceY);
    const nextY = Math.min(mouthBottom, sourceY + mouthStripHeight);
    const nextOffset = offsetAt(nextY);
    const destinationTop = sourceY + offset * width;
    const destinationBottom = nextY + nextOffset * width;
    const destinationHeight = Math.max(0.5, destinationBottom - destinationTop);
    mouthRenderContext.drawImage(
      preparedFaceLayers.mouthCanvas,
      mouthSourceLeft - preparedFaceLayers.left, sourceY - preparedFaceLayers.top, mouthSourceWidth, nextY - sourceY,
      mouthSourceLeft - renderRegionLeft, destinationTop - renderRegionTop, mouthSourceWidth, destinationHeight,
    );
  }
  compositeContext.drawImage(mouthBuffer, 0, 0);
  canvas.dataset.compositorLayers = "continuous-chin-mouth-v2";
  canvas.dataset.stationaryFacePolicy = "base-only";
  canvas.dataset.restorationPolicy = "no-cheek-fill";

  // Publish one completed transparent frame to the visible canvas. Building
  // restoration and jaw layers directly on the visible surface allowed the
  // Electron compositor to observe a partial frame during fast viseme changes.
  context.save();
  context.globalCompositeOperation = "copy";
  context.drawImage(compositeBuffer, compactStationCanvas ? 0 : renderRegionLeft, compactStationCanvas ? 0 : renderRegionTop);
  context.restore();

  // Both mouth corners come exclusively from the two identity-locked viseme
  // endpoints and travel inside the same contour. The relaxed O-v10/U-v8
  // sources remove detached strokes without runtime pixel repair or pucker.
  recordRenderDuration();
  return true;
}
