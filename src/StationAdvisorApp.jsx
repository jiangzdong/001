import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  CalendarDots,
  Check,
  CheckCircle,
  Coins,
  FaceMask,
  HouseLine,
  Info,
  Keyboard,
  ListBullets,
  LockKey,
  Microphone,
  PersonSimpleCircle,
  PaperPlaneTilt,
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
import { resolveAdvisorIntent } from "./stationAdvisorInput.js";
import { advisorInteractionRetryDelayMs } from "./stationAdvisorInteraction.js";
import { StationAdvisorDigitalHuman } from "./StationAdvisorDigitalHuman.jsx";
import { useStationAdvisorSpeech } from "./useStationAdvisorSpeech.js";

const appVersion = `V${__APP_VERSION__}`;

const defaultQuestions = [
  { id: "activities", icon: CalendarDots, label: "今天站点有什么活动？", shortLabel: "今日活动" },
  { id: "services", icon: Buildings, label: "站点可以提供哪些服务？", shortLabel: "站点服务" },
  { id: "points", icon: Coins, label: "帮我查一下会员积分", shortLabel: "会员积分" },
];

const responses = {
  activities: {
    title: "今天共有 3 场活动",
    body: "上午 9:30 有八段锦，下午 2:00 是健康讲堂，下午 3:30 有手工兴趣小组。您到活动室门口签到即可参加。",
    meta: "活动安排 · 8月31日",
    followups: ["八段锦在哪里参加？", "健康讲堂讲什么？", "还有哪些长期活动？"],
    agents: [{ id: "activities", label: "活动报名" }, { id: "activities", label: "活动日历" }, { id: "services", label: "站点服务" }],
  },
  services: {
    title: "站点提供 5 类日常服务",
    body: "包括活动报名、健康知识、助餐指引、康复训练咨询和会员服务。需要专业判断时，请以现场工作人员的正式安排为准。",
    meta: "柳州康养服务站",
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
    title: "我已经记下您的问题",
    body: "本机演示目前可以回答站点活动、服务项目和本人会员信息。您可以换一种说法，或直接点选下面的问题继续体验。",
    meta: "本机演示说明",
    followups: ["今天站点有什么活动？", "站点可以提供哪些服务？", "帮我查一下会员积分"],
    agents: [{ id: "activities", label: "活动服务" }, { id: "services", label: "站点服务" }, { id: "points", label: "会员积分" }],
  },
};

