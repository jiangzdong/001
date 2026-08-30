export const skillCatalog = [
  { id: "health-assessment", title: "完成健康测评", description: "大约需要3分钟", entryScreen: "assessment", icon: "assessment", featured: true },
  { id: "report-explanation", title: "听懂我的报告", description: "用简单的话解释结果", entryScreen: "result", icon: "report" },
  { id: "health-action-plan", title: "制定健康计划", description: "从容易做到的小事开始", entryScreen: "plan", icon: "plan" },
];

export const primarySkills = skillCatalog.filter((skill) => !skill.utility);

export const healthManagementDomains = [
  { id: "assessment", title: "健康评测", reference: "references/domains/健康评测.md" },
  { id: "glucose", title: "血糖管理", reference: "references/domains/血糖管理.md" },
  { id: "massage", title: "按摩健康指导", reference: "references/domains/按摩健康指导.md" },
  { id: "rehabilitation", title: "康复管理", reference: "references/domains/康复管理.md" },
  { id: "sleep", title: "睡眠健康", reference: "references/domains/睡眠健康.md" },
  { id: "brain", title: "脑健康", reference: "references/domains/脑健康.md" },
  { id: "exercise", title: "运动康复", reference: "references/domains/运动康复.md" },
];

export const screenNarration = {
  welcome: "您好，我是您的健康管理师小安。我们一起完成今天的健康测评。",
  consent: "开始前，请您了解并选择信息使用方式。",
  recognize: "请看向屏幕，我正在确认您的身份。",
  identity: "我识别到您可能是李老师，请您确认。",
  menu: "李老师，今天想先了解哪一项？",
  analyzing: "测评已经完成，我正在整理结果，请稍等。",
  result: "结果已经整理好了，我先讲最重要的内容。",
  plan: "我为您整理了三件容易做到的小事。",
  complete: "本次服务已经完成，屏幕上的个人信息正在清除。",
};
