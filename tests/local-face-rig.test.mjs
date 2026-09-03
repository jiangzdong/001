import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildLocalFaceActions,
  createStationHomeFaceMaster,
  localFaceRigSources,
  stationHomeFaceMapping,
} from "../src/localFaceRig.js";

test("station home master samples the visible full-body portrait in the close-face coordinate system", () => {
  const drawCalls = [];
  const document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage: (...args) => drawCalls.push(args),
      }),
    }),
  };
  const mapped = createStationHomeFaceMaster(
    { ownerDocument: document },
    { naturalWidth: 941, naturalHeight: 1672 },
  );

  assert.equal(mapped.width, 941);
  assert.equal(mapped.height, 1672);
  assert.equal(mapped.__localFaceRigIdentity, "station-home-fullbody-v1");
  assert.equal(mapped.__localFaceRigKeepIdlePatch, true);
  assert.equal(stationHomeFaceMapping.scale, 0.64744);
  assert.ok(mapped.__stationHomeFaceMapping.sourceLeft > 200);
  assert.ok(mapped.__stationHomeFaceMapping.sourceTop < 0);
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0][2], 0);
  assert.ok(drawCalls[0][6] > 0);
});

test("local feature rig keeps bilateral speech actions symmetric and locks nose and neck", () => {
  const actions = buildLocalFaceActions({ viseme: "A", mouthOpen: 0.82, mouthWidth: 1.08, expression: "encourage", expressionStrength: 0.6 });
  assert.equal(actions.mouthLowerDownLeft, actions.mouthLowerDownRight);
  assert.equal(actions.mouthUpperUpLeft, actions.mouthUpperUpRight);
  assert.equal(actions.mouthStretchLeft, actions.mouthStretchRight);
  assert.equal(actions.mouthSmileLeft, actions.mouthSmileRight);
  assert.equal(actions.cheekSquintLeft, actions.cheekSquintRight);
  assert.equal(actions.noseTranslation, 0);
  assert.equal(actions.neckTranslationLeft, 0);
  assert.equal(actions.neckTranslationRight, 0);
});

test("closed local rig has no jaw or lip displacement", () => {
  const actions = buildLocalFaceActions({ viseme: "CLOSED", mouthOpen: 0, mouthWidth: 1.2 });
  assert.equal(actions.jawOpen, 0);
  assert.equal(actions.mouthLowerDownLeft, 0);
  assert.equal(actions.mouthLowerDownRight, 0);
  assert.equal(actions.viseme, "CLOSED");
});

test("closed viseme lets a previously open jaw settle instead of snapping", () => {
  const actions = buildLocalFaceActions({ viseme: "CLOSED", mouthOpen: 0.36, mouthWidth: 1 });
  assert.ok(actions.jawOpen > 0);
  assert.equal(actions.mouthLowerDownLeft, actions.mouthLowerDownRight);
});

test("maximum A viseme keeps the mandible response below the previous oversized peak", () => {
  const actions = buildLocalFaceActions({ viseme: "A", mouthOpen: 1, mouthWidth: 1 });
  assert.equal(actions.jawOpen, 0.66);
  assert.ok(actions.jawOpen < 0.68);
});

test("SH keeps a restrained jaw response instead of the old whistle-like pucker", () => {
  const actions = buildLocalFaceActions({ viseme: "SH", mouthOpen: 1, mouthWidth: 0.96 });
  assert.equal(actions.jawOpen, 0.2);
  assert.ok(actions.mouthPucker < 0.1);
});

