import assert from "node:assert/strict";
import test from "node:test";

import { buildOffTopicReply } from "../src/offTopicReply.js";

test("连续相同的非健康问题不会返回完全相同的兜底回答", () => {
  const messages = [];
  const replies = [];
  for (let index = 0; index < 4; index += 1) {
    const reply = buildOffTopicReply("火星上能种花吗", { messages });
    replies.push(reply.text);
    messages.push({ role: "user", text: "火星上能种花吗" }, { role: "assistant", text: reply.text });
  }
  assert.equal(new Set(replies).size, replies.length);
  assert.ok(replies.every((text) => text.length <= 80));
  assert.ok(replies.every((text) => !/请先完成健康测评|人工转接|工作人员/.test(text)));
});

test("能本地确认的日期先直接回答，再给一个可选引导", () => {
  const reply = buildOffTopicReply("今天星期几", { now: new Date(2026, 7, 20, 10, 30) });
  assert.match(reply.text, /^今天是2026年8月20日，星期四。/);
  assert.match(reply.text, /如果|您也可以|需要时|想整体/);
});

test("实时信息无法核对时不编造，并优先衔接最近健康主题", () => {
  const reply = buildOffTopicReply("深圳天气怎么样", {
    messages: [
      { role: "user", text: "我最近睡眠不太好" },
      { role: "assistant", text: "您主要是入睡困难，还是夜里容易醒？" },
    ],
  });
  assert.match(reply.text, /无法核对|看不到实时天气/);
  assert.match(reply.text, /睡眠/);
  assert.doesNotMatch(reply.text, /健康测评/);
});
