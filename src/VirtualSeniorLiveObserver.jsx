import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, ArrowLeft, ArrowRight, CheckCircle, CheckSquare, Flask, MagnifyingGlass, Play, SpeakerHigh, Square, Stop, UserCircle, WarningCircle, X } from "@phosphor-icons/react";
import "./virtual-senior-live.css";

const words = { "verified-self": "本人已授权", anonymous: "匿名", "auth-required": "待身份确认", expired: "授权已过期", "scope-limited": "权限受限", "cross-subject": "非本人", "no-record": "无健康记录", routine: "常规记录", "single-attention": "单项关注", "multi-attention": "多项关注", conflicting: "数据冲突", stale: "记录过期", insufficient: "记录不足", complete: "完整", partial: "部分缺失", slow: "慢速", medium: "适中", fast: "快速", completed: "已完成", auth_required: "需身份授权", denied: "访问被阻止", cancelled: "已停止", failed: "未通过", blocked: "受阻", passed: "已通过", prepared: "已准备" };
const label = (value) => words[value] || value;
Object.assign(words, { journey_partial: "已结束，部分受阻或跳过", partial_failure: "已结束，存在失败", skipped: "未执行", running: "运行中" });
const bridge = () => window.kioskBridge;

export function VirtualSeniorLiveObserver({ ProductSurface, onClose, onBatch }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(null);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [scenarioId, setScenarioId] = useState("full-journey");
  const [selectedRoundIds, setSelectedRoundIds] = useState([]);
  const [roundPanelOpen, setRoundPanelOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("请选择一位合成长者");
  const [error, setError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [narrowView, setNarrowView] = useState("select");
  const [dialogContent, setDialogContent] = useState(null);
  const [report, setReport] = useState(null);
  const [voiceStage, setVoiceStage] = useState({ stage: "idle", status: "not-run" });
  const [retry, setRetry] = useState(0);
  const active = useRef(null);
  const alive = useRef(true);
  const lastSequence = useRef(0);
  const dialog = useRef(null);
  const frame = useRef(null);
  const selectRequest = useRef(0);
  const audio = useRef({ context: null, source: null, ticket: 0 });

  function stopObservedAudio({ close = false } = {}) {
    const current = audio.current;
    current.ticket += 1;
    if (current.source) {
      try { current.source.stop(); } catch { /* Already ended. */ }
      current.source.disconnect?.();
      current.source = null;
    }
    if (close && current.context) {
      void current.context.close?.().catch(() => {});
      current.context = null;
    }
  }

  async function playObservedAudio(event) {
    const current = active.current;
    if (!current || event.runId !== current.runId || event.sessionId !== current.sessionId) return;
    const ack = (receipt) => bridge()?.virtualSeniorLiveAck?.({ runId: event.runId, sequence: event.sequence, receipt }).catch(() => {});
    const sourceSamples = event.payload.samples;
    const sampleRate = Number(event.payload.sampleRate);
    const samples = sourceSamples instanceof Float32Array ? sourceSamples : Float32Array.from(sourceSamples || []);
    if (!samples.length || !Number.isFinite(sampleRate) || sampleRate < 8000) { await ack({ ended: false, contextState: "unavailable", muted: false, playedMs: 0 }); return; }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextClass !== "function") { await ack({ ended: false, contextState: "unavailable", muted: false, playedMs: 0 }); return; }
    stopObservedAudio();
    const ticket = audio.current.ticket;
    try {
      const context = audio.current.context || new AudioContextClass();
      audio.current.context = context;
      if (context.state === "suspended") await context.resume();
      if (context.state !== "running") { await ack({ ended: false, contextState: context.state, muted: false, playedMs: 0 }); return; }
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      audio.current.source = source;
      const startedAt = context.currentTime;
      setVoiceStage({ stage: event.payload.stage, status: "running" });
      source.onended = () => {
        if (audio.current.ticket !== ticket) return;
        audio.current.source = null;
        const playedMs = Math.max(0, (context.currentTime - startedAt) * 1000);
        void ack({ ended: true, contextState: context.state, muted: false, playedMs });
      };
      source.start();
    } catch {
      await ack({ ended: false, contextState: audio.current.context?.state || "unavailable", muted: false, playedMs: 0 });
    }
  }

  useEffect(() => {
    alive.current = true;
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert;
    const previousFocus = document.activeElement;
    if (appRoot) appRoot.inert = true;
    document.querySelector('.live-search input')?.focus();
    bridge()?.virtualSeniorLiveCatalog?.().then((items) => { if (alive.current) { setScenarios(items); setSelectedRoundIds(items.find((item) => item.id === "full-journey")?.rounds?.map((item) => item.id) || []); } }).catch((e) => setError(e.message));
    const unsubscribe = bridge()?.onVirtualSeniorLiveEvent?.((event) => {
      const current = active.current;
      if (!current || event.runId !== current.runId || event.sessionId !== current.sessionId || event.residentId !== current.binding.residentId || event.sequence <= lastSequence.current) return;
      lastSequence.current = event.sequence;
      const turnLabel = event.payload.turn ? `第 ${event.payload.turn.index}/${event.payload.turn.total} 轮 · ${event.payload.turn.title}` : "合成数据联调";
      if (event.type === "question" || event.type === "answer") {
        setMessages((items) => [...items, { id: `${event.runId}-${event.sequence}`, sequence: event.sequence, role: event.type === "question" ? "user" : "assistant", text: event.payload.text, title: "", meta: turnLabel, agents: [] }]);
        setStatus(`${turnLabel}：${event.type === "question" ? "正在处理" : label(event.payload.outcome)}`);
      } else if (event.type === "tool-start") setStatus(`${turnLabel}：正在查询合成数据`);
      else if (event.type === "stage") setStatus(`${turnLabel}：${event.payload.label}`);
      else if (event.type === "voice-stage") {
        setVoiceStage({ stage: event.payload.stage, status: event.payload.status, error: event.payload.error || null });
        const stageWords = { "question-tts": "正在合成测试问题", "question-playback": "正在播放测试问题", asr: "正在进行本地语音识别", response: "正在处理识别结果", "answer-tts": "正在合成小安回答", "answer-playback": "正在播放小安回答" };
        setStatus(`${turnLabel}：${stageWords[event.payload.stage] || "正在执行语音测试"}`);
      } else if (event.type === "voice-audio") void playObservedAudio(event);
      else if (["completed", "failed", "cancelled"].includes(event.type)) {
        stopObservedAudio(); setBusy(false); setReport(event.payload.report); active.current = null;
        setStatus(event.type === "completed" ? `本次结束 · ${label(event.payload.report.outcome)}` : label(event.type));
        if (event.type === "failed") setError(event.payload.report.error?.message || "测试失败，请重试");
      }
    });
    return () => { alive.current = false; stopObservedAudio({ close: true }); if (appRoot) appRoot.inert = previousInert; previousFocus?.focus?.(); unsubscribe?.(); if (active.current) void bridge()?.virtualSeniorLiveCancel?.(active.current.runId).catch(() => {}); };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      if (!bridge()?.virtualSeniorResidentSearch) { setLoading(false); setError("请从小安 App 的终端设置打开测试中心"); return; }
      bridge().virtualSeniorResidentSearch({ query, cursor, limit: 4 }).then((value) => { if (current) { setPage(value); setLoading(false); } }).catch((e) => { if (current) { setLoading(false); setError(e.message); } });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [query, cursor, retry]);

  // Confirm a committed product message after two paint opportunities. A
  // background receipt alone must never count as visible interaction evidence.
  useEffect(() => {
    const last = messages.at(-1);
    const current = active.current;
    if (!last || !current) return undefined;
    let second;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (alive.current && active.current?.runId === current.runId && frame.current?.getBoundingClientRect().width > 0 && frame.current.querySelector(`[data-observed-message-id="${last.id}"]`)) {
        const node = frame.current.querySelector(`[data-observed-message-id="${last.id}"]`);
        const stream = frame.current.querySelector('.advisor-chat-stream');
        const rect = node.getBoundingClientRect();
        const visible = stream?.getBoundingClientRect();
        if (visible && rect.bottom > visible.top && rect.top < visible.bottom) void bridge().virtualSeniorLiveAck({ runId: current.runId, sequence: last.sequence }).catch(() => {});
      }
    }); });
    return () => { cancelAnimationFrame(first); if (second) cancelAnimationFrame(second); };
  }, [messages, narrowView]);

  useEffect(() => { if (dialogContent && !dialog.current?.open) dialog.current?.showModal(); }, [dialogContent]);

  async function choose(resident) {
    if (busy) return;
    const request = ++selectRequest.current;
    setSelected(null); setDetailLoading(true); setError(""); setMessages([]); setReport(null); setRun(null);
    try {
      const value = await bridge().virtualSeniorResidentDetail({ residentId: resident.residentId });
      if (alive.current && request === selectRequest.current) { setSelected(value); setStatus("画像已就绪，可以开始测试"); }
    } catch (e) { if (request === selectRequest.current) setError(e.message); }
    finally { if (alive.current && request === selectRequest.current) setDetailLoading(false); }
  }
  async function start() {
    if (!selected || busy || (scenarioId === "full-journey" && !selectedRoundIds.length)) return;
    setRoundPanelOpen(false); setBusy(true); setError(""); setMessages([]); setReport(null); setStatus("正在准备独立测试会话"); setNarrowView("observe");
    let prepared;
    try {
      prepared = await bridge().virtualSeniorLivePrepare({ binding: selected.binding, scenarioId, ...(scenarioId === "full-journey" ? { selectedRoundIds } : {}) });
      if (!alive.current) { await bridge().virtualSeniorLiveCancel(prepared.runId); return; }
      active.current = prepared; lastSequence.current = 0; setRun(prepared); setVoiceStage({ stage: "idle", status: "not-run" });
      await bridge().virtualSeniorLiveBegin(prepared.runId);
    } catch (e) {
      if (prepared) await bridge().virtualSeniorLiveCancel(prepared.runId).catch(() => {});
      active.current = null;
      if (alive.current) { setError(e.message); setBusy(false); setStatus("启动失败，可重试"); }
    }
  }
  async function stop() {
    if (!active.current) return;
    stopObservedAudio();
    setStatus("正在停止本次测试");
    try { await bridge().virtualSeniorLiveCancel(active.current.runId); }
    catch (e) { setError(e.message); }
  }
  async function leave(action) {
    if (busy && !active.current) return;
    if (active.current) await bridge().virtualSeniorLiveCancel(active.current.runId);
    action();
  }
  async function showReports() {
    try { setDialogContent({ kind: "reports", items: await bridge().virtualSeniorLiveReports() }); }
    catch (e) { setError(e.message); }
  }
  async function startRetry(item) {
    if (busy || !item?.runId) return;
    setRoundPanelOpen(false); setBusy(true); setError(""); setMessages([]); setReport(null); setStatus("正在按原记录准备重测"); setNarrowView("observe");
    dialog.current?.close();
    let prepared;
    try {
      const detail = await bridge().virtualSeniorResidentDetail({ residentId: item.residentId });
      prepared = await bridge().virtualSeniorLivePrepareRetry({ reportId: item.runId });
      if (!alive.current) { await bridge().virtualSeniorLiveCancel(prepared.runId); return; }
      setSelected(detail); setScenarioId(prepared.scenario.id);
      if (prepared.selection?.selectedRoundIds) setSelectedRoundIds(prepared.selection.selectedRoundIds);
      active.current = prepared; lastSequence.current = 0; setRun(prepared); setVoiceStage({ stage: "idle", status: "not-run" });
      await bridge().virtualSeniorLiveBegin(prepared.runId);
    } catch (e) {
      if (prepared) await bridge().virtualSeniorLiveCancel(prepared.runId).catch(() => {});
      active.current = null;
      if (alive.current) { setError(e.message); setBusy(false); setStatus("重测准备失败，可稍后重试"); }
    }
  }
  function toggleRound(id) {
    if (busy) return;
    setSelectedRoundIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }
  const resident = selected?.resident;
  const vitals = selected?.health?.labels?.vitalSigns || [];
  const fullScenario = scenarios.find((item) => item.id === "full-journey");
  const fullRounds = fullScenario?.rounds || [];
  const requiredRoundIds = new Set(selectedRoundIds);
  const byId = new Map(fullRounds.map((item) => [item.id, item]));
  const includeDependency = (id) => { const dependency = byId.get(id)?.dependsOn; if (dependency && !requiredRoundIds.has(dependency)) { requiredRoundIds.add(dependency); includeDependency(dependency); } };
  selectedRoundIds.forEach(includeDependency);
  const prerequisiteCount = [...requiredRoundIds].filter((id) => !selectedRoundIds.includes(id)).length;
  const reportTone = (item) => item?.acceptance?.status === "failed" || item?.status === "failed" || item?.outcome === "partial_failure" ? "is-failed" : item?.acceptance?.status === "blocked" || ["auth_required", "denied", "journey_partial", "blocked"].includes(item?.outcome) ? "is-blocked" : item?.acceptance?.status === "passed" ? "is-passed" : "";
  return createPortal(<section className="live-observer" role="dialog" aria-modal="true" aria-label="虚拟长者单人测试中心" onKeyDown={(event) => {
    if (event.key !== "Tab" || dialog.current?.open) return;
    const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter((item) => item.getClientRects().length);
    const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
    if (target) { event.preventDefault(); target.focus(); }
  }}>
    <header className="live-header">
      <div className="live-brand"><Flask weight="duotone" /><div><strong>虚拟长者测试</strong><small>单人观察工作台</small></div></div>
      <nav aria-label="测试模式"><button className="is-active" aria-current="page">单人观察</button><button onClick={() => leave(onBatch)} disabled={busy && !active.current}>批量测试</button></nav>
      <div className="live-safety"><span>仅合成数据</span><button aria-label="退出测试中心" onClick={() => leave(onClose)} disabled={busy && !active.current}><X /></button></div>
    </header>
    <div className="live-mobile-tabs"><button aria-pressed={narrowView === "select"} onClick={() => setNarrowView("select")}>选择画像</button><button aria-pressed={narrowView === "observe"} onClick={() => setNarrowView("observe")}>观察界面</button></div>
    <div className={`live-workspace is-${narrowView}`}>
      <section className="live-controls" aria-labelledby="live-select-title">
        <div className="live-section-heading"><div><h1 id="live-select-title">选择测试画像</h1><p>从社区居民库选一个人，观察完整交互。</p></div><span>{page?.dataset?.profile === "community-full" ? "10,000 位" : "合成社区"}</span></div>
        <label className="live-search"><MagnifyingGlass /><input aria-label="搜索模拟姓名、居民编号或 ID" placeholder="搜索模拟姓名、编号或 ID，如 周安宁" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setCursor(null); }} /><button aria-label="清空搜索" disabled={busy || !query} onClick={() => { setQuery(""); setCursor(null); }}><X /></button></label>
        <div className="live-residents" aria-label="社区居民" aria-busy={loading}>
          {loading ? <p className="live-empty" role="status">正在查找合成长者…</p> : page?.items?.length ? page.items.map((item) => <button key={item.residentId} disabled={busy} aria-pressed={resident?.residentId === item.residentId} className={`live-resident ${resident?.residentId === item.residentId ? "is-selected" : ""}`} onClick={() => choose(item)}>
            <UserCircle weight="duotone" /><span><strong>{item.displayName}<em>{item.profile.age} 岁</em></strong><small>{item.displayCode} · {label(item.health.state)} · {label(item.profile.permissionState)}</small></span>{resident?.residentId === item.residentId ? <CheckCircle weight="fill" /> : <ArrowRight />}
          </button>) : <p className="live-empty">没有匹配的居民。请检查编号或清空搜索。</p>}
        </div>
        <div className="live-pagination"><span>{loading ? "正在加载" : `匹配 ${page?.total || 0} 位`}</span><div><button aria-label="返回第一页" disabled={busy || loading || !cursor} onClick={() => setCursor(null)}><ArrowLeft /></button><button aria-label="下一页居民" disabled={busy || loading || !page?.nextCursor} onClick={() => setCursor(page.nextCursor)}><ArrowRight /></button></div></div>
        <section className="live-selected" aria-label="选中画像摘要"><div><strong>{detailLoading ? "正在读取画像…" : resident ? `${resident.displayName} · 合成画像` : "尚未选择画像"}</strong><button disabled={!resident || busy} onClick={() => setDialogContent({ kind: "health" })}>查看资料</button></div>{resident ? <dl><div><dt>居民编号</dt><dd>{resident.displayCode}</dd></div><div><dt>说话速度</dt><dd>{label(resident.profile.speechPace)}</dd></div><div><dt>健康资料</dt><dd>{label(resident.health.state)}</dd></div></dl> : <p>选择具体居民后，测试将绑定此人的资料与权限。</p>}</section>
        <label className="live-scenario">测试场景<select aria-label="测试场景" value={scenarioId} disabled={busy} onChange={(e) => setScenarioId(e.target.value)}>{scenarios.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>{scenarioId === "full-journey" && <small>覆盖 5 个 MCP、16 个工具；每一项都执行本地语音测试。</small>}</label>
        {scenarioId === "full-journey" && <section className={`live-rounds ${!selectedRoundIds.length ? "is-invalid" : ""}`} aria-label="测试轮次选择">
          <button className="live-rounds-summary" aria-expanded={roundPanelOpen} onClick={() => setRoundPanelOpen((value) => !value)} disabled={busy}>
            <span><strong>测试轮次</strong><small>{selectedRoundIds.length ? `已选 ${selectedRoundIds.length} 项${prerequisiteCount ? `，自动补齐 ${prerequisiteCount} 个前置项` : ""}，实际执行 ${requiredRoundIds.size} 轮` : "尚未选择，不能开始测试"}</small></span>
            <span>{selectedRoundIds.length === fullRounds.length ? "全部 22 项" : selectedRoundIds.length === 1 ? "单项" : "多选"}<ArrowRight /></span>
          </button>
          {roundPanelOpen && <div className="live-round-picker">
            <div className="live-round-picker-actions"><button disabled={busy || selectedRoundIds.length === fullRounds.length} onClick={() => setSelectedRoundIds(fullRounds.map((item) => item.id))}><CheckSquare />全选 22 项</button><button disabled={busy || !selectedRoundIds.length} onClick={() => setSelectedRoundIds([])}><Square />清空</button></div>
            <div className="live-round-list">{fullRounds.map((item, index) => { const checked = selectedRoundIds.includes(item.id); const prerequisite = !checked && requiredRoundIds.has(item.id); return <label className={checked ? "is-selected" : prerequisite ? "is-prerequisite" : ""} key={item.id}><input type="checkbox" checked={checked} disabled={busy} onChange={() => toggleRound(item.id)} /><span><strong>{index + 1}. {item.title}</strong><small>{prerequisite ? "将作为所选项目的前置轮次自动执行" : item.tool.split(".").at(-1)}</small></span></label>; })}</div>
          </div>}
        </section>}
        {error && <div className="live-error" role="alert"><span>{error}</span><button disabled={busy} onClick={() => { setError(""); setRetry((value) => value + 1); }}>重试加载</button></div>}
        <footer className="live-actions"><button className="live-primary" disabled={(!resident || !ProductSurface || !scenarios.length || scenarioId === "full-journey" && !selectedRoundIds.length) && !busy || busy && !active.current} onClick={busy ? stop : start}>{busy ? <Stop weight="fill" /> : <Play weight="fill" />}{busy ? "停止测试" : report ? "再次测试" : "开始测试"}</button><div><span role="status">{status}</span><button onClick={showReports} disabled={busy}>测试记录</button></div></footer>
      </section>
      <section className="live-observation" aria-labelledby="live-observe-title">
        <div className="live-section-heading"><div><h2 id="live-observe-title">小安实时交互</h2><p>{run ? `${run.binding.displayName} · ${run.scenario.title}${run.selection ? ` · 执行 ${run.selection.executionCount} 轮` : ""}` : "开始后，在这里查看实际产品的问答与语音过程"}</p></div><span className={busy ? "is-running" : ""}>{busy ? "运行中" : "只读观察"}</span></div>
        <div className="live-product-frame" ref={frame} data-run-id={run?.runId || ""}><div className="advisor-shell advisor-screen-conversation live-product-shell">{ProductSurface ? <ProductSurface messages={messages} response={null} onQuestion={() => {}} composerProps={{ voiceState: "idle", draft: "" }} avatarProps={{ listening: voiceStage.stage === "asr" && voiceStage.status === "running", speaking: voiceStage.stage === "answer-playback" && voiceStage.status === "running", preparing: ["question-tts", "answer-tts"].includes(voiceStage.stage) && voiceStage.status === "running", status: busy ? "合成测试 · 本地语音回环" : "合成测试 · 等待开始" }} observationStatus={status} /> : <p>产品观察组件未加载，请从 App 进入。</p>}</div></div>
        <div className={`live-observer-note ${reportTone(report)}`}><span><SpeakerHigh /> 必测语音：{busy ? label(voiceStage.status === "running" ? "running" : voiceStage.status) : report ? label(report.acceptance?.status || "blocked") : "等待开始"}<small>麦克风与现场扬声器声学效果需实机另验</small></span>{busy && <button className="live-mobile-stop" onClick={stop}>停止测试</button>}{report && <button onClick={() => setDialogContent({ kind: "report", item: report })}>查看本次结果</button>}</div>
      </section>
    </div>
    <dialog ref={dialog} className="live-detail" onClose={() => setDialogContent(null)}>
      <header><h2>{dialogContent?.kind === "health" ? `${resident?.displayName || resident?.displayCode} 的合成资料` : "单人测试记录"}</h2><button aria-label="关闭资料" onClick={() => dialog.current.close()}><X /></button></header>
      {dialogContent?.kind === "health" ? <><p>仅测试数据，不是本人健康档案。指标枚举为测试专用，生产合同尚未确认。</p><dl className="live-detail-profile"><div><dt>模拟姓名</dt><dd>{resident?.displayName}</dd></div><div><dt>居民 ID</dt><dd>{resident?.residentId}</dd></div><div><dt>授权状态</dt><dd>{label(resident?.profile.permissionState)}</dd></div><div><dt>数据质量</dt><dd>{label(resident?.profile.dataQuality)}</dd></div></dl><h3>健康体征</h3>{vitals.length ? <table><thead><tr><th>指标</th><th>记录值</th><th>记录日期</th></tr></thead><tbody>{vitals.map((item) => <tr key={item.evidenceId}><td>{item.displayName}</td><td>{item.value} {item.unit}</td><td>{item.observedAt.slice(0, 10)}</td></tr>)}</tbody></table> : <p>没有可用体征记录，不用默认数值填充。</p>}<p>健康测评：{selected?.health?.evaluations?.results?.length || 0} 份。未作临床判断。</p></> : dialogContent?.kind === "reports" ? <><p>最近 50 次单人运行独立保存，不与批量通过率混算；点击一条记录可查看原因并重新测试。</p>{dialogContent.items.length ? dialogContent.items.map((item) => <button className={`live-report-row ${reportTone(item)}`} key={item.runId} onClick={() => setDialogContent({ kind: "report", item })}><span><strong>{item.binding.displayName || item.binding.displayCode}</strong><small>{item.binding.displayCode}{item.retryOf ? " · 重测记录" : ""}</small></span><span>{item.acceptance?.status === "failed" ? <WarningCircle weight="fill" /> : item.acceptance?.status === "blocked" ? <WarningCircle /> : <CheckCircle weight="fill" />}{label(item.acceptance?.status || item.outcome || item.status)}</span><small>{new Date(item.startedAt).toLocaleString("zh-CN")}</small></button>) : <p>还没有测试记录。</p>}</> : dialogContent?.item ? <><div className={`live-result-banner ${reportTone(dialogContent.item)}`}><span>{dialogContent.item.acceptance?.status === "passed" ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}</span><div><strong>{label(dialogContent.item.acceptance?.status || dialogContent.item.outcome || dialogContent.item.status)}</strong><p>{dialogContent.item.acceptance?.message || "该记录没有完整验收说明。"}</p></div><button onClick={() => startRetry(dialogContent.item)} disabled={busy}><ArrowClockwise />重新测试</button></div><p>{dialogContent.item.binding.displayName || dialogContent.item.binding.displayCode} · {dialogContent.item.binding.displayCode} · {dialogContent.item.durationMs} ms{dialogContent.item.retryOf ? ` · 来源 ${dialogContent.item.retryOf.slice(0, 13)}…` : ""}</p><p>右侧已呈现 {dialogContent.item.coverage?.renderedTurns ?? 0} 轮；本地语音回环 {label(dialogContent.item.acceptance?.status || "blocked")}。麦克风、现场扬声器声学效果、生产服务仍需分别验证。</p>{dialogContent.item.coverage && <><h3>本次覆盖</h3><p>已呈现 {dialogContent.item.coverage.renderedTurns}/{dialogContent.item.coverage.totalTurns} 轮；实际调用 {dialogContent.item.coverage.calledMcp}/{dialogContent.item.coverage.plannedMcp} 个 MCP、{dialogContent.item.coverage.calledTools}/{dialogContent.item.coverage.plannedTools} 个工具，成功 {dialogContent.item.coverage.successfulTools} 个工具。</p><p>完整通过 {dialogContent.item.coverage.completedTurns} 轮，受阻 {dialogContent.item.coverage.blockedTurns} 轮，失败 {dialogContent.item.coverage.failedTurns} 轮，未执行 {dialogContent.item.coverage.skippedTurns} 轮；语音通过 {dialogContent.item.coverage.voicePassedTurns || 0} 轮、语音受阻 {dialogContent.item.coverage.voiceBlockedTurns || 0} 轮、语音失败 {dialogContent.item.coverage.voiceFailedTurns || 0} 轮。</p><table aria-label="逐轮测试结果"><thead><tr><th>轮次 / 场景</th><th>业务结果</th><th>语音</th><th>查询耗时</th></tr></thead><tbody>{dialogContent.item.turns?.map((item) => <tr className={item.status === "failed" ? "is-failed" : item.status === "blocked" || ["denied", "auth_required"].includes(item.status) ? "is-blocked" : ""} key={item.id}><td>{item.index}. {item.title}{item.selectionReason === "prerequisite" ? <small>前置轮次</small> : null}</td><td>{label(item.businessStatus || item.status)}</td><td>{label(item.voice?.status || "blocked")}{item.voice?.error?.message ? <small>{item.voice.error.message}</small> : null}</td><td>{item.queryMs == null ? "未查询" : `${item.queryMs} ms`}</td></tr>)}</tbody></table><details><summary>查看工具覆盖</summary><table aria-label="工具覆盖明细"><thead><tr><th>工具</th><th>实际调用 / 成功</th></tr></thead><tbody>{dialogContent.item.coverage.tools.map((item) => <tr key={item.tool}><td>{item.title}</td><td>{item.calls} / {item.successes}</td></tr>)}</tbody></table></details></>}{dialogContent.item.persistenceError && <p role="alert">{dialogContent.item.persistenceError}</p>}<details><summary>查看事件和结果明细</summary><pre>{JSON.stringify(dialogContent.item, null, 2)}</pre></details></> : null}
    </dialog>
  </section>, document.body);
}
