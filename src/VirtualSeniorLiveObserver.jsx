import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CheckCircle, Flask, MagnifyingGlass, Play, Stop, UserCircle, X } from "@phosphor-icons/react";
import "./virtual-senior-live.css";

const words = { "verified-self": "本人已授权", anonymous: "匿名", "auth-required": "待身份确认", expired: "授权已过期", "scope-limited": "权限受限", "cross-subject": "非本人", "no-record": "无健康记录", routine: "常规记录", "single-attention": "单项关注", "multi-attention": "多项关注", conflicting: "数据冲突", stale: "记录过期", insufficient: "记录不足", complete: "完整", partial: "部分缺失", slow: "慢速", medium: "适中", fast: "快速", completed: "已完成", auth_required: "需身份授权", denied: "访问被阻止", cancelled: "已停止", failed: "执行失败" };
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
  const [messages, setMessages] = useState([]);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("请选择一位合成长者");
  const [error, setError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [narrowView, setNarrowView] = useState("select");
  const [dialogContent, setDialogContent] = useState(null);
  const [report, setReport] = useState(null);
  const [retry, setRetry] = useState(0);
  const active = useRef(null);
  const alive = useRef(true);
  const lastSequence = useRef(0);
  const dialog = useRef(null);
  const frame = useRef(null);
  const selectRequest = useRef(0);

  useEffect(() => {
    alive.current = true;
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert;
    const previousFocus = document.activeElement;
    if (appRoot) appRoot.inert = true;
    document.querySelector('.live-search input')?.focus();
    bridge()?.virtualSeniorLiveCatalog?.().then((items) => { if (alive.current) setScenarios(items); }).catch((e) => setError(e.message));
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
      else if (["completed", "failed", "cancelled"].includes(event.type)) {
        setBusy(false); setReport(event.payload.report); active.current = null;
        setStatus(event.type === "completed" ? `本次结束 · ${label(event.payload.report.outcome)}` : label(event.type));
        if (event.type === "failed") setError(event.payload.report.error?.message || "测试失败，请重试");
      }
    });
    return () => { alive.current = false; if (appRoot) appRoot.inert = previousInert; previousFocus?.focus?.(); unsubscribe?.(); if (active.current) void bridge()?.virtualSeniorLiveCancel?.(active.current.runId).catch(() => {}); };
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
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessages([]); setReport(null); setStatus("正在准备独立测试会话"); setNarrowView("observe");
    let prepared;
    try {
      prepared = await bridge().virtualSeniorLivePrepare({ binding: selected.binding, scenarioId });
      if (!alive.current) { await bridge().virtualSeniorLiveCancel(prepared.runId); return; }
      active.current = prepared; lastSequence.current = 0; setRun(prepared);
      await bridge().virtualSeniorLiveBegin(prepared.runId);
    } catch (e) {
      if (prepared) await bridge().virtualSeniorLiveCancel(prepared.runId).catch(() => {});
      active.current = null;
      if (alive.current) { setError(e.message); setBusy(false); setStatus("启动失败，可重试"); }
    }
  }
  async function stop() {
    if (!active.current) return;
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
  const resident = selected?.resident;
  const vitals = selected?.health?.labels?.vitalSigns || [];
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
        <label className="live-search"><MagnifyingGlass /><input aria-label="搜索居民编号或 ID" placeholder="搜索居民编号或 ID，如 00248" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setCursor(null); }} /><button aria-label="清空搜索" disabled={busy || !query} onClick={() => { setQuery(""); setCursor(null); }}><X /></button></label>
        <div className="live-residents" aria-label="社区居民" aria-busy={loading}>
          {loading ? <p className="live-empty" role="status">正在查找合成长者…</p> : page?.items?.length ? page.items.map((item) => <button key={item.residentId} disabled={busy} aria-pressed={resident?.residentId === item.residentId} className={`live-resident ${resident?.residentId === item.residentId ? "is-selected" : ""}`} onClick={() => choose(item)}>
            <UserCircle weight="duotone" /><span><strong>{item.displayCode}<em>{item.profile.age} 岁</em></strong><small>{label(item.health.state)} · {label(item.profile.permissionState)}</small></span>{resident?.residentId === item.residentId ? <CheckCircle weight="fill" /> : <ArrowRight />}
          </button>) : <p className="live-empty">没有匹配的居民。请检查编号或清空搜索。</p>}
        </div>
        <div className="live-pagination"><span>{loading ? "正在加载" : `匹配 ${page?.total || 0} 位`}</span><div><button aria-label="返回第一页" disabled={busy || loading || !cursor} onClick={() => setCursor(null)}><ArrowLeft /></button><button aria-label="下一页居民" disabled={busy || loading || !page?.nextCursor} onClick={() => setCursor(page.nextCursor)}><ArrowRight /></button></div></div>
        <section className="live-selected" aria-label="选中画像摘要"><div><strong>{detailLoading ? "正在读取画像…" : resident ? `当前画像 ${resident.displayCode}` : "尚未选择画像"}</strong><button disabled={!resident || busy} onClick={() => setDialogContent({ kind: "health" })}>查看资料</button></div>{resident ? <dl><div><dt>年龄</dt><dd>{resident.profile.age} 岁</dd></div><div><dt>说话速度</dt><dd>{label(resident.profile.speechPace)}</dd></div><div><dt>健康资料</dt><dd>{label(resident.health.state)}</dd></div></dl> : <p>选择具体居民后，测试将绑定此人的资料与权限。</p>}</section>
        <label className="live-scenario">测试场景<select aria-label="测试场景" value={scenarioId} disabled={busy} onChange={(e) => setScenarioId(e.target.value)}>{scenarios.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>{scenarioId === "full-journey" && <small>计划检查 5 个 MCP、16 个工具；权限不足会如实阻止。</small>}</label>
        {error && <div className="live-error" role="alert"><span>{error}</span><button disabled={busy} onClick={() => { setError(""); setRetry((value) => value + 1); }}>重试加载</button></div>}
        <footer className="live-actions"><button className="live-primary" disabled={(!resident || !ProductSurface || !scenarios.length) && !busy || busy && !active.current} onClick={busy ? stop : start}>{busy ? <Stop weight="fill" /> : <Play weight="fill" />}{busy ? "停止测试" : report ? "再次测试" : "开始测试"}</button><div><span role="status">{status}</span><button onClick={showReports} disabled={busy}>测试记录</button></div></footer>
      </section>
      <section className="live-observation" aria-labelledby="live-observe-title">
        <div className="live-section-heading"><div><h2 id="live-observe-title">小安实时交互</h2><p>{run ? `${run.binding.displayCode} · ${run.scenario.title}` : "开始后，在这里查看实际产品的问答过程"}</p></div><span className={busy ? "is-running" : ""}>{busy ? "运行中" : "只读观察"}</span></div>
        <div className="live-product-frame" ref={frame} data-run-id={run?.runId || ""}><div className="advisor-shell advisor-screen-conversation live-product-shell">{ProductSurface ? <ProductSurface messages={messages} response={null} onQuestion={() => {}} composerProps={{ voiceState: "idle", draft: "" }} avatarProps={{ listening: false, speaking: false, preparing: false, status: "合成测试 · 文本联调" }} observationStatus={status} /> : <p>产品观察组件未加载，请从 App 进入。</p>}</div></div>
        <div className="live-observer-note"><span>文本联调 · 未运行语音和口型测试</span>{busy && <button className="live-mobile-stop" onClick={stop}>停止测试</button>}{report && <button onClick={() => setDialogContent({ kind: "report", item: report })}>查看本次结果</button>}</div>
      </section>
    </div>
    <dialog ref={dialog} className="live-detail" onClose={() => setDialogContent(null)}>
      <header><h2>{dialogContent?.kind === "health" ? `${resident?.displayCode} 的合成资料` : "单人测试记录"}</h2><button aria-label="关闭资料" onClick={() => dialog.current.close()}><X /></button></header>
      {dialogContent?.kind === "health" ? <><p>仅测试数据，不是本人健康档案。指标枚举为测试专用，生产合同尚未确认。</p><dl className="live-detail-profile"><div><dt>居民 ID</dt><dd>{resident?.residentId}</dd></div><div><dt>授权状态</dt><dd>{label(resident?.profile.permissionState)}</dd></div><div><dt>数据质量</dt><dd>{label(resident?.profile.dataQuality)}</dd></div></dl><h3>健康体征</h3>{vitals.length ? <table><thead><tr><th>指标</th><th>记录值</th><th>记录日期</th></tr></thead><tbody>{vitals.map((item) => <tr key={item.evidenceId}><td>{item.displayName}</td><td>{item.value} {item.unit}</td><td>{item.observedAt.slice(0, 10)}</td></tr>)}</tbody></table> : <p>没有可用体征记录，不用默认数值填充。</p>}<p>健康测评：{selected?.health?.evaluations?.results?.length || 0} 份。未作临床判断。</p></> : dialogContent?.kind === "reports" ? <><p>最近 50 次单人运行独立保存，不与批量通过率混算。</p>{dialogContent.items.length ? dialogContent.items.map((item) => <button className="live-report-row" key={item.runId} onClick={() => setDialogContent({ kind: "report", item })}><strong>{item.binding.displayCode}</strong><span>{label(item.outcome || item.status)}</span><small>{new Date(item.startedAt).toLocaleString("zh-CN")}</small></button>) : <p>还没有测试记录。</p>}</> : dialogContent?.item ? <><p>{dialogContent.item.binding.displayCode} · {label(dialogContent.item.outcome || dialogContent.item.status)} · {dialogContent.item.durationMs} ms</p><p>右侧已呈现 {dialogContent.item.renderedSequences.length} 条消息；语音、口型、生产服务未运行。</p>{dialogContent.item.coverage && <><h3>本次覆盖</h3><p>已呈现 {dialogContent.item.coverage.renderedTurns}/{dialogContent.item.coverage.totalTurns} 轮；实际调用 {dialogContent.item.coverage.calledMcp}/{dialogContent.item.coverage.plannedMcp} 个 MCP、{dialogContent.item.coverage.calledTools}/{dialogContent.item.coverage.plannedTools} 个工具，成功 {dialogContent.item.coverage.successfulTools} 个工具。</p><p>成功 {dialogContent.item.coverage.completedTurns} 轮，权限阻止 {dialogContent.item.coverage.blockedTurns} 轮，失败 {dialogContent.item.coverage.failedTurns} 轮，未执行 {dialogContent.item.coverage.skippedTurns} 轮。观察停留时间不计入每轮查询耗时。</p><table aria-label="逐轮测试结果"><thead><tr><th>轮次 / 场景</th><th>结果</th><th>查询耗时</th></tr></thead><tbody>{dialogContent.item.turns?.map((item) => <tr key={item.id}><td>{item.index}. {item.title}</td><td>{label(item.status)}</td><td>{item.queryMs == null ? "未查询" : `${item.queryMs} ms`}</td></tr>)}</tbody></table><details><summary>查看工具覆盖</summary><table aria-label="工具覆盖明细"><thead><tr><th>工具</th><th>实际调用 / 成功</th></tr></thead><tbody>{dialogContent.item.coverage.tools.map((item) => <tr key={item.tool}><td>{item.title}</td><td>{item.calls} / {item.successes}</td></tr>)}</tbody></table></details></>}{dialogContent.item.persistenceError && <p role="alert">{dialogContent.item.persistenceError}</p>}<details><summary>查看事件和结果明细</summary><pre>{JSON.stringify(dialogContent.item, null, 2)}</pre></details></> : null}
    </dialog>
  </section>, document.body);
}
