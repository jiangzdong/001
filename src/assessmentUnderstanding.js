const SAFETY_PATTERNS = [
  { type: "chest", pattern: /(胸口|胸部).{0,5}(剧烈|压榨|疼|痛)|胸痛/ },
  { type: "breathing", pattern: /(喘不上气|呼吸.{0,3}(困难|不了)|严重气短)/ },
  { type: "consciousness", pattern: /(昏迷|叫不醒|意识.{0,3}(不清|模糊|混乱))/ },
  { type: "bleeding", pattern: /(大量|不停).{0,4}(出血|流血)/ },
  { type: "neurological", pattern: /(突然).{0,8}(嘴歪|说不清话|一侧无力|手脚麻木)/ },
  { type: "fall-head", pattern: /(摔|跌倒).{0,8}(撞到头|头部受伤|昏过去)/ },
  { type: "fall-function-loss", pattern: /(摔|跌倒).{0,10}(不能站|站不起来|无法站|不能走|走不了|动不了)/ },
  { type: "hypoglycemia", pattern: /(低血糖).{0,8}(昏迷|抽搐|意识不清)/ },
];

const RULES = {
  sleep: [
    { optionId: "sleep-good", patterns: [/(一觉到天亮|睡得很香|睡得挺好|睡眠很好|休息得好)/], confidence: .96 },
    { optionId: "sleep-average", patterns: [/(凑合|一般般|还行|马马虎虎|时好时坏|偶尔.{0,3}(醒|睡不着))/], confidence: .9 },
    { optionId: "sleep-poor", patterns: [/(半夜.{0,3}(老醒|总醒|常醒)|老是醒|经常醒|醒很多次|失眠|睡不着|入睡困难|早醒|睡得很差|整夜没睡)/], confidence: .97 },
  ],
  appetite: [
    { optionId: "appetite-good", patterns: [/(胃口|食欲).{0,3}(很好|挺好|不错)|吃得香/], confidence: .96 },
    { optionId: "appetite-average", patterns: [/(和平时一样|没什么变化|差不多|一般|还行|凑合)/], confidence: .91 },
    { optionId: "appetite-poor", patterns: [/(胃口|食欲).{0,4}(变差|不好|下降)|吃不下|不想吃|没胃口/], confidence: .97 },
  ],
  activity: [
    { optionId: "activity-daily", patterns: [/(每天|天天|几乎每天|一周[六七7]天).{0,5}(走|活动|锻炼|散步|做操|家务)?/], confidence: .96 },
    { optionId: "activity-weekly", patterns: [/(每周|一星期|一周).{0,4}([二两三2-3]次|两三回)|隔天.{0,3}(活动|走|锻炼)/], confidence: .95 },
    { optionId: "activity-rare", patterns: [/(基本|几乎|平时)?没怎么(动|活动|锻炼|出门)|很少(活动|运动|出门)|不(活动|运动|锻炼)|一个星期(一次都)?没有/], confidence: .97 },
  ],
  medicine: [
    { optionId: "medicine-on-time", patterns: [/(一次都没(忘|漏)|从来(没有|没)(忘|漏)|基本不(忘|漏)|一直按时|都按时|没忘过|不会忘)/], confidence: .98 },
    { optionId: "medicine-occasional", patterns: [/(偶尔|有时候|有时).{0,4}(忘|漏)|忘过(一两|一二|1|2)次/], confidence: .95 },
    { optionId: "medicine-often", patterns: [/(经常|总是|老是|常常).{0,4}(忘|漏)|好多次.{0,3}(忘|漏)/], confidence: .97 },
  ],
  mood: [
    { optionId: "mood-stable", patterns: [/(心情|情绪).{0,3}(挺好|很好|平稳|轻松|不错)|挺开心|很平静/], confidence: .95 },
    { optionId: "mood-sometimes-low", patterns: [/(偶尔|有时|有时候).{0,5}(低落|难过|烦|不开心)|有一点.{0,3}(低落|难过)/], confidence: .95 },
    { optionId: "mood-often-low", patterns: [/(经常|总是|老是|天天).{0,5}(低落|难过|不开心|提不起精神)|心情很差/], confidence: .97 },
  ],
  walking: [
    { optionId: "walking-none", patterns: [/(一点也不|完全不|从来不|没有|不会).{0,5}(不稳|晃|站不稳)|走路.{0,3}(很稳|挺稳)/], confidence: .98 },
    { optionId: "walking-occasional", patterns: [/(偶尔|有时|有时候).{0,5}(不稳|晃|打晃)/], confidence: .95 },
    { optionId: "walking-often", patterns: [/(经常|总是|老是|常常).{0,5}(不稳|晃|站不稳)|走路很不稳/], confidence: .97 },
  ],
  fall: [
    { optionId: "fall-none", patterns: [/(一次都没(摔|跌倒)|从来(没有|没)(摔|跌倒)|没有(摔|跌倒)过|没(摔|跌倒)过|零次)/], confidence: .99 },
    { optionId: "fall-once", patterns: [/(摔|跌倒)(过)?(一|1)次|有过一次|就一次/], confidence: .98 },
    { optionId: "fall-multiple", patterns: [/(摔|跌倒)(过)?([二两三四五六七八九2-9]|好几|多)次|不止一次|多次/], confidence: .98 },
  ],
  selfRating: [
    { optionId: "self-good", patterns: [/(身体|健康).{0,3}(很好|挺好|不错)|我很好|挺健康/], confidence: .95 },
    { optionId: "self-average", patterns: [/(还可以|还行|一般|凑合|马马虎虎|说得过去)/], confidence: .91 },
    { optionId: "self-attention", patterns: [/(需要|得|要).{0,3}(多关注|注意)|不太好|比较差|毛病不少/], confidence: .95 },
  ],
};

