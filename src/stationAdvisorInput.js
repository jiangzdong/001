export const advisorAutoSendDelayMs = 0;
export const advisorConfidenceFloor = 0.72;
export const advisorTrustedOfflineAsrProvider = "sherpa-onnx-sensevoice-local";

export function normalizeAdvisorQuery(value) {
  return String(value || "").replace(/[，。！？、,.!?\s]/g, "").trim();
}

export function resolveAdvisorIntent(value) {
  const query = normalizeAdvisorQuery(value);
  if (!query) return "";
  if (/(积分|余额|会员|账户|账号|本人信息)/.test(query)) return "points";
  if (/(活动|八段锦|讲堂|手工|兴趣小组|报名)/.test(query)) return "activities";
  if (/(服务|助餐|康复|预约|可以做什么|能做什么)/.test(query)) return "services";
  return "generic";
}

export function isSensitiveAdvisorQuery(value) {
  return resolveAdvisorIntent(value) === "points";
}

export function getAdvisorSubmissionPolicy({ text, confidence, provider, trustedFinal } = {}) {
  if (!normalizeAdvisorQuery(text)) return { mode: "blocked", reason: "empty" };
  return { mode: "auto", reason: "recognized-final", delayMs: advisorAutoSendDelayMs };
}

export function canAutoSubmitAdvisor({ ticket, current } = {}) {
  if (!ticket || !current) return false;
  return ticket.countdownId === current.countdownId
    && ticket.operationId === current.operationId
    && ticket.draftRevision === current.draftRevision
    && normalizeAdvisorQuery(ticket.text) === normalizeAdvisorQuery(current.text)
    && current.voiceState === "countdown"
    && ["home", "conversation"].includes(current.screen)
    && current.showExit !== true;
}
