const phraseEntries = [
  ["jintianyouhuodongma", "今天有活动吗"],
  ["jintianyouhuodong", "今天有活动"],
  ["jiankangjiangtangjidiankaishi", "健康讲堂几点开始"],
  ["zhucanfuwujidiankaishi", "助餐服务几点开始"],
  ["wodeyueyouduoshao", "我的余额有多少"],
  ["jintian", "今天"],
  ["huodong", "活动"],
  ["badujin", "八段锦"],
  ["jiankang", "健康"],
  ["jiangtang", "讲堂"],
  ["jiankangjiangtang", "健康讲堂"],
  ["jidian", "几点"],
  ["kaishi", "开始"],
  ["canjia", "参加"],
  ["fuwu", "服务"],
  ["zhucan", "助餐"],
  ["wode", "我的"],
  ["yue", "余额"],
  ["duoshao", "多少"],
  ["you", "有"],
  ["ma", "吗"],
  ["qingwen", "请问"],
  ["nihao", "你好"],
  ["xiexie", "谢谢"],
];

export const advisorChineseQuickPhrases = [
  "今天有活动吗",
  "健康讲堂几点开始",
  "助餐服务几点开始",
  "我的余额有多少",
];

export function normalizeAdvisorPinyin(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 28);
}

export function getAdvisorChineseCandidates(value, limit = 6) {
  const pinyin = normalizeAdvisorPinyin(value);
  if (!pinyin) return advisorChineseQuickPhrases.slice(0, limit);
  const exact = phraseEntries.filter(([key]) => key === pinyin);
  const prefix = phraseEntries.filter(([key]) => key !== pinyin && key.startsWith(pinyin));
  const contained = phraseEntries.filter(([key]) => key !== pinyin && !key.startsWith(pinyin) && key.includes(pinyin));
  return [...exact, ...prefix, ...contained].map(([, text]) => text).filter((text, index, values) => values.indexOf(text) === index).slice(0, limit);
}
