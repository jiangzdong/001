import { useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ChartBar,
  CheckCircle,
  Clock,
  Flask,
  ListChecks,
  Play,
  UserFocus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const categoryTone = {
  路由: "blue",
  权限: "violet",
  MCP: "teal",
  恢复: "amber",
  合同: "indigo",
  性能: "slate",
};

function formatDuration(value) {
  const milliseconds = Number(value) || 0;
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} 秒` : `${milliseconds} ms`;
}

function PersonaButton({ persona, active, onClick }) {
  return (
    <button className={`virtual-senior-persona ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      <span className="virtual-senior-persona__icon"><UserFocus weight="duotone" /></span>
      <span>
        <strong>{persona.profile.displayName}</strong>
        <small>{persona.profile.ageBand} 岁 · {persona.profile.speechPace === "slow" ? "慢语速" : persona.profile.speechPace === "fast" ? "快语速" : "中等语速"}</small>
      </span>
    </button>
  );
}

function SummaryMetric({ label, value, detail, tone = "default" }) {
  return (
    <div className={`virtual-senior-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ScenarioList({ scenarios, selected, reportsByScenario, running, onToggle, onRunOne }) {
  return (
    <div className="virtual-senior-scenarios">
      {scenarios.map((scenario) => {
        const report = reportsByScenario[scenario.scenarioId];
        const checked = selected.has(scenario.scenarioId);
        return (
          <article className={`virtual-senior-scenario ${checked ? "is-selected" : ""}`} key={scenario.scenarioId}>
            <button className="virtual-senior-scenario__select" type="button" onClick={() => onToggle(scenario.scenarioId)} aria-pressed={checked} aria-label={`${checked ? "取消选择" : "选择"}${scenario.title}`}>
              <span className="virtual-senior-checkbox">{checked && <CheckCircle weight="fill" />}</span>
              <span className="virtual-senior-scenario__copy">
                <span className={`virtual-senior-category is-${categoryTone[scenario.category] || "slate"}`}>{scenario.category}</span>
                <strong>{scenario.title}</strong>
                <small>{scenario.summary}</small>
                <code>{scenario.scenarioId}</code>
              </span>
            </button>
            <div className="virtual-senior-scenario__result">
              {report ? (
                <span className={report.result === "PASS" ? "is-pass" : "is-fail"}>
                  {report.result === "PASS" ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
                  {report.result}
                </span>
              ) : <span className="is-pending">未运行</span>}
              <button type="button" disabled={running} onClick={() => onRunOne(scenario.scenarioId)} aria-label={`单独运行${scenario.title}`}>
                <Play weight="fill" />运行
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AnalysisPanel({ batch, onShowFailed }) {
  const analysis = batch?.analysis;
  if (!analysis) {
    return (
      <div className="virtual-senior-empty">
        <ChartBar weight="duotone" />
        <strong>运行批次后查看分析</strong>
        <span>这里会汇总通过率、耗时、失败聚类与后续优化建议。</span>
      </div>
    );
  }
  const categoryRows = Object.entries(analysis.byCategory || {});
  const failureRows = Object.entries(analysis.failureAssertions || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="virtual-senior-analysis">
      <section className="virtual-senior-analysis__section">
        <header><div><span>批次表现</span><h3>{batch.batchId}</h3></div><small>{batch.createdAt ? new Date(batch.createdAt).toLocaleString("zh-CN", { hour12: false }) : "刚刚完成"}</small></header>
        <div className="virtual-senior-metrics">
          <SummaryMetric label="通过率" value={`${analysis.passRate}%`} detail={`${analysis.passed}/${analysis.total} 通过`} tone={analysis.failed ? "warning" : "success"} />
          <SummaryMetric label="P95 耗时" value={formatDuration(analysis.duration?.p95Ms)} detail={`最长 ${formatDuration(analysis.duration?.maxMs)}`} />
          <SummaryMetric label="场景覆盖" value={`${analysis.coverage?.scenarios || 0}`} detail={`${analysis.coverage?.personas || 0} 个画像`} />
        </div>
        {analysis.trend && <div className={`virtual-senior-trend ${analysis.trend.deltaPassRate < 0 ? "is-down" : "is-up"}`}>
          <ArrowCounterClockwise weight="bold" />较上一批次 {analysis.trend.deltaPassRate >= 0 ? "+" : ""}{analysis.trend.deltaPassRate}%
        </div>}
      </section>

      <section className="virtual-senior-analysis__section">
        <header><div><span>分类结果</span><h3>定位薄弱环节</h3></div>{analysis.failed > 0 && <button type="button" onClick={onShowFailed}>只看失败</button>}</header>
        <div className="virtual-senior-category-table">
          {categoryRows.map(([name, value]) => (
            <div key={name}>
              <span className={`virtual-senior-category is-${categoryTone[name] || "slate"}`}>{name}</span>
              <strong>{value.passed}/{value.total}</strong>
              <small>{value.failed ? `${value.failed} 个失败` : "全部通过"}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="virtual-senior-analysis__section">
        <header><div><span>失败诊断</span><h3>{analysis.failed ? "按断言与错误码聚类" : "本批次无硬断言失败"}</h3></div></header>
        {analysis.failed ? <div className="virtual-senior-diagnostics">
          {failureRows.map(([name, count]) => <div key={name}><code>{name}</code><strong>{count} 次</strong></div>)}
          {Object.entries(analysis.errorCodes || {}).map(([name, count]) => <div key={name}><code>{name}</code><strong>{count} 次</strong></div>)}
        </div> : <div className="virtual-senior-success-note"><CheckCircle weight="fill" /><span>路由、权限、MCP 事实来源、故障恢复和性能边界均通过当前固定基准。</span></div>}
      </section>

      <section className="virtual-senior-analysis__section">
        <header><div><span>后续优化</span><h3>按影响优先处理</h3></div></header>
        <div className="virtual-senior-recommendations">
          {(analysis.recommendations || []).map((item) => <div key={`${item.priority}-${item.cluster}`}><b>{item.priority}</b><span><strong>{item.cluster}</strong><small>{item.action}</small></span></div>)}
        </div>
        {batch.reportDirectory && <div className="virtual-senior-report-path"><span>报告已保存</span><code>{batch.reportDirectory}</code></div>}
      </section>
    </div>
  );
}

export function VirtualSeniorTestConsole({ open, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [personaFilter, setPersonaFilter] = useState("all");
  const [tab, setTab] = useState("scenarios");
  const [batch, setBatch] = useState(null);
  const [running, setRunning] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState("");
  const [message, setMessage] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    let active = true;
    const bridge = window.kioskBridge;
    Promise.all([bridge?.virtualSeniorCatalog?.(), bridge?.latestVirtualSeniorBatch?.()]).then(([nextCatalog, latest]) => {
      if (!active) return;
      setCatalog(nextCatalog);
      setSelected(new Set(nextCatalog?.scenarios?.map((scenario) => scenario.scenarioId) || []));
      if (latest) setBatch(latest);
    }).catch((error) => { if (active) setMessage(error?.message || "测试目录加载失败"); });
    return () => { active = false; };
  }, [open]);

  const reportsByScenario = useMemo(() => Object.fromEntries((batch?.reports || []).map((report) => [report.scenarioId, report])), [batch]);
  const visibleScenarios = useMemo(() => (catalog?.scenarios || []).filter((scenario) => {
    if (personaFilter !== "all" && scenario.personaId !== personaFilter) return false;
    if (failedOnly && reportsByScenario[scenario.scenarioId]?.result !== "FAIL") return false;
    return true;
  }), [catalog, failedOnly, personaFilter, reportsByScenario]);

  if (!open) return null;

  const run = async (scenarioIds) => {
    if (!scenarioIds.length || running) return;
    const batchId = `batch-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
    setActiveBatchId(batchId);
    setRunning(true);
    setMessage(`正在运行 ${scenarioIds.length} 个场景…`);
    try {
      const result = await window.kioskBridge.runVirtualSeniorBatch({ batchId, scenarioIds });
      setBatch(result);
      setFailedOnly(false);
      setTab("analysis");
      setMessage(result.cancelled ? `批次已停止：已完成 ${result.analysis?.total || 0} 项` : result.analysis?.failed ? `批次完成：${result.analysis.failed} 个场景需要检查` : "批次完成：全部硬断言通过");
    } catch (error) {
      setMessage(error?.message || "批量测试失败");
    } finally {
      setRunning(false);
      setActiveBatchId("");
    }
  };

  const cancelBatch = async () => {
    if (!running || !activeBatchId) return;
    const response = await window.kioskBridge.cancelVirtualSeniorRun(activeBatchId);
    setMessage(response?.cancelled ? "正在停止当前批次…" : "当前批次即将完成，未执行停止");
  };

  const toggle = (scenarioId) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(scenarioId)) next.delete(scenarioId); else next.add(scenarioId);
    return next;
  });

  const analysis = batch?.analysis;
  return (
    <div className="virtual-senior-scrim" role="presentation">
      <aside className="virtual-senior-console" role="dialog" aria-modal="true" aria-labelledby="virtual-senior-title">
        <header className="virtual-senior-header">
          <span className="virtual-senior-header__icon"><Flask weight="duotone" /></span>
          <div><span>QA 专用 · TEST FIXTURE</span><h2 id="virtual-senior-title">虚拟长者测试</h2><small>与正式会话隔离，不连接生产数据</small></div>
          <button type="button" onClick={onClose} aria-label="退出测试模式"><X weight="bold" /></button>
        </header>

        {analysis && <div className={`virtual-senior-summary-strip ${analysis.failed ? "has-failures" : "is-passed"}`}>
          {analysis.failed ? <WarningCircle weight="fill" /> : <CheckCircle weight="fill" />}
          <strong>{analysis.passRate}%</strong>
          <span>{analysis.passed}/{analysis.total} 通过</span>
          <span><Clock weight="bold" />P95 {formatDuration(analysis.duration?.p95Ms)}</span>
        </div>}

        <nav className="virtual-senior-tabs" aria-label="测试工作区">
          <button type="button" className={tab === "scenarios" ? "is-active" : ""} onClick={() => setTab("scenarios")}><ListChecks weight="bold" />场景</button>
          <button type="button" className={tab === "analysis" ? "is-active" : ""} onClick={() => setTab("analysis")}><ChartBar weight="bold" />统计分析{analysis?.failed ? <b>{analysis.failed}</b> : null}</button>
        </nav>

        <div className="virtual-senior-body">
          {tab === "scenarios" ? <>
            <section className="virtual-senior-personas" aria-label="虚拟长者画像">
              <header><span>选择画像</span><small>全部均为合成身份</small></header>
              <div>
                <button className={`virtual-senior-persona is-all ${personaFilter === "all" ? "is-active" : ""}`} type="button" onClick={() => setPersonaFilter("all")}><span className="virtual-senior-persona__icon"><ListChecks weight="duotone" /></span><span><strong>全部画像</strong><small>{catalog?.personas?.length || 0} 类测试特征</small></span></button>
                {(catalog?.personas || []).map((persona) => <PersonaButton key={persona.personaId} persona={persona} active={personaFilter === persona.personaId} onClick={() => setPersonaFilter(persona.personaId)} />)}
              </div>
            </section>
            <section className="virtual-senior-list-head"><div><span>固定回归场景</span><strong>{visibleScenarios.length} 个</strong></div><button type="button" onClick={() => setSelected(new Set(visibleScenarios.map((scenario) => scenario.scenarioId)))}>全选当前</button></section>
            <ScenarioList scenarios={visibleScenarios} selected={selected} reportsByScenario={reportsByScenario} running={running} onToggle={toggle} onRunOne={(scenarioId) => run([scenarioId])} />
          </> : <AnalysisPanel batch={batch} onShowFailed={() => { setFailedOnly(true); setTab("scenarios"); }} />}
        </div>

        <footer className="virtual-senior-footer">
          <div role="status" aria-live="polite"><span className={running ? "is-running" : ""} /><strong>{message || `${selected.size} 个场景已选择`}</strong></div>
          {tab === "scenarios" ? running
            ? <button className="is-cancel" type="button" onClick={cancelBatch}><X weight="bold" />停止批次</button>
            : <button type="button" disabled={selected.size === 0} onClick={() => run([...selected])}><Play weight="fill" />{`运行所选 ${selected.size} 项`}</button>
            : <button type="button" disabled={running} onClick={() => { setTab("scenarios"); setFailedOnly(false); }}><ArrowCounterClockwise weight="bold" />返回场景</button>}
        </footer>
      </aside>
    </div>
  );
}