const AMBIGUOUS = /(说不好|不确定|不好说|有时候吧|差不多吧|记不清|不知道)/;

export function normalizeAssessmentText(value) {
  return String(value || "").trim().toLowerCase().replace(/[，。！？、；：,.!?;:\s]/g, "");
}

export function detectSafetySignal(text) {
  const normalized = normalizeAssessmentText(text);
  if (/(没有胸痛|没胸痛|胸口不痛|呼吸不困难|没有呼吸困难|意识清楚|没有出血)/.test(normalized)) return null;
  const match = SAFETY_PATTERNS.find((item) => item.pattern.test(normalized));
  return match ? { type: match.type, message: "检测到需要优先关注的安全信号，本题暂不记录。请先停止测评，并按您已有的医疗联系安排处理。" } : null;
}

function candidate(option, confidence) {
  return { answerId: option.id, answerOption: option.label, confidence };
}

export function validateInterpretation(result, question) {
  if (!result || typeof result !== "object") return null;
  const safetySignal = result.safetySignal && typeof result.safetySignal === "object"
    ? { type: String(result.safetySignal.type || "safety"), message: "检测到需要优先关注的安全信号，本题暂不记录。请先停止测评，并按您已有的医疗联系安排处理。" }
    : null;
  const validOptions = new Map(question.options.map((option) => [option.id, option]));
  const candidates = (Array.isArray(result.candidates) ? result.candidates : [])
    .map((item) => {
      const option = validOptions.get(item?.answerId);
      return option ? candidate(option, Math.max(0, Math.min(1, Number(item.confidence) || 0))) : null;
    }).filter(Boolean).sort((a, b) => b.confidence - a.confidence).slice(0, 2);
  const answer = validOptions.get(result.answerId || result.answerOption);
  const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
  return {
    answerId: answer?.id || candidates[0]?.answerId || null,
    answerOption: answer?.label || candidates[0]?.answerOption || null,
    confidence,
    needsClarification: Boolean(result.needsClarification) || !answer || confidence < .78,
    candidates,
    clarificationPrompt: String(result.clarificationPrompt || "请再说具体一点，或点击最接近的选项。"),
    safetySignal,
    source: result.source === "ai" ? "ai" : "local",
    rationale: String(result.rationale || ""),
  };
}

export function localInterpretAssessment({ question, text, clarificationAttempt = 0 }) {
  const safetySignal = detectSafetySignal(text);
  if (safetySignal) return { answerId: null, answerOption: null, confidence: 1, needsClarification: false, candidates: [], safetySignal, source: "local", rationale: "本地安全信号优先" };
  const normalized = normalizeAssessmentText(text);
  const exact = question.options.find((option) => normalizeAssessmentText(option.label) === normalized);
  if (exact) return { ...candidate(exact, .99), needsClarification: false, candidates: [candidate(exact, .99)], safetySignal: null, source: "local", rationale: "与可选答案一致" };

  const matches = (RULES[question.id] || []).flatMap((rule) => rule.patterns.some((pattern) => pattern.test(normalized)) ? [{ ...rule }] : []);
  const ranked = matches.sort((a, b) => b.confidence - a.confidence).map((item) => candidate(question.options.find((option) => option.id === item.optionId), item.confidence));
  const unique = [...new Map(ranked.filter((item) => item.answerId).map((item) => [item.answerId, item])).values()].slice(0, 2);
  if (unique.length === 1 && !AMBIGUOUS.test(normalized)) return { ...unique[0], needsClarification: false, candidates: unique, safetySignal: null, source: "local", rationale: "口语语义规则命中" };

  const fallbackCandidates = unique.length ? unique : question.options.slice(0, 2).map((option) => candidate(option, .45));
  const repeated = clarificationAttempt >= 1;
  return {
    answerId: null,
    answerOption: null,
    confidence: unique[0]?.confidence || .35,
    needsClarification: true,
    candidates: fallbackCandidates,
    clarificationPrompt: repeated ? "还是不确定也没关系，请点击最接近的一项。" : `我还不能确定您的意思。${question.title}`,
    safetySignal: null,
    source: "local",
    rationale: unique.length > 1 ? "存在多个可能答案" : "信息不足",
  };
}

export function resolveOption(question, answerId) {
  return question.options.find((option) => option.id === answerId) || null;
}
