import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("idle and speaking states share the versioned Ditto source and wait for a decoded video frame", async () => {
  const [source, publicMaster, appSource, styles] = await Promise.all([
    readFile(new URL("../ditto-validation/xiaoa-source.png", import.meta.url)),
    readFile(new URL("../public/assets/xiaoa-ditto-master-v1.0.2.png", import.meta.url)),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(publicMaster, source);
  assert.equal((appSource.match(/xiaoa-ditto-master-v1\.0\.2\.png/g) ?? []).length, 1);
  assert.match(appSource, /digital-human__video/);
  assert.match(appSource, /digital-human__frame/);
  assert.match(appSource, /createImageBitmap/);
  assert.match(appSource, /const \[videoReady, setVideoReady\] = useState\(false\)/);
  assert.match(appSource, /requestVideoFrameCallback/);
  assert.match(appSource, /\(videoActive && videoReady\) \|\| \(frameActive && frameReady\) \? "has-ready-video"/);
  assert.match(appSource, /onLoadedData=\{confirmVideoFrame\} onPlaying=\{confirmVideoFrame\}/);
  assert.match(appSource, /const \[videoSettling, setVideoSettling\] = useState\(false\)/);
  assert.match(appSource, /const finishVideo = \(\) => \{[\s\S]*setVideoSettling\(true\)[\s\S]*setVideoReady\(false\)[\s\S]*onVideoEnded\?\.\(\)/);
  assert.match(appSource, /const failVideo = \(\) => \{ clearVideoFrame\(\); clearVideoExitTimer\(\); setVideoSettling\(false\); setVideoReady\(false\);/);
  assert.match(styles, /\.digital-human__video\{[^}]*visibility:hidden[^}]*transition:none/);
  assert.match(styles, /\.digital-human__frame\{[^}]*object-fit:cover;object-position:50% 0/);
  assert.match(styles, /\.digital-human\.has-ready-video \.digital-human__video\{visibility:visible\}/);
  assert.match(styles, /V1\.0\.5[\s\S]*object-position: 50% 0;[\s\S]*filter: saturate\(\.94\) contrast\(1\.01\);/);
  assert.match(styles, /V1\.0\.6:[\s\S]*is-video-settling[\s\S]*opacity 320ms/);
});
