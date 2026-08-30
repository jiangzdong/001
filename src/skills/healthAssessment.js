export const assessmentQuestions = [
  { id: "sleep", title: "最近一周，您的睡眠怎么样？", hint: "请点击选择，或直接说出您的答案", options: [
    { label: "睡得很好", score: 0, keywords: ["很好", "睡得好"] }, { label: "一般", score: 1, keywords: ["一般", "还行"] }, { label: "经常睡不好", score: 2, keywords: ["不好", "睡不着"] },
  ]},
  { id: "appetite", title: "最近一周，您的胃口怎么样？", hint: "请选择最接近的情况", options: [
    { label: "胃口很好", score: 0, keywords: ["很好", "胃口好"] }, { label: "和平时差不多", score: 1, keywords: ["差不多", "一般"] }, { label: "明显变差", score: 2, keywords: ["变差", "吃不下"] },
  ]},
  { id: "activity", title: "您平时多久活动一次？", hint: "散步、做操和家务都算活动", options: [
    { label: "几乎每天", score: 0, keywords: ["每天", "经常"] }, { label: "每周两三次", score: 1, keywords: ["两三次", "每周"] }, { label: "很少活动", score: 2, keywords: ["很少", "不活动"] },
  ]},
  { id: "medicine", title: "您能按时服用医生开的药吗？", hint: "请按实际情况回答", options: [
    { label: "一直按时", score: 0, keywords: ["按时", "一直"] }, { label: "偶尔会忘记", score: 1, keywords: ["偶尔", "有时"] }, { label: "经常会忘记", score: 2, keywords: ["经常忘", "总是忘"] },
  ]},
  { id: "mood", title: "最近一周，您的心情怎么样？", hint: "没有标准答案，请按感受选择", options: [
    { label: "轻松平稳", score: 0, keywords: ["轻松", "平稳"] }, { label: "偶尔有些低落", score: 1, keywords: ["偶尔", "有点"] }, { label: "经常感到低落", score: 2, keywords: ["经常", "低落"] },
  ]},
  { id: "walking", title: "最近走路时，会感觉不稳吗？", hint: "请选择最接近的情况", options: [
    { label: "没有", score: 0, keywords: ["没有", "不会"] }, { label: "偶尔会", score: 1, keywords: ["偶尔", "有时"] }, { label: "经常会", score: 2, keywords: ["经常", "会"] },
  ]},
  { id: "fall", title: "最近半年，您有跌倒过吗？", hint: "请按实际情况回答", options: [
    { label: "没有跌倒", score: 0, keywords: ["没有", "没跌倒"] }, { label: "有过一次", score: 1, keywords: ["一次", "有过"] }, { label: "有过多次", score: 2, keywords: ["多次", "好几次"] },
  ]},
  { id: "selfRating", title: "您觉得自己现在的健康怎么样？", hint: "这是最后一题", options: [
    { label: "很好", score: 0, keywords: ["很好"] }, { label: "还可以", score: 1, keywords: ["还可以", "一般"] }, { label: "需要多关注", score: 2, keywords: ["关注", "不太好"] },
  ]},
];

const optionIds = {
  sleep: ["sleep-good", "sleep-average", "sleep-poor"],
  appetite: ["appetite-good", "appetite-average", "appetite-poor"],
  activity: ["activity-daily", "activity-weekly", "activity-rare"],
  medicine: ["medicine-on-time", "medicine-occasional", "medicine-often"],
  mood: ["mood-stable", "mood-sometimes-low", "mood-often-low"],
  walking: ["walking-none", "walking-occasional", "walking-often"],
  fall: ["fall-none", "fall-once", "fall-multiple"],
  selfRating: ["self-good", "self-average", "self-attention"],
};

const questionMetadata = {
  sleep: { type: "condition", domain: "sleep", skillDomain: "sleep" },
  appetite: { type: "condition", domain: "nutrition", skillDomain: "assessment" },
  activity: { type: "frequency", domain: "exercise", skillDomain: "exercise" },
  medicine: { type: "adherence", domain: "medication", skillDomain: "assessment" },
  mood: { type: "condition", domain: "brain", skillDomain: "brain" },
  walking: { type: "frequency", domain: "mobility", skillDomain: "rehabilitation" },
  fall: { type: "event-count", domain: "mobility", skillDomain: "rehabilitation" },
  selfRating: { type: "self-perception", domain: "assessment", skillDomain: "assessment" },
};

assessmentQuestions.forEach((question) => {
  Object.assign(question, questionMetadata[question.id]);
  question.options.forEach((option, index) => { option.id = optionIds[question.id][index]; });
});

export function calculateAssessmentResult(answers) {
  const score = answers.reduce((sum, answer) => sum + answer.score, 0);
  const hasPrioritySignal = answers.some((answer) => ["walking", "fall"].includes(answer.id) && answer.score === 2);
  return { score, level: score >= 6 || hasPrioritySignal ? "attention" : "routine" };
}
