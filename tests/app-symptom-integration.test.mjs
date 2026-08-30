import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../src/App.jsx", import.meta.url);

test("talk UI renders state-machine options as large touch answers", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /advanceSymptomConversation, resetSymptomConversation, startSymptomConversation/);
  assert.match(source, /symptomConversation\?\.active && symptomConversation\.options\?\.length > 0/);
  assert.match(source, /className="symptom-choice-grid"/);
  assert.match(source, /symptomConversation\.options\.map/);
  assert.match(source, /handleText\(option\.label, \{ source: "touch", symptomOption: \{ questionId: symptomConversation\.question\?\.id, optionId: option\.id \} \}\)/);
  assert.match(source, /\? <div className="symptom-choice-section"[\s\S]*: <div className="prompt-section">/);
});

test("voice and touch route through the same symptom state without a keyword-only gate", async () => {
  const source = await readFile(appPath, "utf8");
  const handleStart = source.indexOf("const handleText = useCallback");
  const handleEnd = source.indexOf("const stopListening = useCallback", handleStart);
  const handleSource = source.slice(handleStart, handleEnd);

  assert.ok(handleStart >= 0 && handleEnd > handleStart);
  assert.match(handleSource, /source = "touch", symptomOption = null/);
  assert.match(handleSource, /symptomConversation\?\.active\s*\? advanceSymptomConversation/);
  assert.match(handleSource, /: startSymptomConversation\(symptomInput\)/);
  assert.match(source, /handleText\(resultText\.text, \{ source: "voice" \}\)/);
  assert.match(source, /handleText\(finalText, \{ source: "voice" \}\)/);
});

test("only an explicit health-assessment request starts the fixed questionnaire", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /function isExplicitAssessmentRequest/);
  assert.match(source, /if \(isExplicitAssessmentRequest\(text\)\)/);
  assert.doesNotMatch(source, /if \(\/测评\|测试\|评估\/\.test\(value\)\)/);
  assert.match(source, /return buildOffTopicReply\(text, \{ messages \}\)/);
  assert.doesNotMatch(source, /为了更准确地帮助您，我可以先陪您完成健康测评/);
});

test("local health routes are handled before the off-topic fallback", async () => {
  const appSource = await readFile(appPath, "utf8");
  assert.match(appSource, /buildOffTopicReply\(text, \{ messages \}\)/);
  assert.ok(appSource.indexOf("/血糖|低血糖|空腹糖|餐后糖/") < appSource.indexOf("return buildOffTopicReply"));
  assert.ok(appSource.indexOf("/康复|术后|功能训练|辅具/") < appSource.indexOf("return buildOffTopicReply"));
});

test("AI interprets free voice answers before the symptom state advances", async () => {
  const source = await readFile(appPath, "utf8");
  assert.match(source, /window\.kioskBridge\?\.interpretSymptom/);
  assert.match(source, /symptomInput = \{ text, questionId: symptomConversation\.question\?\.id, optionId: interpreted\.optionId \}/);
  assert.match(source, /symptomAcknowledgement/);
  assert.match(source, /deepSeekChatStream\(\{[\s\S]*messages: payload,[\s\S]*context,/);
  assert.match(source, /createIncrementalSpeechSegmenter/);
  assert.match(source, /cancelDeepSeekChat/);
  assert.match(source, /setAiChoices\(Array\.isArray\(aiResponse\.options\)/);
});

test("speech retry feedback is assertive, in-flow, and long enough to read", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /notice\.kind === "speech-retry"/);
  assert.match(source, /role=\{speechRetry \? "alert" : "status"\}/);
  assert.match(source, /kind === "speech-retry" \? 4800 : 2800/);
  assert.match(source, /toast\?\.kind === "speech-retry" && <ToastNotice notice=\{toast\} inline\/>/);
});
