"use strict";

function cleanJson(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

function createDeepSeekAgent({ getKey, skillText = "", fetchImpl = globalThis.fetch, model = "deepseek-v4-flash", timeoutMs = 8000 } = {}) {
  async function complete(system, payload, signal, scenarioSkill = "") {
    const key = String(getKey?.() || "").trim();
    if (!key) throw Object.assign(new Error("请先配置 DeepSeek API 密钥"), { code: "MODEL_NOT_CONFIGURED" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("deadline"), timeoutMs);
    const onAbort = () => controller.abort(signal?.reason || "cancelled");
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          thinking: { type: "disabled" },
          temperature: 0.25,
          max_tokens: 520,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: `${system}\n\n${skillText}\n\n${scenarioSkill}` }, { role: "user", content: JSON.stringify(payload) }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error(`大模型服务响应异常（${response.status}）`), { code: "MODEL_HTTP_ERROR" });
      return cleanJson((await response.json())?.choices?.[0]?.message?.content);
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error(signal?.aborted ? "本轮已取消" : "大模型响应超时"), { code: signal?.aborted ? "CANCELLED" : "MODEL_TIMEOUT" });
      if (error instanceof SyntaxError) throw Object.assign(new Error("大模型返回格式无效"), { code: "MODEL_INVALID_OUTPUT" });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  async function planner(text, context = {}) {
    const tools = context.registry || [];
    const allowed = new Set(tools.map((item) => item.name));
    const result = await complete(
      "你是小安站点咨询顾问的意图路由器。结合最近对话识别意图，只能选择给定 MCP 工具，业务事实不可自行补写。一般症状或普通健康知识必须选择 health.general 且 tool=null，不进入健康问卷或个人健康数据流程。具体服务的时间、地点、预约规则使用详情工具，不能使用服务简表替代。个人数据默认本人，涉及他人时设置 policyInput.owner=other。输出严格 JSON：{\"intent\":\"内部意图\",\"confidence\":0.0,\"tool\":\"完整工具名或null\",\"arguments\":{},\"policyInput\":{\"owner\":\"self|other\"},\"selection\":null}。站点默认 orgId=1，当前本人默认 seniorId=1。禁止生成 subjectToken、authToken、authorizationId 或 idempotencyKey。",
      { text, scenario: context.scenario?.id, recentTurns: context.memory?.turns?.slice(-6) || [], tools },
      context.signal,
      context.scenarioSkill,
    );
    const tool = allowed.has(result.tool) ? result.tool : null;
    if (result.tool && !tool) throw Object.assign(new Error("大模型选择了未注册工具"), { code: "MODEL_TOOL_NOT_ALLOWED" });
    return {
      intent: String(result.intent || "unknown").slice(0, 120),
      confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
      tool,
      arguments: result.arguments && typeof result.arguments === "object" ? result.arguments : {},
      policyInput: result.policyInput && typeof result.policyInput === "object" ? result.policyInput : {},
      selection: result.selection == null ? null : String(result.selection).slice(0, 120),
    };
  }

  async function composer(plan, data, context = {}) {
    const result = await complete(
      "你是小安，面向长者回答站点咨询。回答必须先自然回应用户问法，再完整检查 MCP 结果及其 items 等嵌套字段，只依据这些事实作答；已有时间、地点或预约信息时必须直接回答，确实缺失才说明未查到。一般症状咨询要先承认不适并询问开始时间、严重程度及急症红旗；不得诊断、开药或承诺疗效，出现突然剧烈头痛、意识异常、言语困难、单侧无力、视力异常、高热颈硬、反复呕吐或头部外伤时，应建议立即就近急诊或拨打当地急救电话。严禁编造时间、地点、权益、个人指标或健康结论。语气温和、有变化，不使用“我已记下您的问题”等机械套话。正文不超过180个汉字，不输出内部工具名、策略或思考。suggestions 只可从 station-service-list、station-service-detail、station-activity-list、station-activity-detail、member-points、member-level 中选择；不适合追问时返回空数组。不得生成联系工作人员、人工转接、查询对接指引或任何清单外入口。输出严格 JSON：{\"title\":\"不超过20字\",\"speechText\":\"最终回答\",\"suggestions\":[{\"id\":\"上述允许ID之一\"}]}，建议最多3条。",
      { userQuestion: context.text, intent: plan.intent, toolFacts: data, recentTurns: context.memory?.turns?.slice(-4) || [] },
      context.signal,
      context.scenarioSkill,
    );
    return {
      title: String(result.title || "站点咨询").trim().slice(0, 20),
      speechText: String(result.speechText || "").trim().slice(0, 180),
      suggestions: (Array.isArray(result.suggestions) ? result.suggestions : []).slice(0, 3).map((item) => ({ id: String(item?.id || "").trim().slice(0, 40) })).filter((item) => item.id),
    };
  }

  return { planner, composer };
}

module.exports = { createDeepSeekAgent };
