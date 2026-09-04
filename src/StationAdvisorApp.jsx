import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  CalendarDots,
  Check,
  CheckCircle,
  Coins,
  DotsThree,
  FaceMask,
  Flask,
  GearSix,
  HouseLine,
  Info,
  Keyboard,
  ListBullets,
  LockKey,
  Microphone,
  PersonSimpleCircle,
  ShieldCheck,
  SignOut,
  SpeakerHigh,
  SpeakerSlash,
  TextAa,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { recordSpeech } from "./speechRecorder.js";
import { AdvisorChineseKeyboard } from "./AdvisorChineseKeyboard.jsx";
import { isMemberAuthorizationRequired, resolveAdvisorIntent } from "./stationAdvisorInput.js";
import { advisorInteractionRetryDelayMs } from "./stationAdvisorInteraction.js";
import { StationAdvisorDigitalHuman } from "./StationAdvisorDigitalHuman.jsx";
import { useStationAdvisorSpeech } from "./useStationAdvisorSpeech.js";
import { VirtualSeniorTestConsole } from "./VirtualSeniorTestConsole.jsx";

const appVersion = `V${__APP_VERSION__}`;

const defaultQuestions = [
  { id: "activities", icon: CalendarDots, label: "今天站点有什么活动？", shortLabel: "今日活动" },
  { id: "services", icon: Buildings, label: "站点可以提供哪些服务？", shortLabel: "站点服务" },
  { id: "points", icon: Coins, label: "帮我查一下会员积分", shortLabel: "会员积分" },
];

// The model may recommend a next question, but it must not invent a visible
// business entry. These are the only user-facing routes backed by the current
// 5-MCP / 16-tool contract. Tool names themselves stay internal to the agent.
const approvedSuggestionCatalog = Object.freeze({
  "station-service-list": { id: "services", label: "站点服务", question: "站点可以提供哪些服务？" },
  "station-service-detail": { id: "services", label: "服务详情", question: "请介绍站点服务的时间、地点和预约要求" },
  "station-activity-list": { id: "activities", label: "近期活动", question: "今天站点有什么活动？" },
  "station-activity-detail": { id: "activities", label: "活动详情", question: "请介绍近期活动的内容和安排" },
  "member-points": { id: "points", label: "会员积分", question: "帮我查询会员积分" },
  "member-level": { id: "points", label: "会员等级", question: "帮我查询会员等级" },
});

const legacySuggestionAliases = Object.freeze({
  activities: "station-activity-list",
  services: "station-service-list",
  points: "member-points",
});

function approvedSuggestions(candidates) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : []).flatMap((candidate) => {
    const rawId = String(candidate?.id || "").trim();
    const capability = approvedSuggestionCatalog[legacySuggestionAliases[rawId] || rawId];
    if (!capability || seen.has(capability.id)) return [];
    seen.add(capability.id);
    return [capability];
  }).slice(0, 3);
}

const responses = {
  activities: {
    title: "查询站点活动",
    body: "我可以帮您查询活动安排。当前还没有接入站点正式活动数据，因此不能确认具体时间和地点。",
    meta: "站点咨询顾问",
    followups: ["八段锦在哪里参加？", "健康讲堂讲什么？", "还有哪些长期活动？"],
    agents: [{ id: "activities", label: "活动报名" }, { id: "activities", label: "活动日历" }, { id: "services", label: "站点服务" }],
  },
  services: {
    title: "查询站点服务",
    body: "我可以帮您查询服务信息。当前还没有接入站点正式业务数据，因此不能确认服务时间、地点或预约要求。",
    meta: "站点咨询顾问",
    followups: ["怎么报名活动？", "助餐服务几点开始？", "康复训练怎么预约？"],
    agents: [{ id: "services", label: "助餐服务" }, { id: "services", label: "康复预约" }, { id: "activities", label: "活动报名" }],
  },
  points: {
    title: "我听到您想查询会员积分",
    body: "积分和余额属于本人信息。我先为您进入安全查询流程，确认身份后即可查看当前积分与明细。",
    meta: "会员服务智能体",
    agents: [{ id: "points", label: "积分明细" }, { id: "points", label: "会员余额" }],
  },
  generic: {
    title: "我来帮您确认",
    body: "这个问题暂时没有查到已发布的站点资料。您可以换一种说法，或选择相关问题继续查询。",
    meta: "站点咨询顾问",
    followups: ["今天站点有什么活动？", "站点可以提供哪些服务？", "帮我查一下会员积分"],
    agents: [{ id: "activities", label: "活动服务" }, { id: "services", label: "站点服务" }, { id: "points", label: "会员积分" }],
  },
};

const personalHealthAuthorizationResponse = {
  title: "需要先确认身份",
  body: "这项请求涉及您的个人健康数据，需要先确认身份。普通健康咨询不需要读取个人资料，您也可以直接描述哪里不舒服。",
  meta: "健康管理智能体",
  followups: [],
  agents: [],
};

function responseFromHarness(result, fallback) {
  if (!result?.ok || result.status !== "completed" || !result.answer?.speechText) {
    const errorCode = result?.error?.code || "AGENT_UNAVAILABLE";
    return {
      title: "暂时没能完成查询",
      body: errorCode === "MODEL_NOT_CONFIGURED"
        ? "大模型尚未连接，请联系管理员完成配置后再试。"
        : errorCode === "DATA_NOT_CONFIGURED" || errorCode === "MCP_SERVER_NOT_CONFIGURED"
          ? "正式业务数据还没有接入，我不能替您猜测时间、地点或预约要求。请在业务系统配置完成后再查询。"
          : "这次查询没有成功，您可以稍后再试，或换一种说法。",
      meta: "站点咨询顾问",
      followups: [],
      agents: [],
      errorCode,
    };
  }
  const titles = {
    "station.service.schedule": "服务详情",
    "station.activity.detail": result.data?.title || "活动详情",
    "member.points.self": "会员积分",
    "member.balance.self": "会员余额",
  };
  const agentMeta = result.intent === "health.general"
    ? "健康管理智能体"
    : String(result.intent || "").startsWith("member.")
      ? "会员服务智能体"
      : "站点业务智能体";
  return {
    title: result.answer.title || titles[result.intent] || "站点咨询结果",
    body: result.answer.speechText,
    meta: agentMeta,
    followups: [],
    agents: approvedSuggestions(result.answer.suggestions?.length ? result.answer.suggestions : fallback?.agents),
  };
}

async function isLocalSpeechApiReady() {
  if (window.kioskBridge || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const response = await fetch("/api/speech/status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return false;
    const status = await response.json();
    return status?.ready === true && status?.offline === true;
  } catch {
    return false;
  }
}

async function requestWebDeepSeek(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
    cache: "no-store",
  });
  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.includes("application/json")) throw new Error("本机网页测试服务未就绪");
  const result = await response.json();
  if (!response.ok || result?.ok === false) throw new Error(result?.message || "本机网页测试服务暂时不可用");
  return result;
}