test("local rig owns every runtime viseme and does not transform the full mouth rectangle", async () => {
  assert.deepEqual(Object.keys(localFaceRigSources), ["CLOSED", "REST", "A", "E", "O", "U", "MBP", "F", "L", "NDT", "S", "SH"]);
  const [appSource, styles, rigSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/localFaceRig.js", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /digital-human__local-rig/);
  assert.match(appSource, /data-avatar-mode=\{avatarMode\}/);
  assert.doesNotMatch(appSource, /digital-human__mouth-frame/);
  assert.doesNotMatch(styles, /digital-human__mouth-frame/);
  assert.match(rigSource, /mouthLowerDownLeft/);
  assert.match(rigSource, /neckTranslationLeft: 0/);
  assert.match(rigSource, /local-mouth-chin-v34/);
  assert.match(rigSource, /SH: "\.\/assets\/xiaoa-viseme-s-v5\.png"/);
  assert.match(rigSource, /xiaoa-viseme-o-v10\.png/);
  assert.match(rigSource, /xiaoa-viseme-u-v8\.png/);
  assert.match(rigSource, /export const localFaceRigMaskSources/);
  assert.match(rigSource, /__localFaceRigPreparedTextures = new Map\(\)/);
  assert.match(rigSource, /export function prepareLocalFaceRigTextures/);
  assert.match(rigSource, /typeof image\.decode === "function" \? image\.decode\(\)/);
  assert.match(rigSource, /textureCache = "split-jaw-mouth-roi"/);
  assert.match(rigSource, /const renderRegionLeft = Math\.max\(0, Math\.floor\(width \* 0\.32\)\)/);
  assert.match(rigSource, /const renderRegionTop = Math\.max\(0, Math\.floor\(width \* 0\.455\)\)/);
  assert.match(rigSource, /target\.width !== renderRegionWidth/);
  assert.match(rigSource, /compactStationCanvas \? renderRegionWidth : width/);
  assert.match(rigSource, /canvas\.dataset\.compactLayout = "lower-face-v2"/);
  assert.match(rigSource, /identityContext\.getImageData/);
  assert.match(rigSource, /maskSampleContext\.getImageData/);
  assert.match(rigSource, /mouthContext\.putImageData/);
  assert.doesNotMatch(rigSource, /suppressHorizontalDarkStreak/);
  assert.doesNotMatch(rigSource, /restoreContext\.filter = "blur\(10px\)"/);
  assert.match(rigSource, /identityContext\.drawImage\(master, cropLeft, cropTop/);
  assert.match(rigSource, /targetContext\.drawImage\(sourceImage, cropLeft, cropTop/);
  assert.match(rigSource, /const mouthTextureScaleY = viseme === "A" \? 0\.72 : 1/);
  assert.match(rigSource, /const mouthUpperAnchorY = width \* 0\.5075 - cropTop/);
  assert.match(rigSource, /targetContext\.scale\(1, mouthTextureScaleY\)/);
  assert.match(rigSource, /mouthContext\.imageSmoothingQuality = "high"/);
  assert.doesNotMatch(rigSource, /nextTexture|mouthContext\.globalAlpha/);
  assert.match(rigSource, /function getPreparedJawBlend/);
  assert.match(rigSource, /texturePolicy = "split-mouth-dominant-sharp-stable-buffer"/);
  assert.match(rigSource, /stationaryFacePolicy = "base-only"/);
  assert.match(rigSource, /restorationPolicy = "no-cheek-fill"/);
  assert.match(rigSource, /const useTarget = fromLabel !== toLabel && mix >= 0\.5/);
  assert.match(rigSource, /__localFaceRigMouthDisplayBuffer/);
  assert.match(rigSource, /displayContext\.globalCompositeOperation = "copy"/);
  assert.doesNotMatch(rigSource, /blendContext\.globalAlpha = mix/);
  assert.match(rigSource, /mouthChinDistanceDeltaPx/);
  assert.match(rigSource, /const jawArc = Math\.pow\(jaw, 0\.86\)/);
  assert.match(rigSource, /const jawResponseByViseme/);
  assert.match(rigSource, /jawOpen: aperture \* jawResponse/);
  assert.match(rigSource, /const rows = \[0\.489, 0\.505, 0\.52, 0\.548, 0\.595\]/);
  assert.match(rigSource, /const rowOffsets = \[0, -0\.0006 \* upperLift, -0\.0012 \* upperLift, 0\.016 \* jawArc, 0\.024 \* jawArc\]/);
  assert.match(rigSource, /const lowerLipOffsetPx = rowOffsets\[3\] \* width/);
  assert.match(rigSource, /upperLipOffsetPx/);
  assert.match(rigSource, /const stripHeight = 1/);
  assert.match(rigSource, /for \(let sourceY = rows\[2\]; sourceY < rows\.at\(-1\); sourceY \+= stripHeight\)/);
  assert.doesNotMatch(rigSource, /restoreContext\.drawImage/);
  assert.match(rigSource, /const mouthMaskScaleY = viseme === "A" \? 0\.86 : 1/);
  assert.match(rigSource, /maskSampleContext\.drawImage\(authoredMask/);
  assert.match(rigSource, /const mouthSourceLeft = width \* 0\.37/);
  assert.match(rigSource, /const mouthSourceWidth = width \* 0\.245/);
  assert.match(rigSource, /mouthPixels\.data\[index \+ 3\] = maskPixels\.data\[index \+ 3\]/);
  assert.match(rigSource, /jawLayerPolicy = "continuous-jaw-geometry-preserved"/);
  assert.match(rigSource, /mouthMaskPolicy = "mediapipe-lip-union-color-matched"/);
  assert.match(rigSource, /const jawMaskCenterY = width \* 0\.563/);
  assert.doesNotMatch(rigSource, /drawTexturedTriangle|seamOverlapPx/);
  assert.doesNotMatch(rigSource, /leftCornerBuffer/);
  assert.match(rigSource, /Both mouth corners come exclusively from the two identity-locked viseme/);
  assert.match(rigSource, /globalCompositeOperation = "copy"/);
  assert.match(rigSource, /globalCompositeOperation = "destination-in"/);
  assert.match(rigSource, /createRadialGradient\(0, 0, 0, 0, 0, 1\)/);
  assert.match(rigSource, /const channelOffsets = colorDelta\.map/);
});

test("avatar settings expose local and reserve cloud GPU without enabling it", async () => {
  const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(appSource, /label="设置" detail=\{avatarMode === "local" \? "本地" : "云GPU"\}/);
  assert.match(appSource, />云GPU</);
  assert.match(appSource, /单嘴唇与下巴特征 · 默认/);
  assert.match(appSource, />后续接入</);
  assert.match(appSource, /const cloudGpuAvailable = false/);
  assert.match(appSource, /authentic && avatarMode === "cloud-gpu"/);
});