function responseFromHarness(result, fallback) {
  if (!result?.ok || result.status !== "completed" || result.intent === "unknown" || !result.answer?.speechText) return fallback;
  const titles = {
    "station.service.schedule": "助餐服务时间",
    "station.activity.detail": result.data?.title || "活动详情",
    "member.points.self": "会员积分",
    "member.balance.self": "会员余额",
  };
  return {
    title: titles[result.intent] || "站点咨询结果",
    body: result.answer.speechText,
    meta: "站点业务智能体",
    followups: [],
    agents: fallback?.agents || [],
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

function HeaderButton({ icon: Icon, label, active = false, onClick }) {
  return (
    <button className={`advisor-header-action ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      <Icon weight="bold" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function AdvisorHeader({ screen, largeText, muted, onHome, onLargeText, onMute, onExit }) {
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

function AdvisorComposer({ draft, status, voiceState, autoVoiceEnabled, keyboardMode, speaking, preparing, onDraftChange, onFocus, onKeyboard, onMic, onSubmit }) {
  const inputRef = useRef(null);
  const listening = voiceState === "listening" || voiceState === "starting";
  const recognizing = voiceState === "recognizing";
  const busy = listening || recognizing;
  const paused = !autoVoiceEnabled || voiceState === "paused";
  const modeLabel = keyboardMode
    ? "键盘输入"
    : speaking
    ? "小安正在回答"
    : preparing
      ? "正在准备回答"
      : listening
        ? "自动聆听中"
        : recognizing
          ? "正在识别"
          : voiceState === "submitting"
            ? "正在发送"
            : voiceState === "editing"
            ? "键盘输入"
            : paused
              ? "语音已暂停"
              : "自动聆听已开启";
  const micLabel = speaking
    ? "打断回答并开始聆听"
    : busy
      ? "暂停自动聆听"
      : paused
        ? "恢复自动聆听"
        : "立即开始聆听";
  const activateKeyboard = () => {
    onKeyboard();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    });
  };
  return (
    <form data-testid="advisor-input-module" data-voice-state={voiceState} className={`advisor-composer state-${voiceState} ${busy ? "is-listening" : ""} ${keyboardMode ? "is-keyboard" : ""}`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="advisor-composer__field">
        <div className="advisor-composer__status">
          <strong>{modeLabel}</strong>
          <small>
            <Waveform weight="bold" />
            <span aria-hidden="true">{status}</span>
            <span className="advisor-sr-only" aria-live="polite">{status}</span>
          </small>
        </div>
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
            placeholder={listening ? "请直接说话，文字会出现在这里" : paused ? "点这里输入，或恢复语音" : "直接说话，或点这里输入"}
            aria-label="站点咨询问题"
            autoComplete="off"
            enterKeyHint="send"
          />
          {draft && !busy && <button className="advisor-composer__clear" type="button" onClick={() => onDraftChange("")} aria-label="清空输入"><X weight="bold" /></button>}
        </div>
      </div>
      <button className={`advisor-composer__mic ${paused ? "is-paused" : ""}`} type="button" onClick={onMic} aria-pressed={autoVoiceEnabled && !paused} aria-label={micLabel}>
        <Microphone weight="fill" />
      </button>
      <div className="advisor-composer__actions">
        {draft && !busy ? <button className="advisor-composer__send" type="submit" aria-label="发送问题">
          <PaperPlaneTilt weight="fill" />
          <span>发送</span>
        </button> : <button data-testid="advisor-keyboard-trigger" className={`advisor-composer__keyboard ${keyboardMode ? "is-active" : ""}`} type="button" onClick={activateKeyboard} aria-pressed={keyboardMode} aria-label="打开应用内中文键盘">
          <Keyboard weight="bold" />
          <span>键盘</span>
        </button>}
      </div>
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

function HomeScreen({ onQuestion, composerProps, avatarProps }) {
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

function ConversationScreen({ response, messages, onQuestion, composerProps, avatarProps }) {
  const streamRef = useRef(null);
  const recognizing = ["starting", "listening", "recognizing"].includes(composerProps.voiceState);
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
              <article className="advisor-message advisor-message--user" key={message.id}>
                <span>您</span>
                <p>{message.text}</p>
              </article>
            ) : (
              <article className="advisor-message advisor-message--assistant" key={message.id}>
                <span><Waveform weight="bold" />小安 · {message.meta}</span>
                <h1>{message.title}</h1>
                <p>{message.text}</p>
                {index === messages.length - 1 && message.agents?.length > 0 && (
                  <div className="advisor-message__agents" aria-label="可用业务智能体">
                    {message.agents.map((agent) => <button type="button" key={`${agent.id}-${agent.label}`} onClick={() => onQuestion(agent.id, agent.label)}>{agent.label}<ArrowRight weight="bold" /></button>)}
                  </div>
                )}
              </article>
            )) : (
            <article className="advisor-empty-answer">
            <Microphone weight="duotone" />
            <p>点击下方按钮开始说话，或选择一个常见问题。</p>
          </article>
        )}
          {recognizing && (
            <article className="advisor-message advisor-message--user advisor-message--recognizing" role="status">
              <span><Waveform weight="bold" />您 · 正在识别</span>
              <p>{liveRecognitionText}</p>
            </article>
          )}
        </div>
        <AdvisorComposer {...composerProps} />
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

export function StationAdvisorApp() {
  const [screen, setScreen] = useState("home");
  const [responseId, setResponseId] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showExit, setShowExit] = useState(false);
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

  const response = useMemo(() => responseId ? responses[responseId] : null, [responseId]);
  const voiceBusy = ["starting", "listening", "recognizing"].includes(voiceState);

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
    stopVoice({ discard: true });
    stopSpeaking();
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
    if (window.kioskBridge?.agentTurn) {
      if (agentRunRef.current) void window.kioskBridge.cancelAgentTurn?.(agentRunRef.current);
      const runId = `advisor-${messageId}`;
      agentRunRef.current = runId;
      try {
        const result = await window.kioskBridge.agentTurn({
          runId,
          sessionId: "station-advisor",
          turnId: `turn-${messageId}`,
          text: questionText,
          actor: { role: "anonymous", authLevel: "none", subjectToken: null, scopes: [] },
        });
        if (agentRunRef.current !== runId) return;
        nextResponse = result?.status === "auth_required" ? responses.points : responseFromHarness(result, fallbackResponse);
      } catch {
        nextResponse = fallbackResponse;
      } finally {
        if (agentRunRef.current === runId) agentRunRef.current = "";
      }
    }
    setMessages((current) => [...current, { id: `${messageId}-assistant`, role: "assistant", title: nextResponse.title, text: nextResponse.body, meta: nextResponse.meta, agents: nextResponse.agents }]);
    const speech = speak(`${nextResponse.title}。${nextResponse.body}`);
    if (id === "points") {
      setAutoVoiceEnabled(false);
      void Promise.resolve(speech).then(() => new Promise((resolve) => window.setTimeout(resolve, 500))).then(() => {
        if (screenRef.current === "conversation") setScreen("consent");
      });
    }
  }, [speak, stopSpeaking, stopVoice]);

  const submitText = useCallback((value) => {
    const text = String(value || "").trim();
    if (!text || submittingRef.current) return;
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
    const recognizedText = String(text || "").trim();
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

    const recordLocally = async (recognize) => {
      const controller = new AbortController();
      recordingAbortRef.current = controller;
      const recording = await recordSpeech({
        maxDurationMs: 45000,
        maxIdleMs: 12000,
        silenceMs: 1100,
        previewIntervalMs: 900,
        previewMaxDurationMs: 8000,
        signal: controller.signal,
        onReady: () => {
          if (operationId !== operationIdRef.current) return;
          voiceStateRef.current = "listening";
          setVoiceState("listening");
        },
        onSpeechStart: () => operationId === operationIdRef.current && setVoiceMessage("请继续说话"),
        onPreview: window.kioskBridge?.recognizePreviewPcm
          ? async ({ samples, sampleRate }) => {
            const preview = await window.kioskBridge.recognizePreviewPcm(samples, sampleRate);
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
        fail("没有听到清晰语音，我会继续听，您也可以直接输入", { recoverable: true });
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
        });
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
        voiceStateRef.current = "listening";
        setVoiceState("listening");
      };
      recognition.onspeechstart = () => { if (operationId === operationIdRef.current) setVoiceMessage("已经听到，请继续说"); };
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
    if (!conversationalScreen || !autoVoiceEnabled || voiceState !== "idle" || draft || showExit || keyboardMode || speaking || speechPreparing) return undefined;
    const retrying = Boolean(voiceMessage);
    const delayMs = retrying ? advisorInteractionRetryDelayMs : screen === "home" ? 650 : 1050;
    autoListenTimerRef.current = window.setTimeout(() => startListening({ automatic: true }), delayMs);
    return () => window.clearTimeout(autoListenTimerRef.current);
  }, [autoVoiceEnabled, draft, keyboardMode, screen, showExit, speaking, speechPreparing, startListening, voiceMessage, voiceState]);

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
    : voiceState === "listening"
      ? (voiceMessage || "正在听，请直接说话")
      : voiceState === "recognizing"
        ? "正在识别，请稍候"
        : speechPreparing
          ? "正在准备本地语音回答"
          : speaking
            ? "小安正在回答，点麦克风可以打断"
            : voiceState === "paused" || !autoVoiceEnabled
              ? "语音已暂停，点麦克风继续"
              : voiceMessage || "自动聆听已开启，请直接说话";

  const composerProps = {
    draft,
    status: composerStatus,
    voiceState,
    autoVoiceEnabled,
    keyboardMode,
    speaking,
    preparing: speechPreparing,
    onDraftChange: handleDraftChange,
    onFocus: () => {
      setKeyboardMode(true);
      cancelAutoSubmit();
      stopSpeaking();
      if (voiceBusy || listeningOperationRef.current || voiceStateRef.current === "countdown") stopVoice({ discard: true });
      const nextState = draftRef.current ? "editing" : "idle";
      voiceStateRef.current = nextState;
      setVoiceState(nextState);
      setVoiceMessage(draftRef.current ? "已暂停自动发送，修改后点击发送" : "键盘输入已就绪");
    },
    onKeyboard: () => {
      setKeyboardMode(true);
      cancelAutoSubmit();
      stopSpeaking();
      if (voiceBusy || listeningOperationRef.current || voiceStateRef.current === "countdown") stopVoice({ discard: true });
      const nextState = draftRef.current ? "editing" : "idle";
      voiceStateRef.current = nextState;
      setVoiceState(nextState);
      setVoiceMessage(draftRef.current ? "修改后点击发送" : "键盘输入已就绪");
    },
    onMic: () => {
      setKeyboardMode(false);
      if (speaking || speechPreparing) {
        stopSpeaking();
        setAutoVoiceEnabled(true);
        voiceStateRef.current = "idle";
        setVoiceState("idle");
        setVoiceMessage("回答已暂停，请直接说话");
        void startListening();
        return;
      }
      if (voiceBusy || listeningOperationRef.current) {
        stopVoice({ discard: true });
        setAutoVoiceEnabled(false);
        voiceStateRef.current = "paused";
        setVoiceState("paused");
        setVoiceMessage("语音已暂停，点麦克风继续");
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
    onSubmit: () => submitText(draft),
  };

  const handleQuestion = (id, label) => askQuestion(id, label);

  const openExit = () => {
    stopVoice({ discard: true });
    stopSpeaking();
    setKeyboardMode(false);
    setShowExit(true);
  };

  const listening = ["starting", "listening", "recognizing"].includes(voiceState);
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
      <div className="advisor-screen-backdrop" aria-hidden="true">
        <img src="./assets/xiaoa-fullbody-extension-v1.0.0.png" alt="" />
      </div>
      <div className={`advisor-shell advisor-screen-${screen} ${largeText ? "is-large-text" : ""} ${keyboardMode && (screen === "home" || screen === "conversation") ? "has-soft-keyboard" : ""}`}>
        {screen !== "home" && screen !== "conversation" && <AdvisorHeader screen={screen} largeText={largeText} muted={muted} onHome={goHome} onLargeText={() => setLargeText((value) => !value)} onMute={() => setMuted((value) => !value)} onExit={openExit} />}
        {screen === "home" && <HomeScreen onQuestion={handleQuestion} composerProps={composerProps} avatarProps={avatarProps} />}
        {screen === "conversation" && <ConversationScreen response={response} messages={messages} onQuestion={handleQuestion} composerProps={composerProps} avatarProps={avatarProps} />}
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
          onSubmit={() => submitText(draftRef.current)}
        />
        {showExit && <ExitDialog onClose={() => setShowExit(false)} />}
      </div>
    </div>
  );
}
