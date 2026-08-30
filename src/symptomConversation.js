const MAX_KEY_QUESTIONS = 5;
const MAX_EMPTY_ANSWERS = 2;

const STOP_PATTERN = /(先这样|不想回答|不想说了|结束吧|结束问答|不用问了|到这里|退出)/;
const SLEEP_ONLY_PATTERN = /(睡眠|失眠|入睡|夜醒|早醒|睡不好|睡不着|睡得不好)/;

const SYMPTOMS = [
  { id: "headache", label: "头痛", domain: "head", patterns: [/头疼/g, /头痛/g, /脑袋疼/g] },
  { id: "dizziness", label: "头晕或站立不稳", domain: "balance", patterns: [/头晕/g, /眩晕/g, /站不稳/g, /走路不稳/g] },
  { id: "chest_discomfort", label: "胸部不适", domain: "chest", patterns: [/胸痛/g, /胸口疼/g, /胸口痛/g, /胸闷/g] },
  { id: "breathing", label: "呼吸不畅", domain: "breathing", patterns: [/喘不上气/g, /呼吸困难/g, /气短/g] },
  { id: "abdominal", label: "腹部不适", domain: "abdomen", patterns: [/肚子疼/g, /腹痛/g, /腹部不适/g] },
  { id: "limb_pain", label: "关节或肢体疼痛", domain: "mobility", patterns: [/腿疼/g, /腿痛/g, /膝盖疼/g, /膝痛/g, /关节疼/g, /关节痛/g, /胳膊疼/g, /手臂疼/g] },
  { id: "fatigue", label: "乏力", domain: "energy", patterns: [/乏力/g, /没力气/g, /浑身无力/g, /特别累/g] },
];

const SAFETY_RULES = [
  { id: "chest", pattern: /(胸痛|胸口疼|胸口痛|胸口很痛).{0,12}(持续|加重|压榨|冷汗|喘不上气|呼吸困难)|(持续|加重|压榨|喘不上气|呼吸困难).{0,8}(胸痛|胸口疼|胸口痛|胸口很痛)/ },
  { id: "breathing", pattern: /(严重|明显|突然).{0,5}(呼吸困难|喘不上气|气短)|(呼吸困难|喘不上气).{0,5}(加重|说不了话)/ },
  { id: "neurological", pattern: /(突然).{0,16}(嘴歪|口角歪|一侧无力|单侧无力|一边无力|说不清话|说话含糊|视力明显变化|看不清)/ },
  { id: "severe-headache", pattern: /(突然|一下子).{0,8}(剧烈|非常|特别|从未有过|前所未有).{0,5}(头痛|头疼)|(头痛|头疼).{0,8}(突然|一下子).{0,5}(剧烈|非常|特别|从未有过|前所未有)/ },
  { id: "consciousness", pattern: /(意识不清|意识混乱|叫不醒|昏厥|昏迷|抽搐)/ },
  { id: "bleeding", pattern: /(大量|不停).{0,5}(出血|流血)/ },
  { id: "fall-head", pattern: /(摔倒|跌倒|摔了|跌了).{0,12}(撞到头|头部受伤|磕到头).{0,8}(头痛|头晕|呕吐|不适|昏)/ },
  { id: "fall-function-loss", pattern: /(摔倒|跌倒|摔了|跌了).{0,12}(不能站|站不起来|无法站|不能走|走不了|动不了)/ },
  { id: "function-loss", pattern: /(突然).{0,8}(不能站|无法站|不能走|无法走|走不了|抬不起来)/ },
];

