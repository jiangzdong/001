import { useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ChartBar,
  CheckCircle,
  Clock,
  Database,
  Flask,
  ListChecks,
  Play,
  UserFocus,
  UsersThree,
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

function CommunitySummary({ community }) {
  if (!community) return <section className="virtual-senior-community is-loading" aria-live="polite"><Database weight="duotone" /><span>正在读取合成社区数据集状态</span></section>;
  const target = community.target || community;
  const job = community.job;
  const summary = job?.summary;
  const coverage = summary?.matrix || {};
  const jobLabel = !job ? "未生成"
    : job.status === "running" ? `${job.stage} ${job.progress?.completed || 0}/${job.progress?.total || 3}`
      : job.status === "paused" ? "已在检查点暂停"
        : job.status === "cancelled" ? "已取消，可从检查点恢复"
          : job.status === "failed" ? "作业失败，可仅重跑失败阶段"
            : summary?.valid ? "已验证" : "验证失败";
  return (
    <section className="virtual-senior-community" aria-label="社区测试数据集摘要">
      <div className="virtual-senior-community__identity"><span><Database weight="duotone" /></span><div><strong>社区测试集 {target.datasetVersion}</strong><small>纯合成 QA 资产 · {jobLabel}</small></div></div>
      <div className="virtual-senior-community__metrics">
        <span><strong>{summary ? Number(summary.residents || 0).toLocaleString("zh-CN") : "未生成"}</strong><small>已验证合成长者</small></span>
        <span><strong>{summary ? Number(summary.totalRecords || 0).toLocaleString("zh-CN") : "未生成"}</strong><small>已验证跨域记录</small></span>
        <span><strong>{summary ? `${Object.keys(summary.dimensions?.mcp || {}).length}/5 MCP` : "未执行"}</strong><small>{summary ? "已连接 MCP" : "尚无运行证据"}</small></span>
        <span><strong>{summary ? `${Object.keys(summary.residentSweep?.byTool || {}).length}/16 Tool` : "未执行"}</strong><small>{summary ? `${coverage.valid || 0}/${coverage.expected || 192} 状态` : "尚无运行证据"}</small></span>
      </div>
      <div className="virtual-senior-community__footer"><span><UsersThree weight="bold" />QA 作业资产，不进入生产包或生产 MCP</span><code>{summary?.manifestHash?.slice(0, 19) || "尚无实际 manifest"}</code></div>
      {job?.reportDirectory && <div className="virtual-senior-community__path"><small>{job.reportDirectory}</small></div>}
    </section>
  );
}

const profiles = [
  ["smoke", "冒烟", "64 人 · 合同与主要异常"],
  ["regression", "日常回归", "1,000 人 · 固定基准"],
  ["community-full", "社区全量", "10,000 人 · 分阶段检查点"],
  ["stress", "压力", "50,000 人 · 独立 QA 报告"],
];

function RunProfile({ value, onChange }) {
  return <section className="virtual-senior-run-profile" aria-label="运行档位">
    <header><span>运行档位</span><small>固定基准与探索结果分开保存</small></header>
    <div>{profiles.map(([id, label, detail]) => <button key={id} type="button" className={value === id ? "is-active" : ""} onClick={() => onChange(id)} aria-pressed={value === id}><strong>{label}</strong><small>{detail}</small></button>)}</div>
  </section>;
}

function CohortFilter({ value, onChange, preview }) {
  const estimated = Number(preview?.residents || 0);
  const update = (key, next) => onChange({ ...value, [key]: next });
  return <section className="virtual-senior-cohort" aria-label="测试人群筛选">
    <header><div><span>测试人群</span><small>按受控画像组合筛选，不混入真实居民</small></div><strong>{estimated.toLocaleString("zh-CN")} 人</strong></header>
    <div className="virtual-senior-cohort__fields">
      <label>年龄<select value={value.age} onChange={(event) => update("age", event.target.value)}><option value="">全部</option><option>60-69</option><option>70-79</option><option>80-89</option><option>90+</option></select></label>
      <label>语速<select value={value.speechPace} onChange={(event) => update("speechPace", event.target.value)}><option value="">全部</option><option>slow</option><option>medium</option><option>fast</option></select></label>
      <label>听力<select value={value.hearing} onChange={(event) => update("hearing", event.target.value)}><option value="">全部</option><option>normal</option><option>mild-difficulty</option><option>difficulty</option></select></label>
      <label>视力<select value={value.vision} onChange={(event) => update("vision", event.target.value)}><option value="">全部</option><option>normal</option><option>large-text</option><option>low-vision</option></select></label>
      <label>数字熟练度<select value={value.digitalLiteracy} onChange={(event) => update("digitalLiteracy", event.target.value)}><option value="">全部</option><option>low</option><option>medium</option><option>high</option></select></label>
      <label>权限<select value={value.permission} onChange={(event) => update("permission", event.target.value)}><option value="">全部</option><option>verified-self</option><option>auth-required</option><option>expired</option><option>scope-limited</option></select></label>
      <label>健康<select value={value.health} onChange={(event) => update("health", event.target.value)}><option value="">全部</option><option>routine</option><option>single-attention</option><option>conflicting</option><option>stale</option></select></label>
      <label>会员<select value={value.member} onChange={(event) => update("member", event.target.value)}><option value="">全部</option><option>non-member</option><option>zero-points</option><option>active</option><option>expiring</option></select></label>
      <label>数据质量<select value={value.quality} onChange={(event) => update("quality", event.target.value)}><option value="">全部</option><option>complete</option><option>partial</option><option>stale</option><option>conflicting</option></select></label>
    </div>
    <small>实际预计 Tool 调用：{Number(preview?.expectedToolCalls || 0).toLocaleString("zh-CN")}</small>
  </section>;
}

function CoverageTree({ community, expanded, onToggle }) {
  const target = community?.target || community;
  const summary = community?.job?.summary;
  const groups = (target?.tools || []).reduce((result, key) => { const [server, tool] = key.split("."); (result[server] ||= []).push(tool); return result; }, {});
  const states = Number(target?.coverage?.statesPerTool || 12);
  const byTool = summary?.residentSweep?.byTool || {};
  const matrix = summary?.matrix;
  return <section className="virtual-senior-coverage" aria-label="MCP Tool 覆盖树">
    <header><div><span>接口覆盖</span><small>{summary ? `实际矩阵 ${matrix?.valid || 0}/${matrix?.expected || 192}` : "尚未执行真实作业"}</small></div><strong>{summary ? `${Object.keys(byTool).length}/16` : "未执行"}</strong></header>
    {Object.entries(groups).map(([server, tools]) => <div className="virtual-senior-coverage__group" key={server}>
      <button type="button" onClick={() => onToggle(server)} aria-expanded={Boolean(expanded[server])}><strong>{server.replace(/_mcp(?:_cms)?$/, "")}</strong><span>{tools.length} Tool · {states} 状态</span></button>
      {expanded[server] && <div>{tools.map((tool) => { const key = `${server}.${tool}`; const item = byTool[key]; const latency = summary?.dimensions?.latency?.perTool?.[key]; return <div key={tool}><button className="virtual-senior-coverage__tool" type="button" onClick={() => onToggle(key)}><span>{tool}</span><small>{item ? `${item.passed}/${item.attempted} sweep` : "未执行"}</small></button>{expanded[key] && <div className="virtual-senior-coverage__detail"><span>成功 {item?.passed || 0} · 失败 {item?.failed || 0}</span><span>状态矩阵 {summary ? `${matrix?.valid || 0}/${matrix?.expected || 192}` : "未生成"}</span><span>{latency ? `P50 ${latency.p50Ms}ms · P95 ${latency.p95Ms}ms · Max ${latency.maxMs}ms` : "尚无实际耗时"}</span><span>{tool.startsWith("list_") ? `分页 ${summary?.pagination?.byTool?.[key]?.valid ? "已验证" : "未验证"}` : tool.startsWith("save_") ? `幂等 ${summary?.idempotency?.valid ? "已验证" : "未验证"}` : "输出合同已验证"}</span></div>}</div>; })}</div>}
    </div>)}
  </section>;
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

function AnalysisPanel({ batch, community, onShowFailed }) {
  const analysis = batch?.analysis;
  const communitySummary = community?.job?.summary;
  if (!analysis && !communitySummary) {
    return (
      <div className="virtual-senior-empty">
        <ChartBar weight="duotone" />
        <strong>运行批次后查看分析</strong>
        <span>这里会汇总通过率、耗时、失败聚类与后续优化建议。</span>
      </div>
    );
  }
  const categoryRows = Object.entries(analysis?.byCategory || {});
  const failureRows = Object.entries(analysis?.failureAssertions || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="virtual-senior-analysis">
      {communitySummary && <section className="virtual-senior-analysis__section">
        <header><div><span>社区作业实证</span><h3>{community?.job?.jobId}</h3></div><small>{communitySummary.valid ? "生成、校验与 sweep 已验证" : "作业尚未通过"}</small></header>
        <div className="virtual-senior-metrics">
          <SummaryMetric label="实体记录" value={Number(communitySummary.totalRecords || 0).toLocaleString("zh-CN")} detail={`${communitySummary.entityReports?.length || 0} 个已校验分片`} tone={communitySummary.valid ? "success" : "warning"} />
          <SummaryMetric label="居民 sweep" value={Number(communitySummary.residentSweep?.executed || 0).toLocaleString("zh-CN")} detail={`${communitySummary.residentSweep?.residents || 0} 人 · ${communitySummary.residentSweep?.failures?.length || 0} 失败`} />
          <SummaryMetric label="状态矩阵" value={`${communitySummary.matrix?.valid || 0}/${communitySummary.matrix?.expected || 192}`} detail={`时间窗 ${communitySummary.dimensions?.timeWindow?.filter((item) => item.valid).length || 0}/5`} />
          <SummaryMetric label="Sweep 耗时" value={`${communitySummary.dimensions?.latency?.elapsedMs || 0} ms`} detail={`${communitySummary.dimensions?.latency?.throughputPerSecond || 0} calls/s · 实测`} />
        </div>
        <div className="virtual-senior-category-table">
          {(communitySummary.entityReports || []).slice(0, 6).map((item) => <div key={item.entity}><span>{item.entity}</span><strong>{Number(item.records).toLocaleString("zh-CN")}</strong><small>{item.schemaFailures === 0 ? "Schema / FK 通过" : "需检查"}</small></div>)}
        </div>
      </section>}
      {analysis && <>
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
        <div className="virtual-senior-analysis__lanes"><span><strong>固定基准</strong>{analysis.lanes?.fixed?.passed || 0}/{analysis.lanes?.fixed?.total || 0}</span><span><strong>探索变体</strong>{analysis.lanes?.exploratory?.passed || 0}/{analysis.lanes?.exploratory?.total || 0}</span></div>
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
        <header><div><span>可下钻统计</span><h3>居民、Tool 与边界覆盖</h3></div></header>
        <div className="virtual-senior-category-table">
          <div><span>Tool</span><strong>{Object.keys(analysis.dimensions?.tool || {}).length}/16</strong><small>当前批次实际调用</small></div>
          <div><span>权限</span><strong>{Object.keys(analysis.dimensions?.permission || {}).length}</strong><small>权限状态分组</small></div>
          <div><span>时间窗</span><strong>{Object.keys(analysis.dimensions?.timeWindow || {}).length}</strong><small>时间边界分组</small></div>
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
      </section></>}

      {communitySummary && <section className="virtual-senior-analysis__section">
        <header><div><span>覆盖下钻</span><h3>数据、合同与边界维度</h3></div></header>
        <div className="virtual-senior-category-table">
          <div><span>字段合同</span><strong>{Object.keys(communitySummary.dimensions?.field || {}).length}/16</strong><small>真实成功输出字段</small></div>
          <div><span>权限状态</span><strong>{Object.values(communitySummary.dimensions?.permission || {}).reduce((sum, value) => sum + value, 0)}</strong><small>认证 / 拒绝 / 跨机构</small></div>
          <div><span>分页</span><strong>{communitySummary.dimensions?.pagination?.valid ? "通过" : "未验证"}</strong><small>充值 / 消费 / 活动的首页、末页、空页、重放、非法游标</small></div>
          <div><span>失败簇</span><strong>{communitySummary.dimensions?.failureCluster?.length || 0}</strong><small>按当前 sweep 记录</small></div>
          {Object.entries(communitySummary.invariants || {}).map(([name, item]) => <div key={name}><span>{name}</span><strong>{item.valid ? "通过" : "失败"}</strong><small>{item.actual || 0}/{item.expected || 0} · {item.failures?.length || 0} 异常</small></div>)}
        </div>
      </section>}
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
  const [community, setCommunity] = useState(null);
  const [profile, setProfile] = useState("smoke");
  const [cohort, setCohort] = useState({ age: "", speechPace: "", hearing: "", vision: "", digitalLiteracy: "", permission: "", health: "", member: "", quality: "" });
  const [cohortPreview, setCohortPreview] = useState(null);
  const [expandedCoverage, setExpandedCoverage] = useState({});

  useEffect(() => {
    if (!open) return undefined;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    let active = true;
    const bridge = window.kioskBridge;
    Promise.all([bridge?.virtualSeniorCatalog?.(), bridge?.latestVirtualSeniorBatch?.(), bridge?.virtualSeniorCommunityStatus?.()]).then(([nextCatalog, latest, nextCommunity]) => {
      if (!active) return;
      setCatalog(nextCatalog);
      setSelected(new Set(nextCatalog?.scenarios?.map((scenario) => scenario.scenarioId) || []));
      if (latest) setBatch(latest);
      setCommunity(nextCommunity || nextCatalog?.community || null);
    }).catch((error) => { if (active) setMessage(error?.message || "测试目录加载失败"); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    window.kioskBridge?.virtualSeniorCohortPreview?.({ profile, cohort }).then((value) => { if (active) setCohortPreview(value); }).catch(() => { if (active) setCohortPreview(null); });
    return () => { active = false; };
  }, [cohort, open, profile]);

  useEffect(() => {
    const jobId = community?.job?.jobId;
    if (!open || !jobId || community?.job?.status !== "running") return undefined;
    const timer = setInterval(() => window.kioskBridge?.virtualSeniorCommunityJob?.(jobId).then((job) => { if (job) setCommunity((current) => ({ ...current, job })); }), 800);
    return () => clearInterval(timer);
  }, [community?.job?.jobId, community?.job?.status, open]);

  const reportsByScenario = useMemo(() => Object.fromEntries((batch?.reports || []).map((report) => [report.scenarioId, report])), [batch]);
  const visibleScenarios = useMemo(() => (catalog?.scenarios || []).filter((scenario) => {
    if (personaFilter !== "all" && scenario.personaId !== personaFilter) return false;
    if (failedOnly && reportsByScenario[scenario.scenarioId]?.result !== "FAIL") return false;
    return true;
  }), [catalog, failedOnly, personaFilter, reportsByScenario]);

  if (!open) return null;

  const run = async (scenarioIds, resume = false) => {
    if ((!scenarioIds.length && !resume) || running) return;
    const batchId = `batch-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
    setActiveBatchId(batchId);
    setRunning(true);
    setMessage(`正在运行 ${scenarioIds.length} 个场景…`);
    try {
      const result = resume ? await window.kioskBridge.resumeVirtualSeniorBatch(batch.batchId) : await window.kioskBridge.runVirtualSeniorBatch({ batchId, scenarioIds, profile, cohort: { type: "community-filter", ...cohort } });
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

  const startCommunityJob = async () => {
    if (running || community?.job?.status === "running") return;
    const jobId = `community-${profile}-${Date.now()}`;
    try {
      const job = await window.kioskBridge.startVirtualSeniorCommunityJob({ jobId, profile, cohort });
      setCommunity((current) => ({ ...current, job }));
      setMessage(`已启动 ${profile} 数据生成、校验与 Tool sweep`);
    } catch (error) { setMessage(error?.message || "社区作业无法启动"); }
  };

  const controlCommunityJob = async (action) => {
    const jobId = community?.job?.jobId;
    if (!jobId) return;
    try {
      const bridge = window.kioskBridge;
      const result = action === "pause" ? await bridge.pauseVirtualSeniorCommunityJob(jobId)
        : action === "cancel" ? await bridge.cancelVirtualSeniorCommunityJob(jobId)
          : action === "resume" ? await bridge.resumeVirtualSeniorCommunityJob(jobId)
            : await bridge.rerunFailedVirtualSeniorCommunityJob(jobId);
      if (result?.jobId) setCommunity((current) => ({ ...current, job: result }));
      setMessage(action === "pause" ? "将在当前数据阶段完成后暂停" : action === "cancel" ? "已请求取消，检查点将被保留" : action === "resume" ? "正在从检查点恢复" : "正在只重跑失败阶段");
    } catch (error) { setMessage(error?.message || "社区作业控制失败"); }
  };

  const pauseBatch = async () => {
    if (!activeBatchId) return;
    const response = await window.kioskBridge.pauseVirtualSeniorBatch(activeBatchId);
    setMessage(response?.paused ? "已写入检查点，当前 Tool 完成后暂停" : "当前批次无法暂停");
  };

  const rerunFailed = async () => {
    if (!batch?.batchId || running) return;
    setRunning(true);
    try { const result = await window.kioskBridge.rerunFailedVirtualSeniorBatch(batch.batchId); setBatch(result); setTab("analysis"); setMessage("失败项已单独重跑，原始报告保持不变"); }
    catch (error) { setMessage(error?.message || "失败重跑未完成"); }
    finally { setRunning(false); }
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
          <div><span>QA 专用 / 测试数据</span><h2 id="virtual-senior-title">虚拟长者测试</h2><small>与正式会话隔离，不连接生产数据</small></div>
          <button type="button" onClick={onClose} aria-label="退出测试模式"><X weight="bold" /></button>
        </header>

        <CommunitySummary community={community} />

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
            <RunProfile value={profile} onChange={setProfile} />
            <CohortFilter value={cohort} onChange={setCohort} preview={cohortPreview} />
            <CoverageTree community={community} expanded={expandedCoverage} onToggle={(key) => setExpandedCoverage((current) => ({ ...current, [key]: !current[key] }))} />
            <section className="virtual-senior-job-action"><div><strong>社区数据作业</strong><small>真实生成、全量校验与 cohort Tool sweep 分阶段写入 QA 报告</small></div><span className="virtual-senior-job-action__controls">{community?.job?.status === "running" ? <><button type="button" onClick={() => controlCommunityJob("pause")}>阶段后暂停</button><button type="button" onClick={() => controlCommunityJob("cancel")}>取消</button></> : community?.job?.status === "paused" || community?.job?.status === "cancelled" ? <button type="button" onClick={() => controlCommunityJob("resume")}><Play weight="fill" />从检查点恢复</button> : community?.job?.status === "failed" ? <button type="button" onClick={() => controlCommunityJob("retry")}>仅重跑失败阶段</button> : <button type="button" onClick={startCommunityJob}><Play weight="fill" />生成并验证</button>}</span></section>
            <section className="virtual-senior-list-head"><div><span>固定回归场景</span><strong>{visibleScenarios.length} 个</strong></div><button type="button" onClick={() => setSelected(new Set(visibleScenarios.map((scenario) => scenario.scenarioId)))}>全选当前</button></section>
            <ScenarioList scenarios={visibleScenarios} selected={selected} reportsByScenario={reportsByScenario} running={running} onToggle={toggle} onRunOne={(scenarioId) => run([scenarioId])} />
          </> : <AnalysisPanel batch={batch} community={community} onShowFailed={() => { setFailedOnly(true); setTab("scenarios"); }} />}
        </div>

        <footer className="virtual-senior-footer">
          <div role="status" aria-live="polite"><span className={running ? "is-running" : ""} /><strong>{message || `${selected.size} 个场景已选择`}</strong></div>
          {tab === "scenarios" ? running
            ? <span className="virtual-senior-footer__actions"><button type="button" onClick={pauseBatch}>暂停并保存</button><button className="is-cancel" type="button" onClick={cancelBatch}><X weight="bold" />停止批次</button></span>
            : batch?.status === "paused" || batch?.status === "cancelled"
              ? <button type="button" onClick={() => run([], true)}><Play weight="fill" />从检查点恢复</button>
            : <button type="button" disabled={selected.size === 0} onClick={() => run([...selected])}><Play weight="fill" />{`运行所选 ${selected.size} 项`}</button>
            : <span className="virtual-senior-footer__actions">{analysis?.failed ? <button type="button" disabled={running} onClick={rerunFailed}>失败重跑</button> : null}<button type="button" disabled={running} onClick={() => { setTab("scenarios"); setFailedOnly(false); }}><ArrowCounterClockwise weight="bold" />返回场景</button></span>}
        </footer>
      </aside>
    </div>
  );
}
