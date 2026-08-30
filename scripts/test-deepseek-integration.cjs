const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { createReplyDeltaTracker, normalizeDeepSeekChatResult, parseSseBuffer } = require("../electron/deepseek-stream.cjs");

function findCredential() {
  const appData = app.getPath("appData");
  const candidates = [
    path.join(appData, "XiaoAnHealthKiosk", "deepseek.credential"),
    path.join(appData, "小安数字健康管理师", "deepseek.credential"),
    ...fs.readdirSync(appData, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^小安数字健康管理师 V\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => path.join(appData, entry.name, "deepseek.credential")),
  ];
  return candidates.find((filename) => fs.existsSync(filename));
}

app.whenReady().then(async () => {
  const credential = findCredential();
  if (!credential || !safeStorage.isEncryptionAvailable()) throw new Error("没有找到可用的已加密 DeepSeek 密钥");
  const key = safeStorage.decryptString(fs.readFileSync(credential));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 300,
      stream: true,
      messages: [
        {
          role: "system",
          content: "你是服务60岁以上用户的数字健康管理师。先判断用户当前输入是否在回答上一问；如果相关，必须确认这项回答并继续当前健康话题，不得改成综合测评或通用兜底。只输出JSON：{\"intent\":\"health_answer|health_question\",\"reply\":\"简短自然回应\"}。",
        },
        { role: "assistant", content: "您的头痛是突然发生的，还是慢慢出现的？" },
        { role: "user", content: "是慢慢开始的，已经疼了两三个小时。" },
      ],
    }),
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
  if (!response.body) throw new Error("DeepSeek did not return an SSE body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const tracker = createReplyDeltaTracker();
  let buffer = "";
  let raw = "";
  let replyDeltaCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parsedFrames = parseSseBuffer(buffer, { flush: done });
    buffer = parsedFrames.remainder;
    for (const data of parsedFrames.events) {
      if (data === "[DONE]") continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      const content = String(event?.choices?.[0]?.delta?.content || "");
      if (!content) continue;
      raw += content;
      if (tracker.update(raw).delta) replyDeltaCount += 1;
    }
    if (done) break;
  }
  clearTimeout(timeout);
  const parsed = JSON.parse(raw || "{}");
  const normalized = normalizeDeepSeekChatResult(parsed);
  if (!normalized.ok || normalized.intent !== "health_answer" || replyDeltaCount < 1 || /完成健康测评|再简单说一说最想了解/.test(normalized.text)) {
    throw new Error(`DeepSeek 没有正确承接上一问：${JSON.stringify(parsed)}`);
  }
  process.stdout.write(`DEEPSEEK STREAM INTEGRATION OK: ${normalized.intent} | chunks=${replyDeltaCount} | ${normalized.text}\n`);
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`DEEPSEEK INTEGRATION FAILED: ${error?.stack || error}\n`);
  app.exit(1);
});
