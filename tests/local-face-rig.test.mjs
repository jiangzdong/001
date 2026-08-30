import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLocalFaceActions, localFaceRigSources } from "../src/localFaceRig.js";

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

test("local rig owns every runtime viseme and does not transform the full mouth rectangle", async () => {
  assert.deepEqual(Object.keys(localFaceRigSources), ["CLOSED", "REST", "A", "E", "O", "U", "F", "L", "S", "SH"]);
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
  assert.match(rigSource, /local-mouth-chin-v2/);
  assert.match(rigSource, /textureContext\.drawImage\(master, 0, 0\)/);
  assert.match(rigSource, /mouthContext\.drawImage\(texture, 0, 0\)/);
  assert.doesNotMatch(rigSource, /nextTexture|mouthContext\.globalAlpha/);
  assert.match(rigSource, /mouthChinDistanceDeltaPx/);
  assert.match(rigSource, /const rowOffsets = \[0, -0\.0005 \* upperLift, 0\.0105 \* lowerDrop, 0\.009 \* jaw, 0\.009 \* jaw, 0\.009 \* jaw, 0\]/);
  assert.match(rigSource, /const jawInterior = columnIndex >= 2 && columnIndex <= columns\.length - 3/);
  assert.doesNotMatch(rigSource, /point\.x \+=/);
  assert.match(rigSource, /globalCompositeOperation = "destination-in"/);
  assert.match(rigSource, /createRadialGradient\(0, 0, 0, 0, 0, 1\)/);
  assert.match(rigSource, /feather\.addColorStop\(1, "rgba\(0,0,0,0\)"\)/);
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