const COMMON_OPTIONS = {
  safety: [
    { id: "safety-present", label: "有其中一种情况", danger: true, patterns: [/^(我)?有(其中一种|这种|这些)情况$/, /^有$/] },
    { id: "safety-none", label: "没有这些情况", facts: { safetyChecked: true, safetyCleared: true }, patterns: [/(都|均)?没有(这些|上述)?情况/, /没有这些/, /都没有/, /一个也没有/, /无上述/] },
    { id: "safety-unclear", label: "说不清", facts: { safetyChecked: true, safetyUnknown: true }, patterns: [/说不清/, /不清楚/, /不知道/, /不确定/] },
  ],
  timing: [
    { id: "timing-today", label: "今天或刚刚开始", facts: { timing: "今天或刚刚开始" }, patterns: [/今天/, /刚刚/, /刚才/, /才开始/, /突然开始/] },
    { id: "timing-days", label: "已经几天了", facts: { timing: "已经几天" }, patterns: [/[一二三四五六七八九十两\d]+天/, /好几天/, /这几天/] },
    { id: "timing-recurrent", label: "反复一段时间了", facts: { timing: "反复一段时间" }, patterns: [/反复/, /经常/, /老是/, /一阵一阵/, /有一段时间/, /[一二三四五六七八九十两\d]+(周|个月|月)/] },
    { id: "timing-unclear", label: "记不清", facts: { timingUnknown: true }, patterns: [/记不清/, /说不清/, /不知道/] },
  ],
  impact: [
    { id: "impact-light", label: "不影响日常活动", facts: { impact: "不影响日常活动", impactLevel: "light" }, patterns: [/不影响/, /还能正常/, /不耽误/, /比较轻/, /一点点/] },
    { id: "impact-some", label: "有些影响，但还能活动", facts: { impact: "有些影响", impactLevel: "moderate" }, patterns: [/有点影响/, /有些影响/, /还能活动/, /还能走/, /忍得住/, /中等/] },
    { id: "impact-heavy", label: "明显影响活动或休息", facts: { impact: "明显影响活动或休息", impactLevel: "heavy" }, patterns: [/明显影响/, /影响睡觉/, /睡不着/, /不能活动/, /动不了/, /吃不下/, /很严重/] },
    { id: "impact-unclear", label: "说不清", facts: { impactUnknown: true }, patterns: [/说不清/, /不好说/, /不确定/] },
  ],
  context: [
    { id: "context-trigger", label: "能想到明显诱因", facts: { context: "有明显诱因" }, patterns: [/活动后/, /走路后/, /吃完/, /没吃饭/, /起身时/, /低头后/, /劳累后/, /能想到/] },
    { id: "context-none", label: "想不到明显诱因", facts: { context: "暂无明显诱因" }, patterns: [/想不到/, /没有诱因/, /没什么原因/, /无缘无故/] },
    { id: "context-recurrent", label: "以前也出现过", facts: { context: "以前出现过" }, patterns: [/以前也/, /之前也/, /老毛病/, /不是第一次/] },
    { id: "context-unclear", label: "说不清", facts: { contextUnknown: true }, patterns: [/说不清/, /不清楚/, /不知道/] },
  ],
  actions: [
    { id: "actions-none", label: "还没有处理", facts: { actionsTried: "尚未处理" }, patterns: [/没处理/, /还没有/, /什么也没做/, /没管/] },
    { id: "actions-rest", label: "休息或做了记录", facts: { actionsTried: "休息或记录" }, patterns: [/休息/, /躺了/, /记录/, /量了(血压|血糖)/] },
    { id: "actions-existing", label: "按原有医嘱处理过", facts: { actionsTried: "按原有医嘱处理" }, patterns: [/医嘱/, /医生以前说/, /按原来的安排/] },
    { id: "actions-unclear", label: "说不清", facts: { actionsUnknown: true }, patterns: [/说不清/, /不清楚/, /不知道/] },
  ],
};

