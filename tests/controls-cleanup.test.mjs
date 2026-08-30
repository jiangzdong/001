import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../src/App.jsx", import.meta.url);
const stylesPath = new URL("../src/styles.css", import.meta.url);

test("talk home action lives in the top navigation and never covers the avatar", async () => {
  const appSource = await readFile(appPath, "utf8");

  assert.match(appSource, /screen === "talk" && <button[^>]*className="topbar-home"/);
  assert.match(appSource, /<HouseLine weight="bold"\/><span>主页<\/span>/);
  assert.doesNotMatch(appSource, /talk-stage-controls|home-return|talk-stage-module/);
});

test("volume changes every speech playback path", async () => {
  const appSource = await readFile(appPath, "utf8");

  assert.match(appSource, /video\.volume = volume \/ 100/);
  assert.match(appSource, /utterance\.volume = volume \/ 100/);
  assert.match(appSource, /masterGain\.gain\.setValueAtTime\(\(volume \/ 100\) \* nativeSpeechOutputGain/);
  assert.match(appSource, /context\.setSinkId\("default"\)/);
  assert.match(appSource, /beginVoiceConversation = \(\) => openScreen\("talk", "您好，我是小安/);
  assert.match(appSource, /audioGainRef\.current = masterGain/);
  assert.match(appSource, /type="range" min="0" max="100" step="10"/);
  assert.match(appSource, /window\.localStorage\.setItem\("xiaoan\.volume"/);
});

test("configured AI has no settings button and forehead taps paint no feedback", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.doesNotMatch(appSource, />\{aiReady \? "设置" : "连接"\}<\/button>/);
  assert.match(appSource, /\{!aiReady && <button[^>]*className="online"[\s\S]*?>连接<\/button>}/);
  assert.match(styles, /\.forehead-admin-trigger:focus-visible[\s\S]*?-webkit-tap-highlight-color:\s*transparent/);
  assert.match(styles, /opacity:\s*0\s*!important/);
  assert.match(styles, /transform:\s*none\s*!important/);
  assert.match(styles, /\.forehead-admin-trigger\s*\{[\s\S]*?z-index:\s*6/);
  assert.match(styles, /\.volume-panel\s*\{[\s\S]*?z-index:\s*14/);
});
