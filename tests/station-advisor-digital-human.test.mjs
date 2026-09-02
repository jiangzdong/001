import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("../src/StationAdvisorDigitalHuman.jsx", import.meta.url);
const stylesUrl = new URL("../src/station-advisor-digital-human.css", import.meta.url);
const advisorStylesUrl = new URL("../src/station-advisor.css", import.meta.url);
const compositorProbeUrl = new URL("../scripts/probe-station-compositor.mjs", import.meta.url);

test("station advisor digital human reuses the local photographic face rig", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /loadLocalFaceRigImages/);
  assert.match(source, /loadLocalFaceRigImage\(stationHomeFullBodySource\)/);
  assert.match(source, /createStationHomeFaceMaster\(canvas, fullBodyImage\)/);
  assert.match(source, /renderLocalFaceRig/);
  assert.match(source, /sampleVisemeTimeline/);
  assert.match(source, /sampleJawPose/);
  assert.match(source, /sampleBlinkEnvelope/);
  assert.match(source, /xiaoa-ditto-master-v1\.0\.3\.png/);
  assert.match(source, /xiaoa-blink-half-v6\.png/);
  assert.match(source, /xiaoa-expression-listening-v4\.png/);
  assert.doesNotMatch(source, /placeholder|fake-avatar/i);
});

test("station advisor digital human exposes the existing analyser and viseme timeline contract", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /analyserRef/);
  assert.match(source, /visemeTimelineRef/);
  assert.match(source, /timeline\?\.visemes\?\.length/);
  assert.match(source, /data-rig-ready/);
  assert.match(source, /data-avatar-mode="local"/);
  assert.match(source, /timestamp - lastRigPaintAt >= 15/);
  assert.doesNotMatch(source, /timestamp - lastRigPaintAt >= 30/);
});

test("station advisor avatar layers keep the identity masks and reduced-motion fallback", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /station-advisor-digital-human__local-rig/);
  assert.match(styles, /advisor-avatar-stage\.is-compact[\s\S]*local-rig[\s\S]*object-position:\s*50% 0/);
  assert.match(styles, /station-advisor-digital-human__blink-frame--screen-right/);
  assert.match(styles, /52\.9cqw 41\.1cqw/);
  assert.doesNotMatch(styles, /5\.65cqw 1\.9cqw at 56cqw 41\.45cqw/);
  assert.match(styles, /44\.2cqw 41\.45cqw/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("home full-body face uses the source-derived affine scale for mouth and both eyes", async () => {
  const styles = await readFile(advisorStylesUrl, "utf8");
  assert.match(styles, /translate3d\(4\.766cqw, -\.45cqw, 0\) scale\(\.64744\)/);
  assert.match(styles, /\.advisor-avatar-stage\.is-home \.station-advisor-digital-human__local-rig \{\s*transform: none;/);
  assert.match(styles, /\.advisor-avatar-stage\.is-home \.station-advisor-digital-human__local-rig \{[\s\S]*radial-gradient\(ellipse 42% 46% at 50% 54%/);
  assert.doesNotMatch(styles, /local-rig \{[\s\S]{0,220}ellipse 5\.2cqw 3\.5cqw/);
  assert.match(styles, /\.advisor-avatar-stage\.is-home \.station-advisor-digital-human__blink-frame \{\s*transform: none;/);
  assert.doesNotMatch(styles, /ellipse 2\.8cqw 1\.15cqw|ellipse 3cqw 1\.2cqw/);
  assert.match(styles, /translate3d\(32\.5cqw, 1\.5cqw, 0\) scale\(\.84\)/);
});

test("V34 compositor probe crops each final window from the live rig rectangle", async () => {
  const probe = await readFile(compositorProbeUrl, "utf8");

  assert.match(probe, /const faceClipFor = \(state\) =>/);
  assert.match(probe, /const rig = state\?\.rigRect/);
  assert.match(probe, /The rig element is the only reliable live coordinate system after a/);
  assert.match(probe, /const topPadding = rig\.height \* 0\.8/);
  assert.match(probe, /const captureScaleFor = \(clip\) => Math\.max\(2, Math\.min\(12, 420/);
  assert.match(probe, /const idleFaceClip = faceClipFor\(initial\)/);
  assert.match(probe, /const faceClip = faceClipFor\(held\)/);
  assert.match(probe, /faceClip, captureScale: captureScaleFor\(faceClip\), composite: attemptPath/);
  assert.doesNotMatch(probe, /const center = \{[\s\S]*?initial\.fullBodyRect/);
});