const QUESTION_BANKS = {
  headache: [
    question("headache-safety", "这次头痛是否突然很剧烈，或伴一侧无力、说话或视力变化？", "safety", COMMON_OPTIONS.safety),
    question("headache-timing", "头痛是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("headache-impact", "现在对走动、休息或吃饭有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("headache-context", "近期是否跌倒撞到头，或能想到其他明显诱因？", "context", [
      { id: "head-context-injury", label: "近期跌倒撞到头", danger: true },
      ...COMMON_OPTIONS.context,
    ]),
    question("headache-actions", "您已经做过哪些处理？", "actions", COMMON_OPTIONS.actions),
  ],
  dizziness: [
    question("dizziness-safety", "头晕时是否昏倒、不能站立，或伴胸痛和一侧无力？", "safety", COMMON_OPTIONS.safety),
    question("dizziness-kind", "这次更像哪一种感觉？", "kind", [
      { id: "kind-spinning", label: "周围在转", facts: { kind: "旋转感" }, patterns: [/天旋地转/, /周围在转/, /旋转/] },
      { id: "kind-standing", label: "站起时发晕", facts: { kind: "站起时发晕" }, patterns: [/站起/, /起身/, /起来时/] },
      { id: "kind-unsteady", label: "走路发飘或不稳", facts: { kind: "走路不稳" }, patterns: [/走路/, /发飘/, /不稳/, /打晃/] },
      { id: "kind-unclear", label: "说不清", facts: { kindUnknown: true }, patterns: [/说不清/, /不知道/] },
    ]),
    question("dizziness-timing", "这种感觉是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("dizziness-impact", "现在对站立和走动有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("dizziness-context", "通常在什么情况下更明显？", "context", COMMON_OPTIONS.context),
  ],
  chest_discomfort: [
    question("chest-safety", "胸部不适是否持续或加重，并伴出汗、头晕或呼吸困难？", "safety", COMMON_OPTIONS.safety),
    question("chest-timing", "这次胸部不适是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("chest-impact", "现在对活动或休息有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("chest-context", "活动时是否更明显？", "context", COMMON_OPTIONS.context),
    question("chest-actions", "您已经做过哪些处理？", "actions", COMMON_OPTIONS.actions),
  ],
  breathing: [
    question("breathing-safety", "现在是否喘得明显、说话困难，或症状还在加重？", "safety", COMMON_OPTIONS.safety),
    question("breathing-timing", "呼吸不畅是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("breathing-impact", "现在对走动或说话有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("breathing-context", "通常在活动、平躺还是其他情况下更明显？", "context", COMMON_OPTIONS.context),
    question("breathing-actions", "您已经做过哪些处理？", "actions", COMMON_OPTIONS.actions),
  ],
  abdominal: [
    question("abdominal-safety", "腹部不适是否剧烈或持续加重，并伴反复呕吐、出血或无法进食饮水？", "safety", COMMON_OPTIONS.safety),
    question("abdominal-timing", "腹部不适是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("abdominal-impact", "现在对吃饭、喝水或走动有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("abdominal-context", "和进食或排便是否有明显关系？", "context", COMMON_OPTIONS.context),
    question("abdominal-actions", "您已经做过哪些处理？", "actions", COMMON_OPTIONS.actions),
  ],
  limb_pain: [
    question("limb-safety", "疼痛部位是否有明显外伤、变形、红肿发热，或完全不能用力？", "safety", COMMON_OPTIONS.safety),
    question("limb-timing", "疼痛是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("limb-impact", "现在对走路或日常活动有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("limb-context", "活动后会更明显，还是以前也出现过？", "context", COMMON_OPTIONS.context),
    question("limb-actions", "您已经做过哪些处理？", "actions", COMMON_OPTIONS.actions),
  ],
  fatigue: [
    question("fatigue-safety", "乏力是否突然明显加重，并伴胸痛、呼吸困难、意识变化或一侧无力？", "safety", COMMON_OPTIONS.safety),
    question("fatigue-timing", "乏力是什么时候开始的？", "timing", COMMON_OPTIONS.timing),
    question("fatigue-impact", "现在对走动、吃饭或日常活动有多大影响？", "impact", COMMON_OPTIONS.impact),
    question("fatigue-context", "近期睡眠、进食或活动有没有明显变化？", "context", COMMON_OPTIONS.context),
    question("fatigue-actions", "您已经做过哪些处理？", "actions", COMMON_OPTIONS.actions),
  ],
};

function question(id, text, field, options) {
  return { id, text, field, options };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[，。！？、；：,.!?;:\s]/g, "");
}

function inputPayload(input) {
  return typeof input === "string"
    ? { text: input, optionId: null, questionId: null }
    : { text: String(input?.text || ""), optionId: input?.optionId || input?.answerId || null, questionId: input?.questionId || null };
}

function isNegatedAt(text, index) {
  const before = text.slice(Math.max(0, index - 8), index);
  return /(没有|没|并无|并没有|不是|不|未见|否认)(什么|怎么|明显)?$/.test(before);
}

function extractSymptomMentions(value) {
  const text = normalize(value);
  const hits = [];
  for (const symptom of SYMPTOMS) {
    for (const pattern of symptom.patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        if (!isNegatedAt(text, match.index)) hits.push({ ...symptom, index: match.index });
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    }
  }
  return [...new Map(hits.sort((a, b) => a.index - b.index).map((item) => [item.id, item])).values()];
}

export function detectSymptomIntent(value) {
  const text = normalize(value);
  const symptoms = extractSymptomMentions(text);
  if (!symptoms.length) {
    return { matched: false, route: "legacy", domainHint: SLEEP_ONLY_PATTERN.test(text) ? "sleep" : null, symptoms: [] };
  }
  return {
    matched: true,
    route: "symptom",
    primary: symptoms[0].id,
    domain: symptoms[0].domain,
    symptoms: symptoms.map(({ id, label, domain }) => ({ id, label, domain })),
  };
}

function hasAffirmedSafetyPhrase(text, rule) {
  if (!rule.pattern.test(text)) return false;
  const match = text.match(rule.pattern);
  return Boolean(match && !isNegatedAt(text, match.index || 0));
}

export function detectSymptomSafetySignal(value) {
  const text = normalize(value);
  if (!text) return null;
  const rule = SAFETY_RULES.find((item) => hasAffirmedSafetyPhrase(text, item));
  if (!rule) return null;
  return {
    id: rule.id,
    action: "immediate",
    level: "attention",
    message: "请立即停止当前问答并立即就医；不要自行驾车，也不要继续等待测评结果。",
  };
}

function publicQuestion(item) {
  if (!item) return null;
  return {
    id: item.id,
    text: item.text,
    allowVoice: true,
    allowSkip: true,
    options: item.options.slice(0, 4).map(({ id, label }) => ({ id, label })),
  };
}

function withCurrentQuestion(state, item, message) {
  const asked = state.asked.includes(item.id) ? state.asked : [...state.asked, item.id];
  const current = publicQuestion(item);
  return {
    ...state,
    type: "question",
    status: "collecting",
    complete: false,
    asked,
    currentQuestionId: item.id,
    question: current,
    options: current.options,
    message: message || `我了解了。${item.text}`,
    progress: { asked: state.turnCount, maximum: MAX_KEY_QUESTIONS },
  };
}

function safetyState(base, signal) {
  return {
    ...base,
    handled: true,
    active: false,
    type: "safety",
    status: "stopped",
    complete: true,
    question: null,
    options: [],
    safetySignal: signal,
    safetyAction: signal.action,
    resultLevel: "attention",
    result: {
      level: "attention",
      summary: signal.message,
      actions: [],
      monitoring: [],
      medicalGuidance: [signal.message],
      missingFacts: [],
    },
    message: signal.message,
  };
}

function mergeUniqueSymptoms(existing, additions) {
  return [...new Map([...existing, ...additions].map((item) => [item.id, item])).values()];
}

function extractGeneralFacts(value) {
  const text = normalize(value);
  const facts = {};
  if (/(没有这些情况|都没有|一个也没有|无上述|没有上述)/.test(text)) Object.assign(facts, { safetyChecked: true, safetyCleared: true });
  if (/(今天|刚刚|刚才|才开始)/.test(text)) facts.timing = "今天或刚刚开始";
  else if (/([一二三四五六七八九十两\d]+天|好几天|这几天)/.test(text)) facts.timing = "已经几天";
  else if (/(反复|经常|老是|一阵一阵|[一二三四五六七八九十两\d]+(周|个月|月))/.test(text)) facts.timing = "反复一段时间";
  if (/(完全不影响|不影响|还能正常|不耽误)/.test(text)) Object.assign(facts, { impact: "不影响日常活动", impactLevel: "light" });
  else if (/(明显影响|不能活动|动不了|影响睡觉|吃不下|很严重)/.test(text)) Object.assign(facts, { impact: "明显影响活动或休息", impactLevel: "heavy" });
  else if (/(有点影响|有些影响|还能活动|忍得住)/.test(text)) Object.assign(facts, { impact: "有些影响", impactLevel: "moderate" });
  if (/(以前也|之前也|老毛病|不是第一次)/.test(text)) facts.context = "以前出现过";
  if (/(没处理|什么也没做|还没管)/.test(text)) facts.actionsTried = "尚未处理";
  return facts;
}

function changedFacts(previous, additions) {
  return Object.entries(additions).some(([key, value]) => previous[key] !== value);
}

function findQuestion(state) {
  return (QUESTION_BANKS[state.symptom] || []).find((item) => item.id === state.currentQuestionId) || null;
}

function matchOption(item, payload) {
  if (!item) return null;
  if (payload.optionId) return item.options.find((option) => option.id === payload.optionId) || null;
  const text = normalize(payload.text);
  return item.options.find((option) => option.patterns?.some((pattern) => pattern.test(text))) || null;
}

function fieldKnown(state, item) {
  const facts = state.confirmedFacts;
  if (item.field === "safety") return Boolean(facts.safetyChecked);
  return Object.prototype.hasOwnProperty.call(facts, item.field)
    || Object.prototype.hasOwnProperty.call(facts, `${item.field}Unknown`);
}

function nextQuestion(state) {
  return (QUESTION_BANKS[state.symptom] || []).find((item) => !fieldKnown(state, item) && !state.answeredQuestions.includes(item.id)) || null;
}

function informationSufficient(state) {
  const facts = state.confirmedFacts;
  const safetyKnown = facts.safetyCleared || facts.safetyUnknown;
  const coreKnown = (facts.timing || facts.timingUnknown) && (facts.impact || facts.impactUnknown);
  const contextKnown = facts.context || facts.contextUnknown || facts.actionsTried || facts.actionsUnknown;
  return Boolean(safetyKnown && coreKnown && contextKnown && state.turnCount >= 3);
}

function resultLevel(state) {
  const facts = state.confirmedFacts;
  if (!facts.safetyCleared || facts.safetyUnknown || facts.impactLevel === "heavy" || facts.timing === "反复一段时间" || state.symptoms.length > 1) return "attention";
  return "routine";
}

const LOW_RISK_ACTIONS = {
  headache: ["先在安静环境休息，避免继续劳累。", "按相同条件记录头痛时间、持续多久和影响。"],
  dizziness: ["起身和转身放慢速度，暂时避免独自走远。", "记录头晕发生时间、持续多久和当时在做什么。"],
  chest_discomfort: ["暂停费力活动，安静休息并观察变化。", "记录不适开始时间、持续多久和活动关系。"],
  breathing: ["暂停费力活动，保持舒适姿势并观察变化。", "记录呼吸不畅的时间、持续多久和活动关系。"],
  abdominal: ["暂时避免刺激性食物，少量饮水并观察耐受情况。", "记录不适部位、进食和排便变化。"],
  limb_pain: ["先减少会加重疼痛的活动，不勉强做动作。", "记录疼痛部位、活动关系和功能变化。"],
  fatigue: ["先安排短时间休息，保证规律进食和饮水。", "记录乏力时间、活动量和睡眠变化。"],
};

function buildResult(state, stopped = false) {
  const level = resultLevel(state);
  const symptomNames = state.symptoms.map((item) => item.label).join("、");
  const missingFacts = [];
  if (!state.confirmedFacts.safetyCleared) missingFacts.push("危险伴随表现是否存在");
  if (!state.confirmedFacts.timing) missingFacts.push("开始时间或变化趋势");
  if (!state.confirmedFacts.impact) missingFacts.push("对日常活动的影响");
  const actions = (LOW_RISK_ACTIONS[state.symptom] || ["先休息并记录症状变化。"]).slice(0, 2);
  const guidance = level === "attention"
    ? "如果症状持续、反复或明显影响日常活动，请尽快安排医疗评估；若突然明显加重，请停止自我管理并立即就医。"
    : "如果症状持续不缓解、反复出现或开始影响日常活动，请安排常规医疗评估。";
  const summary = `根据目前已了解的信息，主要关注${symptomNames}，本次仅做健康管理整理，不作疾病诊断。`;
  const message = [
    summary,
    `现在可以做：${actions.join("；")}`,
    "请记录：发生时间、持续时长和功能影响。",
    `何时就医：${guidance}`,
    missingFacts.length ? `未确认：${missingFacts.join("、")}。` : "",
  ].filter(Boolean).join("\n");
  return {
    ...state,
    handled: true,
    active: false,
    type: "result",
    status: stopped ? "stopped" : "complete",
    complete: true,
    currentQuestionId: null,
    question: null,
    options: [],
    safetyAction: level === "attention" ? "prompt" : "observe",
    resultLevel: level,
    missingFacts,
    result: {
      level,
      summary,
      actions,
      monitoring: ["记录发生时间、持续时长和功能影响。"],
      medicalGuidance: [guidance],
      missingFacts,
    },
    message,
    progress: { asked: state.turnCount, maximum: MAX_KEY_QUESTIONS },
  };
}

function initialBase(intent) {
  const primary = intent.symptoms[0];
  return {
    schemaVersion: 1,
    handled: true,
    active: true,
    route: "symptom",
    intent: "symptom",
    type: "question",
    status: "collecting",
    domain: primary.domain,
    symptom: primary.id,
    symptomLabel: primary.label,
    symptoms: intent.symptoms,
    asked: [],
    answeredQuestions: [],
    turnCount: 0,
    clarificationCount: 0,
    noInfoCount: 0,
    complete: false,
    currentQuestionId: null,
    question: null,
    options: [],
    confirmedFacts: {},
    missingFacts: [],
    processedInputs: [],
    safetySignal: null,
    safetyAction: "observe",
    resultLevel: null,
    result: null,
    source: "local",
    progress: { asked: 0, maximum: MAX_KEY_QUESTIONS },
    message: "",
  };
}

export function startSymptomConversation(input) {
  const payload = inputPayload(input);
  const safetySignal = detectSymptomSafetySignal(payload.text);
  const intent = detectSymptomIntent(payload.text);
  if (!intent.matched && !safetySignal) {
    return { handled: false, active: false, route: "legacy", domainHint: intent.domainHint, complete: false, source: "local" };
  }

  const safeIntent = intent.matched
    ? intent
    : { symptoms: [{ id: "headache", label: "当前不适", domain: "symptom" }] };
  let state = initialBase(safeIntent);
  if (safetySignal) return safetyState(state, safetySignal);

  state = {
    ...state,
    confirmedFacts: extractGeneralFacts(payload.text),
    processedInputs: normalize(payload.text) ? [normalize(payload.text)] : [],
  };
  const item = nextQuestion(state);
  return item
    ? withCurrentQuestion(state, item, `我听到了，您主要提到${state.symptoms.map((symptom) => symptom.label).join("和")}。${item.text}`)
    : buildResult(state);
}

export function advanceSymptomConversation(previousState, input) {
  if (!previousState?.handled || previousState.complete) return previousState;
  const state = structuredClone(previousState);
  const payload = inputPayload(input);
  const text = normalize(payload.text);
  const fingerprint = payload.optionId ? `option:${payload.optionId}` : text;

  if (payload.questionId && payload.questionId !== state.currentQuestionId) {
    return { ...state, duplicate: true, message: `这一题已经记录。${state.question?.text || ""}` };
  }

  const safetySignal = detectSymptomSafetySignal(payload.text);
  if (safetySignal) return safetyState(state, safetySignal);
  if (STOP_PATTERN.test(text)) return buildResult(state, true);

  if (fingerprint && state.processedInputs.includes(fingerprint)) {
    return { ...state, duplicate: true, message: `我已经记下这项信息了。${state.question?.text || ""}` };
  }

  const item = findQuestion(state);
  const option = matchOption(item, payload);
  if (option?.danger) {
    return safetyState(state, {
      id: `${state.symptom}-reported-danger`,
      action: "immediate",
      level: "attention",
      message: "请立即停止当前问答并立即就医；不要自行驾车，也不要继续等待测评结果。",
    });
  }

  const mentioned = detectSymptomIntent(payload.text);
  const symptoms = mentioned.matched ? mergeUniqueSymptoms(state.symptoms, mentioned.symptoms) : state.symptoms;
  const generalFacts = extractGeneralFacts(payload.text);
  const optionFacts = option?.facts || {};
  const additions = { ...generalFacts, ...optionFacts };
  const hasNewInformation = Boolean(option) || changedFacts(state.confirmedFacts, additions) || symptoms.length > state.symptoms.length;

  if (!hasNewInformation) {
    const noInfoCount = state.noInfoCount + 1;
    const clarificationCount = state.clarificationCount + 1;
    const stalled = {
      ...state,
      noInfoCount,
      clarificationCount,
      processedInputs: fingerprint ? [...state.processedInputs, fingerprint] : state.processedInputs,
      duplicate: false,
      message: `我还没有听清这一点，您可以直接点选。${state.question?.text || ""}`,
    };
    return noInfoCount >= MAX_EMPTY_ANSWERS ? buildResult(stalled, true) : stalled;
  }

  const mergedFacts = { ...state.confirmedFacts, ...additions };
  const answeredCurrent = Boolean(option) || (item ? !fieldKnown(state, item) && fieldKnown({ ...state, confirmedFacts: mergedFacts }, item) : false);
  if (!answeredCurrent) {
    return {
      ...state,
      symptoms,
      confirmedFacts: mergedFacts,
      noInfoCount: 0,
      processedInputs: fingerprint ? [...state.processedInputs, fingerprint] : state.processedInputs,
      duplicate: false,
      message: `我也记下了您补充的情况。${state.question?.text || ""}`,
    };
  }

  const answeredQuestions = item && !state.answeredQuestions.includes(item.id)
    ? [...state.answeredQuestions, item.id]
    : state.answeredQuestions;
  const advanced = {
    ...state,
    symptoms,
    confirmedFacts: mergedFacts,
    answeredQuestions,
    turnCount: state.turnCount + 1,
    noInfoCount: 0,
    processedInputs: fingerprint ? [...state.processedInputs, fingerprint] : state.processedInputs,
    duplicate: false,
  };

  if (advanced.turnCount >= MAX_KEY_QUESTIONS || informationSufficient(advanced)) return buildResult(advanced);
  const next = nextQuestion(advanced);
  return next ? withCurrentQuestion(advanced, next) : buildResult(advanced);
}

export function resetSymptomConversation() {
  return null;
}

export function serializeSymptomConversation(state) {
  return state == null ? "null" : JSON.stringify(state);
}

export function deserializeSymptomConversation(serialized) {
  if (!serialized) return null;
  const state = JSON.parse(serialized);
  if (state == null) return null;
  if (state.schemaVersion !== 1 || state.route !== "symptom") throw new Error("无效的症状问答状态");
  return state;
}

export const start = startSymptomConversation;
export const advance = advanceSymptomConversation;
export const reset = resetSymptomConversation;
export const serialize = serializeSymptomConversation;
