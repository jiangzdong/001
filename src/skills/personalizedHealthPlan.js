import { calculateAssessmentResult } from "./healthAssessment.js";

const PLAN_RULES = {
  sleep: {
    domain: "sleep", skillDomain: "sleep", title: "睡眠与恢复", priority: 70,
    insight: ["睡眠基本平稳", "睡眠偶有波动", "睡眠是当前优先关注方向"],
    actions: {
      1: { id: "sleep-log", text: "连续7天记录睡眠", tracking: "记下上床时间、夜醒次数和早晨感受" },
      2: { id: "sleep-routine", text: "今晚固定上床时间", tracking: "减少临睡前长时间看屏幕，并记录夜醒情况" },
    },
  },
  appetite: {
    domain: "nutrition", skillDomain: "assessment", title: "饮食与胃口", priority: 80,
    insight: ["胃口基本稳定", "胃口需要继续观察", "近期胃口变化值得优先记录"],
    actions: {
      1: { id: "meal-log", text: "连续3天记录每餐食量", tracking: "用吃完、大半、不到一半做简单标记" },
      2: { id: "small-meals", text: "先安排少量规律进餐", tracking: "记录食量变化，不勉强一次吃太多" },
    },
  },
  activity: {
    domain: "exercise", skillDomain: "exercise", title: "日常活动", priority: 55,
    insight: ["活动习惯保持得不错", "活动频率还有提升空间", "近期活动偏少"],
    actions: {
      1: { id: "activity-3days", text: "本周选3天轻松活动", tracking: "每次10分钟，以身体感觉舒适为准" },
      2: { id: "activity-start", text: "今天先活动5分钟", tracking: "可选散步、做操或家务，不适时立即停止" },
    },
  },
  medicine: {
    domain: "medication", skillDomain: "assessment", title: "按时服药", priority: 90,
    insight: ["服药执行比较稳定", "偶尔会忘记服药", "服药记录需要优先改善"],
    actions: {
      1: { id: "medicine-check", text: "每次服药后做一个标记", tracking: "把记录放在药盒旁边，避免重复或遗漏" },
      2: { id: "medicine-reminder", text: "设置固定服药提醒", tracking: "记录漏服情况，不自行补服或改变用量" },
    },
  },
  mood: {
    domain: "brain", skillDomain: "brain", title: "心情与精力", priority: 65,
    insight: ["心情整体比较平稳", "心情偶有低落", "近期心情变化值得持续记录"],
    actions: {
      1: { id: "mood-note", text: "每天记录一次心情", tracking: "同时记下当天做过的一件事" },
      2: { id: "mood-small-task", text: "今天安排一件愿意做的小事", tracking: "完成后记录心情是否有变化" },
    },
  },
  walking: {
    domain: "mobility", skillDomain: "rehabilitation", title: "走路稳定", priority: 105,
    insight: ["走路稳定情况较好", "走路偶尔不稳", "走路稳定是当前优先关注方向"],
    actions: {
      1: { id: "walking-context", text: "记录走路不稳的场景", tracking: "记下时间、地点和当时是否疲劳" },
      2: { id: "walking-path", text: "先检查常走通道", tracking: "移开绊脚物，保持夜间照明，走动前先站稳" },
    },
  },
  fall: {
    domain: "mobility", skillDomain: "rehabilitation", title: "跌倒预防", priority: 110,
    insight: ["近期没有跌倒记录", "近期有过一次跌倒", "近期多次跌倒需要重点记录"],
    actions: {
      1: { id: "fall-review", text: "记录那次跌倒的经过", tracking: "写下时间、地点和可能的绊倒原因" },
      2: { id: "fall-environment", text: "今天检查居家行走环境", tracking: "优先检查地面、通道、浴室和夜间照明" },
    },
  },
  selfRating: {
    domain: "assessment", skillDomain: "assessment", title: "整体健康感受", priority: 40,
    insight: ["整体健康感受较好", "整体健康感受一般", "整体健康感受需要继续梳理"],
    actions: {
      1: { id: "focus-one", text: "选一个最想改善的方面", tracking: "一周后回顾是否有变化" },
      2: { id: "concern-note", text: "写下目前最困扰的一件事", tracking: "作为下一次健康回顾的重点" },
    },
  },
};

const ROUTINE_ACTIONS = [
  { id: "routine-activity", domain: "exercise", skillDomain: "exercise", title: "日常活动", text: "保持每天轻松活动", tracking: "散步、做操或家务任选一种" },
  { id: "routine-sleep", domain: "sleep", skillDomain: "sleep", title: "睡眠与恢复", text: "保持规律作息", tracking: "一周后回顾睡眠和精神状态" },
  { id: "routine-review", domain: "assessment", skillDomain: "assessment", title: "健康回顾", text: "记录一项健康变化", tracking: "下次测评时与本次结果对照" },
];

function severityLabel(score) {
  return score >= 2 ? "priority" : score === 1 ? "watch" : "stable";
}

export function buildPersonalizedHealthPlan(answers) {
  const result = calculateAssessmentResult(answers);
  const dimensions = answers.map((answer) => {
    const rule = PLAN_RULES[answer.id];
    if (!rule) return null;
    const score = Math.max(0, Math.min(2, Number(answer.score) || 0));
    return { id: answer.id, answerId: answer.answerId, score, severity: severityLabel(score), ...rule };
  }).filter(Boolean);

  const priorities = dimensions.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.priority - a.priority);
  const selectedDomains = new Set();
  const actions = [];
  for (const item of priorities) {
    if (selectedDomains.has(item.domain)) continue;
    const action = item.actions[item.score];
    if (!action) continue;
    selectedDomains.add(item.domain);
    actions.push({ ...action, domain: item.domain, skillDomain: item.skillDomain, title: item.title, sourceQuestionId: item.id, severity: item.severity });
    if (actions.length === 3) break;
  }
  for (const fallback of ROUTINE_ACTIONS) {
    if (actions.length === 3) break;
    if (selectedDomains.has(fallback.domain)) continue;
    selectedDomains.add(fallback.domain); actions.push({ ...fallback, severity: "stable" });
  }

  const insightSource = priorities.length ? priorities.slice(0, 2) : dimensions.filter((item) => item.score === 0).slice(0, 2);
  const insights = insightSource.map((item) => ({
    id: item.id,
    domain: item.domain,
    title: item.title,
    text: item.insight[item.score],
    detail: item.score > 0 ? "已加入本次个性化计划" : "继续保持目前习惯",
    severity: item.severity,
  }));

  return {
    ...result,
    dimensions,
    priorities: priorities.map(({ id, domain, skillDomain, title, score, severity }) => ({ id, domain, skillDomain, title, score, severity })),
    insights,
    actions,
    focusTitle: priorities.length ? `先关注${priorities[0].title}` : "继续保持平稳习惯",
    planSignature: actions.map((action) => action.id).join("|"),
  };
}

export { PLAN_RULES };
