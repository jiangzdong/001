import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("DeepSeek chat treats the current voice input as an answer before starting a new topic", async () => {
  const [source, streamHelper, streamClient] = await Promise.all([
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/deepseek-stream.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/deepseek-client.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(source, /判断用户当前输入是否是在回答小安上一轮的问题/);
  assert.match(source, /不得重新问候、重新介绍能力、改成综合测评或输出通用兜底/);
  assert.match(source, /response_format: \{ type: "json_object" \}/);
  assert.match(source, /"intent":"health_answer\|health_question\|off_topic\|meta"/);
  assert.match(streamHelper, /options: options\.length >= 2 \? options : \[\]/);
  assert.match(streamClient, /stream: true/);
  assert.match(source, /requestDeepSeekStream/);
  assert.match(source, /ipcMain\.handle\("deepseek:cancel"/);
});

test("natural symptom speech is interpreted by AI and constrained to reviewed option IDs", async () => {
  const [main, preload] = await Promise.all([
    readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /async function interpretSymptom/);
  assert.match(main, /“没有”“都没有”等简短回答要结合当前问题理解/);
  assert.match(main, /optionIds\.has\(parsed\.optionId\)/);
  assert.match(main, /ipcMain\.handle\("deepseek:interpret-symptom"/);
  assert.match(preload, /interpretSymptom: \(payload\) => ipcRenderer\.invoke\("deepseek:interpret-symptom"/);
});
