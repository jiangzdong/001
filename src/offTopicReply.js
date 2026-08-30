const HEALTH_TOPICS = [
  { label: "头痛", pattern: /头痛|头疼|脑袋疼/ },
  { label: "头晕", pattern: /头晕|眩晕/ },
  { label: "睡眠", pattern: /睡眠|失眠|睡不着|夜里.{0,4}醒|早醒/ },
  { label: "血压", pattern: /血压/ },
  { label: "血糖", pattern: /血糖|低血糖|空腹糖|餐后糖/ },
  { label: "饮食", pattern: /饮食|营养|吃什么/ },
  { label: "活动", pattern: /运动|锻炼|散步|活动/ },
  { label: "用药", pattern: /吃药|服药|药物/ },
];

const GENERIC_LEADS = [
  "这个问题我只能简单回应。",
  "这个话题不在我的主要服务范围内。",
  "这件事我暂时没有足够信息准确回答。",
  "这个问题我了解得不够，不能随便下结论。",
];

const GENERIC_GUIDES = [
  { style: "describe_concern", text: "如果想聊健康问题，可以直接告诉我哪里不舒服。" },
  { style: "show_capability", text: "您也可以说说最近最想改善的睡眠、饮食或活动。" },
  { style: "show_capability", text: "需要时，我可以帮您整理健康问题和下一步。" },
  { style: "optional_assessment", text: "想整体了解身体情况时，也可以主动说“开始健康测评”。" },
];

function valueOf(message) {
  return String(message?.text ?? message?.content ?? "").trim();
}

function stableNumber(value) {
  let result = 0;
  for (const char of String(value || "")) result = (result * 31 + char.codePointAt(0)) >>> 0;
  return result;
}

function recentAssistantTexts(messages) {
  return messages.filter((item) => item?.role === "assistant").slice(-3).map(valueOf).filter(Boolean);
}

function recentHealthTopic(messages) {
  for (const message of [...messages].reverse()) {
    const text = valueOf(message);
    const found = HEALTH_TOPICS.find((topic) => topic.pattern.test(text));
    if (found) return found.label;
  }
  return "";
}

function guideOptions(topic) {
  if (!topic) return GENERIC_GUIDES;
  return [
    { style: "resume_topic", text: `如果愿意，我们可以继续聊刚才的${topic}。` },
    { style: "resume_topic", text: `关于刚才的${topic}，您还可以继续告诉我变化。` },
    { style: "show_capability", text: `需要时，我可以接着帮您整理${topic}的情况。` },
    ...GENERIC_GUIDES.slice(0, 2),
  ];
}

function leadOptions(text, now) {
  if (/(今天)?(星期几|周几)|今天几号|今天什么日期/.test(text)) {
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    return { category: "date", leads: [`今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日，${weekdays[now.getDay()]}。`] };
  }
  if (/几点|现在.{0,3}(时间|时候)|什么时间/.test(text)) {
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    return { category: "time", leads: [`现在大约是${hour}:${minute}。`] };
  }
  if (/天气|下雨|气温|温度|冷不冷|热不热/.test(text)) {
    return { category: "weather", leads: ["我现在看不到实时天气，出门前请查看本地天气预报。", "实时天气我目前无法核对，建议以本地天气预报为准。"] };
  }
  if (/新闻|股价|股票|行情|比赛结果|比分/.test(text)) {
    return { category: "realtime", leads: ["这类实时信息我现在无法可靠核对。", "我目前不能确认最新结果，不想给您不准确的信息。"] };
  }
  if (/会唱歌|唱首歌|唱歌/.test(text)) {
    return { category: "capability", leads: ["我现在不会唱歌，不过可以陪您聊几句。", "唱歌我还不会，但可以继续陪您说说话。"] };
  }
  return { category: "other", leads: GENERIC_LEADS };
}

export function buildOffTopicReply(input, { messages = [], now = new Date() } = {}) {
  const text = String(input || "").replace(/[，。！？\s]/g, "");
  const recent = recentAssistantTexts(messages);
  const topic = recentHealthTopic(messages);
  const { category, leads } = leadOptions(text, now);
  const guides = guideOptions(topic);
  const candidates = leads.flatMap((lead) => guides.map((guide) => ({
    text: `${lead}${guide.text}`,
    style: guide.style,
  })));
  const start = (stableNumber(text) + recent.length) % candidates.length;
  let selected = null;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(start + offset) % candidates.length];
    if (!recent.includes(candidate.text)) { selected = candidate; break; }
  }
  const result = selected || candidates[(start + recent.length) % candidates.length];
  return { ...result, category };
}