function deepSeekConfigurationApi() {
  const bridge = window.kioskBridge;
  if (bridge?.deepSeekStatus && bridge?.saveDeepSeekKey && bridge?.clearDeepSeekKey) {
    return {
      status: () => bridge.deepSeekStatus(),
      save: (key) => bridge.saveDeepSeekKey(key),
      clear: () => bridge.clearDeepSeekKey(),
    };
  }
  return {
    status: () => requestWebDeepSeek("/api/deepseek/status"),
    save: (key) => requestWebDeepSeek("/api/deepseek/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }),
    clear: () => requestWebDeepSeek("/api/deepseek/clear", { method: "POST" }),
  };
}

const mcpServiceLabels = {
  health_risk_assessment_mcp: "健康风险研判",
  health_evaluation_service_mcp_cms: "健康与站点服务",
  identity_permission_mcp: "身份与权限",
  member_asset_mcp: "会员资产",
  station_content_mcp: "站点内容",
};

function mcpConfigurationApi() {
  const bridge = window.kioskBridge;
  if (!bridge?.mcpConfigStatus || !bridge?.saveMcpConfig || !bridge?.clearMcpConfig || !bridge?.testMcpConfig) return null;
  return {
    status: () => bridge.mcpConfigStatus(),
    save: (servers) => bridge.saveMcpConfig(servers),
    clear: () => bridge.clearMcpConfig(),
    test: (servers) => bridge.testMcpConfig(servers),
  };
}

function HeaderButton({ icon: Icon, label, active = false, onClick }) {
  return (
    <button className={`advisor-header-action ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      <Icon weight="bold" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function AdvisorHeader({ screen, largeText, muted, onHome, onLargeText, onMute, onSettings, onExit }) {
  return (
    <header className="advisor-header">
      <button className="advisor-brand" type="button" onClick={onHome} aria-label="返回站点咨询顾问首页">
        <span className="advisor-brand__mark"><Waveform weight="bold" /></span>
        <span><strong>站点咨询顾问</strong><small>柳州康养服务站 · {appVersion}</small></span>
      </button>
      <div className="advisor-header__actions" role="group" aria-label="常用设置">
        {screen !== "home" && <HeaderButton icon={HouseLine} label="首页" onClick={onHome} />}
        <HeaderButton icon={muted ? SpeakerSlash : SpeakerHigh} label={muted ? "静音" : "音量"} active={muted} onClick={onMute} />
        <HeaderButton icon={TextAa} label="大字" active={largeText} onClick={onLargeText} />
        <HeaderButton icon={DotsThree} label="设置" onClick={onSettings} />
        <HeaderButton icon={SignOut} label="退出" onClick={onExit} />
      </div>
    </header>
  );
}

function AvatarStage({ compact = false, home = false, listening = false, speaking = false, preparing = false, status = "小安在线", analyserRef, visemeTimelineRef, mood = "neutral" }) {
  return (
    <section className={`advisor-avatar-stage ${compact ? "is-compact" : ""} ${home ? "is-home" : ""}`} aria-label="数字人小安">
      {home && <img className="advisor-full-body-avatar" src="./assets/xiaoa-fullbody-extension-v1.0.0.png" alt="" aria-hidden="true" />}
      <StationAdvisorDigitalHuman
        speaking={speaking}
        listening={listening}
        analyserRef={analyserRef}
        visemeTimelineRef={visemeTimelineRef}
        mood={listening ? "listening" : mood}
      />
      <div className="advisor-avatar-stage__wash" />
      <div className={`advisor-presence ${listening ? "is-listening" : ""} ${speaking || preparing ? "is-speaking" : ""}`}>
        <i aria-hidden="true" />
        <span><small>{speaking || preparing ? "正在回答" : listening ? "正在聆听" : "服务状态"}</small><strong>{status}</strong></span>
      </div>
    </section>
  );
}

function AdvisorComposer({ draft, status, voiceState, keyboardMode, modelConfigured, onDraftChange, onFocus, onKeyboard, onMic, onConfigureModel, onSubmit }) {
  const inputRef = useRef(null);
  const standby = voiceState === "standby";
  const listening = voiceState === "listening";
  const recognizing = voiceState === "recognizing";
  const busy = listening || recognizing;
  const waveActive = standby || listening;
  const modelConnectionRequired = voiceState === "paused" && modelConfigured === false;
  const voiceStatus = recognizing
    ? "正在识别，请稍候"
    : listening
      ? "正在聆听，请直接说话"
      : modelConnectionRequired
        ? "大模型未连接，请先连接"
        : status;
  const activateKeyboard = () => {
    onKeyboard();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    });
  };
  return (
    <form data-testid="advisor-input-module" data-voice-state={voiceState} className={`advisor-composer state-${voiceState} ${busy ? "is-listening" : ""} ${keyboardMode ? "is-keyboard" : ""}`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {keyboardMode ? <>
        <div className="advisor-composer__field">
          <div className="advisor-composer__input-surface">
          <label className="advisor-sr-only" htmlFor="advisor-question-input">站点咨询问题</label>
          <input
            id="advisor-question-input"
            ref={inputRef}
            type="text"
            inputMode="text"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onFocus={onFocus}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent?.isComposing) return;
              event.preventDefault();
              onSubmit();
            }}
            placeholder="请输入问题"
            aria-label="站点咨询问题"
            autoComplete="off"
            enterKeyHint="send"
          />
          {draft && <button className="advisor-composer__clear" type="button" onClick={() => onDraftChange("")} aria-label="清空输入"><X weight="bold" /></button>}
          </div>
        </div>
        <button className="advisor-composer__mic" type="button" onClick={onMic} aria-label="切换到语音输入">
          <Microphone weight="fill" />
        </button>
      </> : <>
        <div className="advisor-composer__voice" role="status" aria-live="polite">
          <Waveform className={waveActive ? "is-active" : ""} weight="bold" />
          <span>{voiceStatus}</span>
        </div>
        {modelConnectionRequired ? <button className="advisor-composer__model-connect" type="button" onClick={onConfigureModel} aria-label="连接 DeepSeek">
          <LockKey weight="bold" />
          <span>连接</span>
        </button> : <button data-testid="advisor-keyboard-trigger" className="advisor-composer__keyboard" type="button" onClick={activateKeyboard} aria-label="切换到键盘输入">
          <Keyboard weight="bold" />
          <span className="advisor-sr-only">键盘</span>
        </button>}
      </>}
    </form>
  );
}

function AdvisorRecognition({ composerProps, avatarProps }) {
  const hearing = ["starting", "listening", "recognizing"].includes(composerProps.voiceState);
  const recognitionLabel = composerProps.keyboardMode
    ? "键盘输入"
    : avatarProps.speaking || avatarProps.preparing
      ? "正在回答"
      : hearing
        ? "正在识别"
          : composerProps.modelConfigured === false
            ? "需要管理员连接"
            : composerProps.autoVoiceEnabled
          ? "等待您说话"
          : "语音已暂停";
  return (
    <div className={`advisor-recognition ${hearing ? "is-active" : ""} ${composerProps.keyboardMode ? "is-keyboard" : ""}`} aria-live="polite">
      <span className="advisor-recognition__signal" aria-hidden="true"><i /></span>
      <strong>{recognitionLabel}</strong>
      {composerProps.keyboardMode
        ? <Keyboard className="advisor-recognition__wave" weight="bold" aria-hidden="true" />
        : <Waveform className="advisor-recognition__wave" weight="bold" aria-hidden="true" />}
    </div>
  );
}

function AdvisorFlowStatus({ icon: Icon, label }) {
  return (
    <div className="advisor-recognition advisor-flow-status" role="status">
      <span className="advisor-recognition__signal" aria-hidden="true"><i /></span>
      <strong>{label}</strong>
      <Icon className="advisor-recognition__wave" weight="duotone" aria-hidden="true" />
    </div>
  );
}

function HomeScreen({ onQuestion, composerProps, avatarProps, modelConfigured, onConnectModel }) {
  const hearing = ["starting", "listening", "recognizing"].includes(composerProps.voiceState);
  const homeComposerStatus = avatarProps.speaking || avatarProps.preparing
    ? "小安正在回答"
    : composerProps.voiceState === "recognizing"
      ? "正在识别"
      : hearing
        ? "请直接说话"
        : composerProps.autoVoiceEnabled
          ? "请直接说话"
          : "点击麦克风继续";
  return (
    <main className="advisor-home">
      <AvatarStage home {...avatarProps} />
      <span className="advisor-scene-flow" aria-hidden="true" />
      <section data-testid="advisor-home-bottom" className="advisor-home-panel">
        <AdvisorRecognition composerProps={composerProps} avatarProps={avatarProps} />
        <div className="advisor-greeting" role="status">
          <h1>您好，我是小安</h1>
          <p>您可以直接说出想咨询的站点服务问题</p>
          <button className="advisor-model-connect-trigger" type="button" onClick={onConnectModel}>{modelConfigured === false ? "管理员连接" : "终端管理"}</button>
        </div>
        <div data-testid="advisor-quick-question-module" className="advisor-home-questions" aria-label="常见问题">
          {defaultQuestions.map(({ id, icon: Icon, label, shortLabel }) => (
            <button type="button" key={id} onClick={() => onQuestion(id, label)} aria-label={label}>
              <span><Icon weight="duotone" /></span>
              <strong>{shortLabel}</strong>
            </button>
          ))}
        </div>
        <AdvisorComposer {...composerProps} status={homeComposerStatus} />
      </section>
    </main>
  );
}

export function ConversationScreen({ response, messages, onQuestion, composerProps, avatarProps, onConnectModel, observationStatus }) {
  const streamRef = useRef(null);
  const recognizing = ["listening", "recognizing"].includes(composerProps.voiceState);
  const liveRecognitionText = composerProps.draft || (
    composerProps.voiceState === "starting"
      ? "正在打开麦克风…"
      : composerProps.voiceState === "recognizing"
        ? "正在识别，请稍候…"
        : "正在识别，请直接说话…"
  );
  useEffect(() => {
    streamRef.current?.scrollTo?.({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveRecognitionText, recognizing]);
  return (
    <main className="advisor-conversation">
      <AvatarStage home {...avatarProps} />
      <section className="advisor-conversation-panel">
        <div ref={streamRef} className="advisor-chat-stream" aria-live="polite">
          {messages.length ? messages.map((message, index) => message.role === "user" ? (
              <article className="advisor-message advisor-message--user" key={message.id} data-observed-message-id={message.id}>
                <span>您</span>
                <p>{message.text}</p>
              </article>
            ) : (
              <article className="advisor-message advisor-message--assistant" key={message.id} data-observed-message-id={message.id}>
                <span><Waveform weight="bold" />小安 · {message.meta}</span>
                <h1>{message.title}</h1>
                <p>{message.text}</p>
                {message.errorCode === "MODEL_NOT_CONFIGURED" && <button className="advisor-model-connect-trigger advisor-model-connect-trigger--message" type="button" onClick={onConnectModel}>管理员连接 DeepSeek</button>}
                {index === messages.length - 1 && message.agents?.length > 0 && (
                  <div className="advisor-message__agents" aria-label="可用业务智能体">
                    {message.agents.map((agent) => <button type="button" key={`${agent.id}-${agent.label}`} onClick={() => onQuestion(agent.id, agent.question)}>{agent.label}<ArrowRight weight="bold" /></button>)}
                  </div>
                )}
              </article>
            )) : (
            <article className="advisor-empty-answer">
            <Microphone weight="duotone" />
            <p>{observationStatus ? "请先选择画像并开始测试，问答过程将在这里呈现。" : "点击下方按钮开始说话，或选择一个常见问题。"}</p>
          </article>
        )}
          {recognizing && (
            <article className="advisor-message advisor-message--user advisor-message--recognizing" role="status">
              <span><DotsThree className="advisor-recognizing-icon" weight="bold" />您 · 正在识别</span>
              <p>{liveRecognitionText}</p>
            </article>
          )}
        </div>
        {observationStatus ? <div className="advisor-observation-status" role="status">{observationStatus}</div> : <AdvisorComposer {...composerProps} />}
      </section>
    </main>
  );
}

function ConsentScreen({ avatarProps, onCancel, onContinue }) {
  return (
    <main className="advisor-auth-screen">
      <AvatarStage home {...avatarProps} />
      <AdvisorFlowStatus icon={ShieldCheck} label="隐私授权" />
      <section className="advisor-secondary-content advisor-secondary-content--consent">
        <section className="advisor-auth-card">
          <span className="advisor-auth-card__icon"><ShieldCheck weight="duotone" /></span>
          <p>查询本人信息</p>
          <h1>需要先确认是您本人</h1>
          <div className="advisor-auth-notice">
            <Info weight="fill" />
            <div><strong>本次演示会进行本地身份确认</strong><span>仅用于展示会员信息查询流程，不保存照片，不连接生产会员系统。您可以随时取消并返回普通咨询。</span></div>
          </div>
          <ul>
            <li><Check />只显示当前演示会员的脱敏信息</li>
            <li><Check />退出、超时或取消后立即清理身份状态</li>
            <li><Check />认证失败不会展示其他人的头像或姓名</li>
          </ul>
          <button className="advisor-auth-primary" type="button" onClick={onContinue}><FaceMask weight="bold" />同意并开始身份确认</button>
          <button className="advisor-auth-secondary" type="button" onClick={onCancel}>取消，返回普通咨询</button>
        </section>
      </section>
    </main>
  );
}

function ScanScreen({ avatarProps, onComplete, onCancel }) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 2200);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <main className="advisor-scan-screen">
      <AvatarStage home {...avatarProps} />
      <AdvisorFlowStatus icon={FaceMask} label="正在确认身份" />
      <section className="advisor-secondary-content advisor-secondary-content--scan">
        <section className="advisor-scan-frame" aria-label="本地演示身份确认">
          <div className="advisor-scan-frame__corners"><i /><i /><i /><i /></div>
          <PersonSimpleCircle weight="thin" />
          <span className="advisor-scan-line" />
        </section>
        <section className="advisor-scan-copy">
          <span>本地演示身份确认</span>
          <h1>请正对屏幕，并保持一人入镜</h1>
          <div className="advisor-scan-progress"><i /></div>
          <p>正在确认，请稍候…</p>
          <button type="button" onClick={onCancel}>取消身份确认</button>
        </section>
      </section>
    </main>
  );
}

function MemberScreen({ avatarProps, expanded, onToggleExpanded, onFinish }) {
  return (
    <main className="advisor-member-screen">
      <AvatarStage home {...avatarProps} />
      <AdvisorFlowStatus icon={CheckCircle} label="身份确认成功" />
      <section className="advisor-secondary-content advisor-secondary-content--member">
        <section className="advisor-member-head">
          <span><CheckCircle weight="fill" /></span>
          <div><p>身份确认成功</p><h1>李先生，您好</h1><small>会员号：1000****26</small></div>
        </section>
        <section className="advisor-member-summary">
          <div><span>可用积分</span><strong>2,680</strong><small>截至今日 16:20</small></div>
          <div><span>会员余额</span><strong>¥ 126.00</strong><small>仅用于站点服务</small></div>
        </section>
        <section className="advisor-member-detail">
          <header><span><ListBullets weight="bold" />积分说明</span><button type="button" onClick={onToggleExpanded}>{expanded ? "收起明细" : "查看明细"}</button></header>
          <p>您的积分来自活动签到、健康讲堂和日常任务。积分数值由本地固定演示数据提供，小安不会自行计算。</p>
          {expanded && <div className="advisor-points-list">
            <div><span><strong>健康讲堂签到</strong><small>8月28日</small></span><b>+120</b></div>
            <div><span><strong>八段锦活动</strong><small>8月26日</small></span><b>+80</b></div>
            <div><span><strong>兑换助餐优惠</strong><small>8月20日</small></span><b className="is-negative">-200</b></div>
          </div>}
        </section>
        <div className="advisor-privacy-note"><LockKey weight="fill" /><span>本页为本机演示数据。结束查询后将立即隐藏个人信息。</span></div>
        <button className="advisor-finish-query" type="button" onClick={onFinish}>结束个人查询并清除信息</button>
      </section>
    </main>
  );
}

function ExitDialog({ onClose }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (pin === "246810") {
      setError("演示退出成功。关闭弹窗后仍保留当前本机预览。");
      return;
    }
    setError("PIN 不正确，请重新输入。演示 PIN 由项目交付说明单独提供。 ");
    setPin("");
  };
  return (
    <div className="advisor-dialog-scrim" role="dialog" aria-modal="true" aria-labelledby="advisor-exit-title">
      <section className="advisor-exit-dialog">
        <button className="advisor-dialog-close" type="button" onClick={onClose} aria-label="关闭"><X weight="bold" /></button>
        <span className="advisor-exit-dialog__icon"><LockKey weight="duotone" /></span>
        <p>终端管理</p>
        <h2 id="advisor-exit-title">输入 6 位退出 PIN</h2>
        <small>退出 PIN 与机构登录密码分开管理；连续输入错误会触发限流。</small>
        <div className="advisor-pin-dots" aria-label={`已输入 ${pin.length} 位`}>{Array.from({ length: 6 }, (_, index) => <i className={index < pin.length ? "is-filled" : ""} key={index} />)}</div>
        <div className="advisor-pin-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => <button type="button" key={number} onClick={() => pin.length < 6 && setPin(`${pin}${number}`)}>{number}</button>)}
          <button type="button" onClick={() => setPin("")}>清空</button>
          <button type="button" onClick={() => pin.length < 6 && setPin(`${pin}0`)}>0</button>
          <button type="button" onClick={() => setPin(pin.slice(0, -1))}>退格</button>
        </div>
        {error && <div className={`advisor-pin-message ${error.startsWith("演示退出成功") ? "is-success" : ""}`}>{error}</div>}
        <button className="advisor-exit-submit" type="button" disabled={pin.length !== 6} onClick={submit}>确认退出</button>
      </section>
    </div>
  );
}

function DeepSeekSetupDialog({ configured, onClose, onConfigurationChange, onOpenMcp, onOpenVirtualSenior, onVirtualSeniorActivated, virtualSeniorAvailable }) {
  const keyRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [apiKey, setApiKey] = useState("");
  const [editingKey, setEditingKey] = useState(!configured);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectionComplete, setConnectionComplete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (editingKey) keyRef.current?.focus();
    return () => window.clearTimeout(closeTimerRef.current);
  }, [editingKey]);

  const save = async () => {
    const key = apiKey.trim();
    if (!key) {
      setMessage("请输入 DeepSeek API 密钥。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const api = deepSeekConfigurationApi();
      const saved = await api.save(key);
      if (!saved?.ok) throw new Error("密钥未能保存");
      const status = await api.status();
      if (!status?.configured) throw new Error("保存后未检测到连接状态");
      setApiKey("");
      onConfigurationChange(true);
      setConnectionComplete(true);
      setMessage("已连接，正在返回提问界面。");
      closeTimerRef.current = window.setTimeout(onClose, 700);
    } catch (error) {
      setMessage(error?.message || "连接失败，请检查密钥后重试。");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setMessage("再次点击“确认清除”才会移除本机密钥。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const api = deepSeekConfigurationApi();
      await api.clear();
      const status = await api.status();
      if (status?.configured) throw new Error("密钥尚未清除，请稍后重试");
      onConfigurationChange(false);
      setConnectionComplete(false);
      setConfirmClear(false);
      setMessage("本机密钥已清除。");
    } catch (error) {
      setMessage(error?.message || "清除失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  const openVirtualSenior = async () => {
    if (virtualSeniorAvailable) {
      setSaving(true);
      setMessage("正在打开测试中心。");
      try {
        const result = await window.kioskBridge?.openVirtualSeniorControl?.();
        if (result?.surface === "window") onClose();
        else onOpenVirtualSenior();
      } catch (error) {
        setMessage(error?.message || "测试中心打开失败，请重试。");
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    setMessage("正在准备隔离测试环境，请稍候。");
    try {
      const result = await window.kioskBridge?.launchVirtualSeniorTest?.();
      if (!result?.ok || !result?.enabled) throw new Error("测试模式未能启动，请重试");
      onVirtualSeniorActivated(result);
      if (result.surface === "window") onClose();
      else onOpenVirtualSenior();
    } catch (error) {
      setSaving(false);
      setMessage(error?.message || "测试模式启动失败，请重试。");
    }
  };

  return (
    <div className="advisor-dialog-scrim" role="presentation" onKeyDown={(event) => { if (event.key === "Escape" && !saving) onClose(); }}>
      <section className="advisor-exit-dialog advisor-model-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="advisor-model-setup-title" aria-describedby="advisor-model-setup-description">
        <button className="advisor-dialog-close" type="button" onClick={onClose} disabled={saving} aria-label="关闭"><X weight="bold" /></button>
        <span className="advisor-exit-dialog__icon"><LockKey weight="duotone" /></span>
        <p>终端管理</p>
        <h2 id="advisor-model-setup-title">连接 DeepSeek</h2>
        <small id="advisor-model-setup-description">密钥仅供本机使用：桌面版加密保存；网页预览仅由本机服务读取，不会写入浏览器或发布包。</small>
        {connectionComplete ? (
          <div className="advisor-model-setup-success" role="status" aria-live="polite">
            <CheckCircle weight="fill" />
            <strong>连接成功</strong>
            <span>正在返回提问界面</span>
          </div>
        ) : (
          <>
            {configured && !editingKey ? <>
              <div className="advisor-model-configured" role="status"><CheckCircle weight="fill" /><span><strong>已配置</strong><small>本机密钥已安全保存，无需再次输入</small></span></div>
              <button className="advisor-exit-submit" type="button" onClick={() => { setEditingKey(true); setMessage(""); }}>更换密钥</button>
              <button className="advisor-auth-secondary" type="button" onClick={clear} disabled={saving}>{confirmClear ? "确认清除" : "清除本机密钥"}</button>
            </> : <>
              <label className="advisor-model-key-label" htmlFor="advisor-deepseek-key">DeepSeek API 密钥</label>
              <div className="advisor-composer__input-surface advisor-model-key-field">
                <input id="advisor-deepseek-key" ref={keyRef} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck="false" disabled={saving} />
              </div>
              <button data-testid="advisor-deepseek-save" className="advisor-exit-submit" type="button" onClick={save} disabled={saving}>{saving ? "正在保存…" : configured ? "保存新密钥" : "保存并连接"}</button>
              {configured && <button className="advisor-auth-secondary" type="button" onClick={() => { setEditingKey(false); setApiKey(""); setMessage(""); }} disabled={saving}>取消更换</button>}
            </>}
            <button data-testid="advisor-open-mcp-config" className="advisor-auth-secondary" type="button" onClick={onOpenMcp} disabled={saving}>配置业务数据服务</button>
            <button data-testid="advisor-open-virtual-senior" className="advisor-auth-secondary advisor-virtual-senior-entry" type="button" onClick={openVirtualSenior} disabled={saving}><Flask weight="bold" />{virtualSeniorAvailable ? "打开虚拟长者测试" : "启动虚拟长者测试"}</button>
            <small className="advisor-virtual-senior-help">使用独立合成数据，不影响正式咨询；点击后直接进入测试中心。</small>
            {message && <div className={`advisor-pin-message ${message.startsWith("本机密钥已") ? "is-success" : ""}`} role="status" aria-live="polite">{message}</div>}
          </>
        )}
      </section>
    </div>
  );
}

function TerminalSettingsDialog({ modelConfigured, onClose, onManageModel, onManageMcp, onManageVirtualSenior }) {
  return (
    <div className="advisor-dialog-scrim" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <section className="advisor-exit-dialog advisor-terminal-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="advisor-terminal-settings-title">
        <button className="advisor-dialog-close" type="button" onClick={onClose} aria-label="关闭"><X weight="bold" /></button>
        <span className="advisor-exit-dialog__icon"><GearSix weight="duotone" /></span>
        <p>终端设置</p>
        <h2 id="advisor-terminal-settings-title">管理本站点终端</h2>
        <small>仅供管理员配置。密钥保存在本机，使用者不会看到或再次填写已保存的内容。</small>
        <div className="advisor-terminal-settings-list">
          <button className="advisor-terminal-setting" type="button" onClick={onManageModel}>
            <LockKey weight="duotone" /><span><strong>智能对话</strong><small>{modelConfigured ? "DeepSeek 已配置" : "尚未配置 DeepSeek"}</small></span><ArrowRight weight="bold" />
          </button>
          <button className="advisor-terminal-setting" type="button" onClick={onManageMcp}>
            <Buildings weight="duotone" /><span><strong>业务数据服务</strong><small>配置并检测 5 项 MCP 服务</small></span><ArrowRight weight="bold" />
          </button>
          <button className="advisor-terminal-setting" type="button" onClick={onManageVirtualSenior}>
            <Flask weight="duotone" /><span><strong>虚拟长者测试</strong><small>只使用隔离合成数据</small></span><ArrowRight weight="bold" />
          </button>
          <div className="advisor-terminal-setting is-unavailable" aria-label="站点账号服务尚未接入">
            <PersonSimpleCircle weight="duotone" /><span><strong>站点账号</strong><small>账号登录与登出服务待接入</small></span><Info weight="bold" />
          </div>
        </div>
      </section>
    </div>
  );
}

function McpSetupDialog({ onClose, onBack }) {
  const api = useMemo(() => mcpConfigurationApi(), []);
  const names = Object.keys(mcpServiceLabels);
  const [urls, setUrls] = useState(() => Object.fromEntries(names.map((name) => [name, ""])));
  const [locked, setLocked] = useState(() => Object.fromEntries(names.map((name) => [name, false])));
  const [token, setToken] = useState("");
  const [probe, setProbe] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!api) {
      setMessage("业务数据配置仅在桌面应用中提供。");
      return;
    }
    const status = await api.status();
    setUrls(Object.fromEntries(names.map((name) => [name, status?.servers?.[name]?.url || ""])));
    setLocked(Object.fromEntries(names.map((name) => [name, Boolean(status?.servers?.[name]?.locked)])));
  }, [api]);

  useEffect(() => { void loadStatus().catch((error) => setMessage(error?.message || "读取业务连接状态失败。")); }, [loadStatus]);

  const payload = () => Object.fromEntries(names.map((name) => [name, { url: urls[name], token }]));
  const save = async () => {
    if (!api) return;
    setBusy(true); setMessage(""); setProbe(null);
    try {
      const result = await api.save(payload());
      setProbe(result.probe);
      setToken("");
      await loadStatus();
      setMessage(result.probe?.ok ? "业务数据服务 5/5 已连接。" : `配置已保存，当前 ${result.probe?.connectedCount || 0}/5 个服务通过检测。`);
    } catch (error) {
      setMessage(error?.message || "保存或检测失败，请检查地址后重试。");
    } finally { setBusy(false); }
  };
  const test = async () => {
    if (!api) return;
    setBusy(true); setMessage("");
    try {
      const result = await api.test(payload());
      setProbe(result);
      setMessage(result.ok ? "业务数据服务 5/5 已连接。" : `当前 ${result.connectedCount || 0}/5 个服务通过检测。`);
    } catch (error) { setMessage(error?.message || "连接检测失败。"); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!confirmClear) { setConfirmClear(true); setMessage("再次点击“确认清除”才会移除本机业务连接。环境变量管理的地址不会被清除。"); return; }
    if (!api) return;
    setBusy(true);
    try {
      await api.clear();
      setProbe(null); setToken(""); setConfirmClear(false);
      await loadStatus();
      setMessage("本机业务连接已清除。");
    } catch (error) { setMessage(error?.message || "清除失败，请稍后重试。"); }
    finally { setBusy(false); }
  };

  return (
    <div className="advisor-dialog-scrim" role="presentation" onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <section className="advisor-exit-dialog advisor-model-setup-dialog advisor-mcp-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="advisor-mcp-setup-title">
        <button className="advisor-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="关闭"><X weight="bold" /></button>
        <span className="advisor-exit-dialog__icon"><Buildings weight="duotone" /></span>
        <p>终端管理</p>
        <h2 id="advisor-mcp-setup-title">连接业务数据服务</h2>
        <small>五项服务全部通过工具发现后才算业务已连接。地址保存在本机；共享令牌不会显示在状态页。</small>
        <div className="advisor-mcp-fields">
          {names.map((name) => {
            const result = probe?.servers?.[name];
            return <label className="advisor-mcp-field" key={name}>
              <span>{mcpServiceLabels[name]}{locked[name] ? " · 启动环境管理" : ""}</span>
              <input data-testid={`advisor-mcp-url-${name}`} type="url" value={urls[name]} onChange={(event) => setUrls((current) => ({ ...current, [name]: event.target.value }))} placeholder="https://…/mcp" disabled={busy || locked[name]} autoComplete="off" spellCheck="false" />
              {result && <small className={result.connected ? "is-success" : "is-error"}>{result.connected ? `已连接 · ${result.toolCount} 个工具` : result.error || "未通过"}</small>}
            </label>;
          })}
          <label className="advisor-mcp-field">
            <span>共享 Bearer Token</span>
            <input data-testid="advisor-mcp-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="留空则保留已保存令牌" disabled={busy} autoComplete="off" spellCheck="false" />
          </label>
        </div>
        <button data-testid="advisor-mcp-save" className="advisor-exit-submit" type="button" onClick={save} disabled={busy}>{busy ? "正在检测…" : "保存并检测 5 项服务"}</button>
        <div className="advisor-mcp-actions">
          <button className="advisor-auth-secondary" type="button" onClick={test} disabled={busy}>仅重新检测</button>
          <button className="advisor-auth-secondary" type="button" onClick={clear} disabled={busy}>{confirmClear ? "确认清除" : "清除本机配置"}</button>
          <button className="advisor-auth-secondary" type="button" onClick={onBack} disabled={busy}>返回模型连接</button>
        </div>
        {message && <div className={`advisor-pin-message ${message.includes("5/5 已连接") || message.includes("已清除") ? "is-success" : ""}`} role="status" aria-live="polite">{message}</div>}
      </section>
    </div>
  );
}

export function StationAdvisorApp() {
  const [screen, setScreen] = useState("home");
  const [responseId, setResponseId] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [showTerminalSettings, setShowTerminalSettings] = useState(false);
  const [showModelSetup, setShowModelSetup] = useState(false);
  const [showMcpSetup, setShowMcpSetup] = useState(false);
  const [showVirtualSenior, setShowVirtualSenior] = useState(() => Boolean(window.kioskBridge?.virtualSeniorAutoOpen));
  const [virtualSeniorAvailable, setVirtualSeniorAvailable] = useState(() => Boolean(window.kioskBridge?.virtualSeniorAvailable));
  const [virtualSeniorDualScreen, setVirtualSeniorDualScreen] = useState(() => Boolean(window.kioskBridge?.virtualSeniorDualScreen));
  const [modelConfigured, setModelConfigured] = useState(null);
  const [expandedPoints, setExpandedPoints] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [autoVoiceEnabled, setAutoVoiceEnabled] = useState(true);
  const recognitionRef = useRef(null);
  const recordingAbortRef = useRef(null);
  const operationIdRef = useRef(0);
  const autoListenTimerRef = useRef(null);
  const draftRevisionRef = useRef(0);
  const draftRef = useRef("");
  const voiceStateRef = useRef("idle");
  const screenRef = useRef("home");
  const showExitRef = useRef(false);
  const listeningOperationRef = useRef(false);
  const submittingRef = useRef(false);
  const agentRunRef = useRef("");
  const answerSequenceRef = useRef(0);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const {
    analyserRef: speechAnalyserRef,
    mood: speechMood,
    preparing: speechPreparing,
    speak,
    speaking,
    stop: stopSpeaking,
    visemeTimelineRef: speechVisemeTimelineRef,
  } = useStationAdvisorSpeech({ muted });

  draftRef.current = draft;
  voiceStateRef.current = voiceState;
  screenRef.current = screen;
  showExitRef.current = showExit;

  useEffect(() => {
    let active = true;
    void deepSeekConfigurationApi().status().then((status) => {
      if (active) setModelConfigured(Boolean(status?.configured));
    }).catch(() => {
      if (active) setModelConfigured(false);
    });
    return () => { active = false; };
  }, []);

  const response = useMemo(() => responseId ? responses[responseId] : null, [responseId]);
  const voiceBusy = ["starting", "standby", "listening", "recognizing"].includes(voiceState);

  const cancelAutoSubmit = useCallback(() => {
    return undefined;
  }, []);

  const stopVoice = useCallback(({ discard = false } = {}) => {
    cancelAutoSubmit();
    window.clearTimeout(autoListenTimerRef.current);
    autoListenTimerRef.current = null;
    if (discard) {
      operationIdRef.current += 1;
      listeningOperationRef.current = false;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try { if (discard) recognition.abort(); else recognition.stop(); } catch {}
    }
    if (recordingAbortRef.current) {
      recordingAbortRef.current.abort();
      recordingAbortRef.current = null;
    }
    const nextState = discard ? "idle" : "recognizing";
    voiceStateRef.current = nextState;
    setVoiceState(nextState);
  }, [cancelAutoSubmit]);

  useEffect(() => {
    if (!window.kioskBridge?.qaAvatar) return undefined;
    const qaApi = {
      // Mirror the real question path: never profile TTS while the microphone
      // ScriptProcessor and offline ASR preview are still running.
      speakReference: (text) => {
        setAutoVoiceEnabled(false);
        stopVoice({ discard: true });
        return speak(String(text || ""));
      },
      stopSpeech: () => {
        setAutoVoiceEnabled(false);
        stopSpeaking();
        stopVoice({ discard: true });
      },
    };
    window.__XIAOAN_AVATAR_QA__ = qaApi;
    return () => {
      if (window.__XIAOAN_AVATAR_QA__ === qaApi) delete window.__XIAOAN_AVATAR_QA__;
    };
  }, [speak, stopSpeaking, stopVoice]);

  const askQuestion = useCallback(async (id, userText = "") => {
    const answerSequence = answerSequenceRef.current + 1;
    answerSequenceRef.current = answerSequence;
    stopVoice({ discard: true });
    stopSpeaking();
    setAutoVoiceEnabled(false);
    draftRevisionRef.current += 1;
    draftRef.current = "";
    setDraft("");
    setVoiceMessage("");
    setKeyboardMode(false);
    const nextResponseId = responses[id] ? id : "generic";
    const fallbackResponse = responses[nextResponseId];
    const questionText = userText || defaultQuestions.find((item) => item.id === id)?.label || "我想继续了解";
    const messageId = Date.now();
    setMessages((current) => [...current, { id: `${messageId}-user`, role: "user", text: questionText }]);
    setResponseId(nextResponseId);
    setScreen("conversation");
    let nextResponse = fallbackResponse;
    let memberAuthorizationRequired = false;
    const runAgentTurn = window.kioskBridge?.agentTurn
      ? (payload) => window.kioskBridge.agentTurn(payload)
      : async (payload) => {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("智能体服务暂时不可用");
        return response.json();
      };
    if (runAgentTurn) {
      if (agentRunRef.current) void window.kioskBridge.cancelAgentTurn?.(agentRunRef.current);
      const runId = `advisor-${messageId}`;
      agentRunRef.current = runId;
      try {
        const result = await runAgentTurn({
          runId,
          sessionId: "station-advisor",
          turnId: `turn-${messageId}`,
          text: questionText,
          actor: { role: "anonymous", authLevel: "none", subjectToken: null, scopes: [] },
        });
        if (agentRunRef.current !== runId) return;
        memberAuthorizationRequired = isMemberAuthorizationRequired(result);
        nextResponse = memberAuthorizationRequired
          ? responses.points
          : result?.status === "auth_required"
            ? personalHealthAuthorizationResponse
            : responseFromHarness(result, fallbackResponse);
      } catch {
        nextResponse = responseFromHarness({ ok: false, error: { code: "AGENT_UNAVAILABLE" } }, fallbackResponse);
      } finally {
        if (agentRunRef.current === runId) agentRunRef.current = "";
      }
    }
    if (nextResponse.errorCode === "MODEL_NOT_CONFIGURED") {
      setModelConfigured(false);
      setAutoVoiceEnabled(false);
      voiceStateRef.current = "paused";
      setVoiceState("paused");
      setVoiceMessage("大模型未连接，已暂停自动聆听");
    }
    setMessages((current) => {
      const cleaned = current.filter((message) => !(message.role === "user" && !/[\p{L}\p{N}]/u.test(message.text || "")));
      return [...cleaned, { id: `${messageId}-assistant`, role: "assistant", title: nextResponse.title, text: nextResponse.body, meta: nextResponse.meta, agents: nextResponse.agents, errorCode: nextResponse.errorCode }];
    });
    const speech = speak(`${nextResponse.title}。${nextResponse.body}`);
    if (memberAuthorizationRequired) {
      setAutoVoiceEnabled(false);
      void Promise.resolve(speech).then(() => new Promise((resolve) => window.setTimeout(resolve, 500))).then(() => {
        if (screenRef.current === "conversation") setScreen("consent");
      });
    } else {
      void Promise.resolve(speech).finally(() => {
        if (answerSequence !== answerSequenceRef.current || nextResponse.errorCode === "MODEL_NOT_CONFIGURED") return;
        if (screenRef.current !== "home" && screenRef.current !== "conversation") return;
        setAutoVoiceEnabled(true);
        voiceStateRef.current = "idle";
        setVoiceState("idle");
        setVoiceMessage("");
      });
    }
  }, [speak, stopSpeaking, stopVoice]);

  const handleModelConfigurationChange = useCallback((configured) => {
    setModelConfigured(configured);
    if (configured) {
      setAutoVoiceEnabled(true);
      voiceStateRef.current = "idle";
      setVoiceState("idle");
      setVoiceMessage("大模型已连接，可以开始提问");
    } else {
      setAutoVoiceEnabled(false);
      voiceStateRef.current = "paused";
      setVoiceState("paused");
      setVoiceMessage("大模型连接已清除");
    }
  }, []);

  const submitText = useCallback((value) => {
    const text = String(value || "").trim();
    if (!text || submittingRef.current) return;
    if (!/[\p{L}\p{N}]/u.test(text)) {
      draftRevisionRef.current += 1;
      draftRef.current = "";
      setDraft("");
      setVoiceMessage("没有听清，请再说一次");
      voiceStateRef.current = "idle";
      setVoiceState("idle");
      return;
    }
    submittingRef.current = true;
    cancelAutoSubmit();
    askQuestion(resolveAdvisorIntent(text), text);
    window.setTimeout(() => { submittingRef.current = false; }, 0);
  }, [askQuestion, cancelAutoSubmit]);

  const finalizeRecognition = useCallback((text) => {
    listeningOperationRef.current = false;
    recognitionRef.current = null;
    recordingAbortRef.current = null;
    cancelAutoSubmit();
    const recognizedText = String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
    if (!recognizedText) {
      setVoiceMessage("没有听清，我会继续听，您也可以直接输入");
      voiceStateRef.current = "idle";
      setVoiceState("idle");
      return;
    }
    draftRevisionRef.current += 1;
    draftRef.current = recognizedText;
    setDraft(recognizedText);
    setVoiceMessage("识别完成，正在发送");
    voiceStateRef.current = "submitting";
    setVoiceState("submitting");
    submitText(recognizedText);
  }, [cancelAutoSubmit, submitText]);

  const startListening = useCallback(async ({ automatic = false } = {}) => {
    if (listeningOperationRef.current) return;
    stopSpeaking();
    cancelAutoSubmit();
    window.clearTimeout(autoListenTimerRef.current);
    autoListenTimerRef.current = null;
    listeningOperationRef.current = true;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setAutoVoiceEnabled(true);
    draftRevisionRef.current += 1;
    draftRef.current = "";
    setDraft("");
    setKeyboardMode(false);
    setVoiceMessage(automatic ? "持续对话已开启，请直接说话" : "");
    voiceStateRef.current = "starting";
    setVoiceState("starting");

    const fail = (message, { recoverable = false } = {}) => {
      if (operationId !== operationIdRef.current) return;
      listeningOperationRef.current = false;
      recognitionRef.current = null;
      recordingAbortRef.current = null;
      setVoiceMessage(message || "麦克风暂时不可用，您可以直接输入");
      const nextState = recoverable ? "idle" : "error";
      if (!recoverable) setAutoVoiceEnabled(false);
      voiceStateRef.current = nextState;
      setVoiceState(nextState);
    };

    const recordLocally = async (recognize, recognizePreview) => {
      const controller = new AbortController();
      recordingAbortRef.current = controller;
      const recording = await recordSpeech({
        maxDurationMs: 15000,
        maxIdleMs: 30000,
        silenceMs: 600,
        preRollMs: automatic ? 900 : 420,
        vadOptions: automatic ? { calibrationFrames: 8, activationFrames: 4, quietFramesBeforeActivation: 4 } : undefined,
        previewIntervalMs: 500,
        previewMaxDurationMs: 6000,
        signal: controller.signal,
        onReady: () => {
          if (operationId !== operationIdRef.current) return;
          voiceStateRef.current = "standby";
          setVoiceState("standby");
        },
        onSpeechStart: () => {
          if (operationId !== operationIdRef.current) return;
          voiceStateRef.current = "listening";
          setVoiceState("listening");
          setVoiceMessage("请继续说话");
        },
        onPreview: recognizePreview
          ? async ({ samples, sampleRate }) => {
            const preview = await recognizePreview(samples, sampleRate);
            if (operationId !== operationIdRef.current || voiceStateRef.current !== "listening" || !preview?.text) return;
            const previewText = String(preview.text).trim();
            draftRef.current = previewText;
            setDraft(previewText);
          }
          : undefined,
      });
      if (operationId !== operationIdRef.current) return;
      recordingAbortRef.current = null;
      if (!recording.heardSpeech || !recording.samples.length) {
        fail("暂时没有检测到声音，您开口后我会继续", { recoverable: true });
        return;
      }
      voiceStateRef.current = "recognizing";
      setVoiceState("recognizing");
      setVoiceMessage("正在识别，请稍候");
      const result = await recognize(recording);
      if (operationId !== operationIdRef.current) return;
      listeningOperationRef.current = false;
      if (!result?.ok && !result?.text) {
        fail(result?.message || "没有听清，我会继续听，您也可以直接输入", { recoverable: true });
        return;
      }
      finalizeRecognition(result?.text, {
        confidence: result?.confidence,
        provider: result?.provider,
        trustedFinal: result?.trustedFinal,
      });
    };

    if (window.kioskBridge?.recognizePcm) {
      try {
        await recordLocally(async (recording) => {
          const result = await window.kioskBridge.recognizePcm(recording.samples, recording.sampleRate);
          return result;
        }, (samples, sampleRate) => window.kioskBridge.recognizePreviewPcm(samples, sampleRate));
      } catch (error) {
        fail(error?.message || "麦克风暂时不可用，您可以直接输入");
      }
      return;
    }

    if (await isLocalSpeechApiReady()) {
      if (operationId !== operationIdRef.current) return;
      try {
        await recordLocally(async (recording) => {
          const response = await fetch("/api/speech/recognize", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream", Accept: "application/json" },
            body: recording.samples.buffer,
          });
          if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) {
            throw new Error("本地语音识别暂时不可用");
          }
          return response.json();
        }, async (samples) => {
          const response = await fetch("/api/speech/recognize-preview", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream", Accept: "application/json" },
            body: samples.buffer,
          });
          if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return null;
          return response.json();
        });
      } catch (error) {
        fail(error?.message || "麦克风暂时不可用，您可以直接输入");
      }
      return;
    }

    if (operationId !== operationIdRef.current) return;

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const allowBrowserSpeech = new URLSearchParams(window.location.search).get("allowWebSpeech") === "1";
    if (Recognition && allowBrowserSpeech) {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      let latestText = "";
      let latestFinalText = "";
      let latestConfidence = 0;
      let settled = false;
      const settle = () => {
        if (settled || operationId !== operationIdRef.current) return;
        settled = true;
        listeningOperationRef.current = false;
        recognitionRef.current = null;
        if (!latestFinalText) {
          fail("没有获得完整识别结果，我会继续听，您也可以直接输入", { recoverable: true });
          return;
        }
        finalizeRecognition(latestFinalText, {
          confidence: latestConfidence || undefined,
          provider: "web-speech",
          trustedFinal: false,
        });
      };
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (operationId !== operationIdRef.current) return;
        voiceStateRef.current = "standby";
        setVoiceState("standby");
      };
      recognition.onspeechstart = () => {
        if (operationId !== operationIdRef.current) return;
        voiceStateRef.current = "listening";
        setVoiceState("listening");
        setVoiceMessage("已经听到，请继续说");
      };
      recognition.onresult = (event) => {
        if (operationId !== operationIdRef.current) return;
        let finalText = "";
        let interimText = "";
        let finalConfidence = 0;
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const candidate = result?.[0]?.transcript || "";
          if (result.isFinal) {
            finalText += candidate;
            finalConfidence = Number(result?.[0]?.confidence) || finalConfidence;
          } else interimText += candidate;
        }
        latestText = `${finalText}${interimText}`.trim();
        if (finalText.trim()) latestFinalText = finalText.trim();
        latestConfidence = finalConfidence || latestConfidence;
        if (latestText) {
          draftRef.current = latestText;
          setDraft(latestText);
        }
        if (finalText && !interimText) settle();
      };
      recognition.onspeechend = () => {
        if (operationId !== operationIdRef.current) return;
        voiceStateRef.current = "recognizing";
        setVoiceState("recognizing");
      };
      recognition.onend = settle;
      recognition.onerror = (event) => {
        if (event?.error === "aborted" || operationId !== operationIdRef.current) return;
        settled = true;
        fail(
          event?.error === "not-allowed" ? "麦克风权限未开启，您可以直接输入" : "没有听清，我会继续听，您也可以直接输入",
          { recoverable: event?.error !== "not-allowed" },
        );
      };
      try { recognition.start(); } catch (error) { fail(error?.message); }
      return;
    }

    fail("本地语音识别未就绪，您仍可直接输入问题");
  }, [cancelAutoSubmit, finalizeRecognition, stopSpeaking]);

  useEffect(() => {
    const conversationalScreen = screen === "home" || screen === "conversation";
    if (!conversationalScreen || !autoVoiceEnabled || voiceState !== "idle" || draft || showExit || showTerminalSettings || showModelSetup || showMcpSetup || showVirtualSenior || keyboardMode || speaking || speechPreparing) return undefined;
    const retrying = Boolean(voiceMessage);
    const delayMs = retrying ? advisorInteractionRetryDelayMs : screen === "home" ? 650 : 1050;
    autoListenTimerRef.current = window.setTimeout(() => startListening({ automatic: true }), delayMs);
    return () => window.clearTimeout(autoListenTimerRef.current);
  }, [autoVoiceEnabled, draft, keyboardMode, screen, showExit, showMcpSetup, showModelSetup, showTerminalSettings, showVirtualSenior, speaking, speechPreparing, startListening, voiceMessage, voiceState]);

  useEffect(() => () => {
    operationIdRef.current += 1;
    listeningOperationRef.current = false;
    window.clearTimeout(autoListenTimerRef.current);
    cancelAutoSubmit();
    try { recognitionRef.current?.abort?.(); } catch {}
    recordingAbortRef.current?.abort();
    recognitionRef.current = null;
    recordingAbortRef.current = null;
  }, [cancelAutoSubmit]);

  const goHome = useCallback(() => {
    answerSequenceRef.current += 1;
    if (agentRunRef.current) void window.kioskBridge?.cancelAgentTurn?.(agentRunRef.current);
    agentRunRef.current = "";
    void window.kioskBridge?.clearAgentSession?.("station-advisor");
    stopVoice({ discard: true });
    stopSpeaking();
    setAutoVoiceEnabled(true);
    draftRevisionRef.current += 1;
    draftRef.current = "";
    setDraft("");
    setKeyboardMode(false);
    setVoiceMessage("");
    setResponseId("");
    setMessages([]);
    setExpandedPoints(false);
    setScreen("home");
  }, [stopSpeaking, stopVoice]);

  const handleDraftChange = (value) => {
    cancelAutoSubmit();
    if (voiceBusy || listeningOperationRef.current) stopVoice({ discard: true });
    draftRevisionRef.current += 1;
    draftRef.current = value;
    setDraft(value);
    setVoiceMessage(value ? "已暂停自动发送，修改后点击发送" : "支持自动识别，也可以点击输入");
    voiceStateRef.current = value ? "editing" : "idle";
    setVoiceState(value ? "editing" : "idle");
  };

  const composerStatus = voiceState === "starting"
    ? "正在打开麦克风…"
    : voiceState === "standby"
      ? "等待您开口"
    : voiceState === "listening"
      ? (voiceMessage || "正在听，请直接说话")
      : voiceState === "recognizing"
        ? "正在识别，请稍候"
        : speechPreparing
          ? "正在准备本地语音回答"
          : speaking
            ? "小安正在回答"
            : voiceState === "paused" || !autoVoiceEnabled
              ? modelConfigured === false
                ? "大模型未连接，点右侧连接"
                : "语音已暂停"
              : voiceMessage || "自动聆听已开启，请直接说话";

  const openTerminalManagement = () => {
    stopVoice({ discard: true });
    stopSpeaking();
    setAutoVoiceEnabled(false);
    setKeyboardMode(false);
    setShowMcpSetup(false);
    setShowModelSetup(false);
    setShowTerminalSettings(true);
  };
  const closeTerminalManagement = () => {
    setShowTerminalSettings(false);
    setShowModelSetup(false);
    setShowMcpSetup(false);
    if (modelConfigured !== false) {
      setAutoVoiceEnabled(true);
      voiceStateRef.current = "idle";
      setVoiceState("idle");
      setVoiceMessage("");
    }
  };

  const composerProps = {
    draft,
    status: composerStatus,
    voiceState,
    autoVoiceEnabled,
    modelConfigured,
    keyboardMode,
    speaking,
    preparing: speechPreparing,
    onDraftChange: handleDraftChange,
    onFocus: () => {
      setKeyboardMode(true);
      cancelAutoSubmit();
      if (voiceBusy || listeningOperationRef.current || voiceStateRef.current === "countdown") stopVoice({ discard: true });
      const nextState = draftRef.current ? "editing" : "idle";
      voiceStateRef.current = nextState;
      setVoiceState(nextState);
      setVoiceMessage(draftRef.current ? "已暂停自动发送，修改后点击发送" : "键盘输入已就绪");
    },
    onKeyboard: () => {
      setKeyboardMode(true);
      cancelAutoSubmit();
      if (voiceBusy || listeningOperationRef.current || voiceStateRef.current === "countdown") stopVoice({ discard: true });
      const nextState = draftRef.current ? "editing" : "idle";
      voiceStateRef.current = nextState;
      setVoiceState(nextState);
      setVoiceMessage(draftRef.current ? "修改后点击发送" : "键盘输入已就绪");
    },
    onMic: () => {
      setKeyboardMode(false);
      if (speaking || speechPreparing) {
        setAutoVoiceEnabled(true);
        voiceStateRef.current = "idle";
        setVoiceState("idle");
        setVoiceMessage("回答结束后将自动聆听");
        return;
      }
      if (!autoVoiceEnabled || voiceStateRef.current === "paused") {
        setAutoVoiceEnabled(true);
        voiceStateRef.current = "idle";
        setVoiceState("idle");
        setVoiceMessage("");
      }
      void startListening();
    },
    onConfigureModel: openTerminalManagement,
    onSubmit: () => submitText(draft),
  };

  const handleQuestion = (id, label) => askQuestion(id, label);

  const openExit = () => {
    stopVoice({ discard: true });
    stopSpeaking();
    setKeyboardMode(false);
    setShowExit(true);
  };

  const listening = ["listening", "recognizing"].includes(voiceState);
  const avatarStatus = speaking || speechPreparing
    ? "小安正在回答"
    : listening
      ? "正在聆听"
      : autoVoiceEnabled
        ? "等待您说话"
        : "语音已暂停";
  const avatarProps = {
    analyserRef: speechAnalyserRef,
    listening,
    mood: speechMood,
    preparing: speechPreparing,
    speaking,
    status: avatarStatus,
    visemeTimelineRef: speechVisemeTimelineRef,
  };

  return (
    <div className="advisor-viewport">
      {virtualSeniorDualScreen && <div className="advisor-test-mode-banner" role="status">测试模式：仅使用合成数据</div>}
      <div className="advisor-screen-backdrop" aria-hidden="true">
        <img src="./assets/xiaoa-fullbody-extension-v1.0.0.png" alt="" />
      </div>
      <div className={`advisor-shell advisor-screen-${screen} ${largeText ? "is-large-text" : ""} ${showVirtualSenior ? "has-virtual-senior-console" : ""} ${keyboardMode && (screen === "home" || screen === "conversation") ? "has-soft-keyboard" : ""}`}>
        {screen !== "home" && screen !== "conversation" && <AdvisorHeader screen={screen} largeText={largeText} muted={muted} onHome={goHome} onLargeText={() => setLargeText((value) => !value)} onMute={() => setMuted((value) => !value)} onSettings={openTerminalManagement} onExit={openExit} />}
        {(screen === "home" || screen === "conversation") && <button className="advisor-terminal-settings-trigger" type="button" onClick={openTerminalManagement} aria-label="打开终端设置"><DotsThree weight="bold" /></button>}
        {screen === "home" && <HomeScreen onQuestion={handleQuestion} composerProps={composerProps} avatarProps={avatarProps} modelConfigured={modelConfigured} onConnectModel={openTerminalManagement} />}
        {screen === "conversation" && <ConversationScreen response={response} messages={messages} onQuestion={handleQuestion} composerProps={composerProps} avatarProps={avatarProps} onConnectModel={openTerminalManagement} />}
        {screen === "consent" && <ConsentScreen avatarProps={avatarProps} onCancel={() => { setAutoVoiceEnabled(true); setScreen("conversation"); }} onContinue={() => setScreen("scan")} />}
        {screen === "scan" && <ScanScreen avatarProps={avatarProps} onComplete={() => setScreen("member")} onCancel={() => { setAutoVoiceEnabled(true); setScreen("conversation"); }} />}
        {screen === "member" && <MemberScreen avatarProps={avatarProps} expanded={expandedPoints} onToggleExpanded={() => setExpandedPoints((value) => !value)} onFinish={goHome} />}
        <AdvisorChineseKeyboard
          draft={draft}
          open={keyboardMode && (screen === "home" || screen === "conversation")}
          onChange={handleDraftChange}
          onClose={() => {
            handleDraftChange("");
            setKeyboardMode(false);
          }}
          onSubmit={(value) => submitText(value || draftRef.current)}
        />
        {showExit && <ExitDialog onClose={() => setShowExit(false)} />}
        {showTerminalSettings && <TerminalSettingsDialog modelConfigured={modelConfigured === true} onClose={closeTerminalManagement} onManageModel={() => { setShowTerminalSettings(false); setShowModelSetup(true); }} onManageMcp={() => { setShowTerminalSettings(false); setShowMcpSetup(true); }} onManageVirtualSenior={() => { setShowTerminalSettings(false); setShowModelSetup(true); }} />}
        {showModelSetup && <DeepSeekSetupDialog configured={modelConfigured === true} onClose={closeTerminalManagement} onConfigurationChange={handleModelConfigurationChange} onOpenMcp={() => { setShowModelSetup(false); setShowMcpSetup(true); }} onOpenVirtualSenior={() => { setShowModelSetup(false); setShowVirtualSenior(true); }} onVirtualSeniorActivated={(result) => { setVirtualSeniorAvailable(true); setVirtualSeniorDualScreen(result?.surface === "window"); }} virtualSeniorAvailable={virtualSeniorAvailable} />}
        {showMcpSetup && <McpSetupDialog onClose={closeTerminalManagement} onBack={() => { setShowMcpSetup(false); setShowTerminalSettings(true); }} />}
        <VirtualSeniorTestConsole ProductSurface={ConversationScreen} open={showVirtualSenior} onClose={() => { setShowVirtualSenior(false); closeTerminalManagement(); }} />
      </div>
    </div>
  );
}
