"use strict";

// Conservative oracle for this fixed 22-question test corpus only. This is
// not a general intent router or proof of free-form language understanding.
// Low overall CER cannot excuse a corrupted health field, page, or consent.
const ORACLE_VERSION = "fixed-question-critical-terms-v1";
const TERMS = Object.freeze({
  // Standalone shortcuts shown beside the full 22-round journey use their
  // own shorter prompts and therefore need equally explicit fixed-corpus
  // assertions instead of being treated as unknown voice rounds.
  "station-service": ["助餐服务", "几点开放"],
  "member-points": ["会员积分"],
  "health-vitals": ["最新", "健康体征"],
  "health-history": ["半年", "体征记录"],
  "health-evaluations": ["健康测评"],
  services: ["服务"],
  // The dependent serviceId is bound to the first prior-list item by the
  // journey runner. The ASR transcript must still explicitly preserve that
  // first-item reference and booking requirement; no homophone fallback.
  "service-detail": ["第一项", "预约"],
  knowledge: ["服务", "使用说明"],
  activities: ["活动"],
  "activities-next": ["下一页", "活动"],
  identity: ["合成授权", "核验", "身份", "不采集真实人脸"],
  permission: ["资料", "访问权限"],
  profile: ["档案"],
  points: ["会员积分"],
  level: ["会员等级", "权益"],
  recharge: ["充值记录"],
  "recharge-next": ["下一页", "充值记录"],
  consumption: ["消费明细"],
  "consumption-next": ["消费", "上一页"],
  context: ["健康档案", "历史资料"],
  vitals: ["最新", "健康体征", "什么时候记录"],
  history: ["半年", "健康体征", "记录"],
  "history-next": ["体征记录", "下一页"],
  evaluations: ["健康测评"],
  "evaluation-latest": ["最新", "测评"],
  save: ["确认", "合成测试区保存", "证据", "测试草稿", "不作诊断"],
  "save-replay": ["合成草稿", "重新提交", "重复保存"],
});

function validateRoundTranscript(roundId, transcript) {
  const required = TERMS[roundId];
  if (!required) return { valid: false, reason: "UNKNOWN_VOICE_ROUND", missing: [] };
  // Only these documented written variants are equivalent in the fixed corpus.
  const normalized = String(transcript || "").replace(/[\s\p{P}\p{S}]/gu, "").replaceAll("第1项", "第一项").replaceAll("不做诊断", "不作诊断");
  const missing = required.filter((term) => !normalized.includes(term));
  return { valid: !missing.length, reason: missing.length ? "CRITICAL_SPEECH_TERMS_MISMATCH" : null, missing, oracle: ORACLE_VERSION };
}

module.exports = { ORACLE_VERSION, validateRoundTranscript };
