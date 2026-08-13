import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bot, Check, Clipboard, Clock3, CloudCog, Database, FileClock, FileText, GitBranch, History, LayoutDashboard, LoaderCircle, Moon, Pause, Play, Plus, RefreshCw, Settings, Sparkles, TimerReset, WandSparkles } from "lucide-react";
import "./App.css";
import "./Onboarding.css";
import "./PhaseOne.css";
import Onboarding from "./Onboarding";
import SettingsPanel from "./SettingsPanel";
import { loadSettings, markOnboardingCompleted, onboardingCompleted, resetOnboarding, saveSettings, type AppSettings } from "./settings";
import { buildAiPrompt, buildReportText } from "./reportExport";
import { recordUsage } from "./usageStats";
import { getCapturePolicy, getMonitorStatus, pauseMonitor, setMonitorEnabled, type MonitorStatus } from "./desktopMonitor";
import ReportsWorkspace from "./ReportsWorkspace";
import AiAssistantPanel from "./AiAssistantPanel";
import ProjectInbox from "./ProjectInbox";
import { localDateKey, shouldGenerateDaily } from "./reportScheduler";
import { fetchLocal } from "./localApi";

type WorkEvent = { id:string; occurredAt:string; sourceType:string; sourceName:string; projectName:string; title:string; summary:string; evidenceLevel:string; durationMinutes:number; includedInReport:boolean };
type Connector = { id:string; name:string; connectorType:string; enabled:boolean; privacyLevel:string; syncStatus:string; lastSyncedAt?:string };
type Report = { id:string; reportDate:string; summary:string; nextPlan:string; targetMinutes:number; status:"DRAFT"|"CONFIRMED"|"SUBMITTED" };
type Dashboard = { date:string; events:WorkEvent[]; connectors:Connector[]; report?:Report; allocatedMinutes:number; targetMinutes:number };

const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:17890/api";
const today = localDateKey();
const sourceIcon = (type:string) => type === "GIT" ? <GitBranch size={17}/> : type === "BROWSER" || type === "JIRA" ? <CloudCog size={17}/> : type === "FILESYSTEM" ? <FileClock size={17}/> : <FileText size={17}/>;
const formatTime = (value:string) => new Intl.DateTimeFormat("zh-CN", { hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value));
const minutesLabel = (minutes:number) => `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分` : ""}`;

export default function App() {
  const [settings,setSettings] = useState<AppSettings>(() => loadSettings());
  const [showOnboarding,setShowOnboarding] = useState(() => !onboardingCompleted());
  const [showSettings,setShowSettings] = useState(false);
  const [supportEmail,setSupportEmail] = useState("");
  const [dashboard,setDashboard] = useState<Dashboard>();
  const [summary,setSummary] = useState("");
  const [nextPlan,setNextPlan] = useState("");
  const [targetMinutes,setTargetMinutes] = useState(() => loadSettings().targetMinutes);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("正在连接本地服务…");
  const [monitorStatus,setMonitorStatus] = useState<MonitorStatus>("UNAVAILABLE");

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const response = await fetchLocal(`${API}/dashboard?date=${today}`);
      if (!response.ok) throw new Error();
      const data:Dashboard = await response.json();
      setDashboard(data); setSummary(data.report?.summary ?? ""); setNextPlan(data.report?.nextPlan ?? "");
      setTargetMinutes(data.report?.targetMinutes ?? settings.targetMinutes ?? data.targetMinutes ?? 480); setNotice("本地数据已同步");
      return true;
    } catch { if (!silent) setNotice("本地服务正在启动，请稍候…"); return false; }
    finally { if (!silent) setBusy(false); }
  }, [settings.targetMinutes]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
        if (await loadDashboard(true)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!cancelled) setBusy(false);
    })();
    void fetch("/app-config.json").then(response => response.json()).then(config => setSupportEmail(config.supportEmail ?? "")).catch(() => setSupportEmail(""));
    return () => { cancelled = true; };
  }, [loadDashboard]);
  useEffect(() => {
    let active = true;
    const refresh = async () => { try { const status = await getMonitorStatus(); if (active) setMonitorStatus(status); } catch { if (active) setMonitorStatus("ERROR"); } };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function updateSettings(next: AppSettings) {
    if (next.monitoringEnabled !== settings.monitoringEnabled) {
      void setMonitorEnabled(next.monitoringEnabled).then(setMonitorStatus).catch(() => setMonitorStatus("ERROR"));
    }
    setSettings(next); saveSettings(next); setTargetMinutes(next.targetMinutes);
  }

  function completeOnboarding(next: AppSettings) {
    updateSettings(next); markOnboardingCompleted(); setShowOnboarding(false);
  }

  async function toggleMonitoring() {
    const enabled = monitorStatus !== "COLLECTING" && monitorStatus !== "IDLE" && monitorStatus !== "PAUSED";
    try {
      const status = await setMonitorEnabled(enabled); setMonitorStatus(status);
      const next = { ...settings, monitoringEnabled: enabled }; setSettings(next); saveSettings(next);
      setNotice(enabled ? "Windows 工作活动监控已开启" : "Windows 工作活动监控已关闭");
    } catch { setMonitorStatus("ERROR"); setNotice("无法修改监控状态"); }
  }

  async function pauseOneHour() {
    try { setMonitorStatus(await pauseMonitor(60)); setNotice("监控已暂停 1 小时"); } catch { setNotice("暂停失败"); }
  }

  async function generateReport() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/reports/daily/generate`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:today,targetMinutes}) });
      if (!response.ok) throw new Error();
      const report:Report = await response.json(); setSummary(report.summary); setNextPlan(report.nextPlan);
      setDashboard(current => current ? {...current,report} : current); setNotice("日报草稿已根据真实工作记录生成");
      recordUsage("generate", settings.localStatistics);
    } catch { setNotice("生成失败，请检查本地后端"); } finally { setBusy(false); }
  }

  useEffect(() => {
    const storageKey = `traceflow.report.generated.${today}`;
    let running = false;
    const check = async () => {
      const policy = await getCapturePolicy().catch(() => null);
      if (running || !shouldGenerateDaily(new Date(), settings.generateAt, localStorage.getItem(storageKey) === "true" || Boolean(dashboard?.report), policy?.excluded_dates, policy?.additional_work_dates)) return;
      running = true;
      try {
        const response = await fetch(`${API}/reports/daily/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: today, targetMinutes }) });
        if (!response.ok) return;
        const report: Report = await response.json();
        localStorage.setItem(storageKey, "true");
        setSummary(report.summary); setNextPlan(report.nextPlan);
        setDashboard(current => current ? { ...current, report } : current);
        setNotice(`${settings.generateAt} 日报草稿已自动生成，请检查后确认`);
        recordUsage("generate", settings.localStatistics);
      } finally { running = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(timer);
  }, [dashboard?.report, settings.generateAt, settings.localStatistics, targetMinutes]);

  async function confirmReport() {
    if (!summary.trim() || !nextPlan.trim()) return setNotice("请补全今日总结和明日计划");
    setBusy(true);
    try {
      const response = await fetch(`${API}/reports/daily/confirm`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:today,summary,nextPlan,targetMinutes}) });
      if (!response.ok) throw new Error();
      const report:Report = await response.json(); setDashboard(current => current ? {...current,report} : current); setNotice("已确认；当前版本请复制后手动提交到企业微信");
      recordUsage("confirm", settings.localStatistics);
    } catch { setNotice("确认失败，请稍后重试"); } finally { setBusy(false); }
  }

  async function addManualEvent() {
    const title = window.prompt("补充一项真实工作内容"); if (!title?.trim()) return;
    const projectName = window.prompt("归属项目", "数据中台")?.trim() || "未分类项目";
    const response = await fetch(`${API}/events`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({sourceType:"MANUAL",sourceName:"手动补充",projectName,title,durationMinutes:0}) });
    if (response.ok) await loadDashboard(); else setNotice("补充失败，请检查本地服务");
  }

  async function addPublicTask(kind: "会议" | "培训") {
    const title = window.prompt(`${kind}主题`); if (!title?.trim()) return;
    const entered = window.prompt("实际时长（分钟）", "60"); if (entered === null) return;
    const durationMinutes = Number(entered);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) return setNotice("时长需为 0～1440 分钟");
    const response = await fetch(`${API}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: "PUBLIC_TASK", sourceName: kind, projectName: "公共事务", title, durationMinutes: Math.round(durationMinutes) }) });
    if (response.ok) { setNotice(`${kind}已记录到公共事务`); await loadDashboard(); } else setNotice(`${kind}记录失败，请检查本地服务`);
  }

  async function copyReport(mode: "report" | "ai") {
    if (!summary.trim() || !nextPlan.trim()) return setNotice("请先生成或填写完整日报");
    const report = { date: today, summary, nextPlan, targetMinutes };
    try {
      await navigator.clipboard.writeText(mode === "report" ? buildReportText(report) : buildAiPrompt(report));
      recordUsage(mode === "report" ? "copy" : "aiExport", settings.localStatistics);
      setNotice(mode === "report" ? "日报已复制，可粘贴到企业微信提交" : "AI 润色提示词已复制；粘贴到外部 AI 前请检查敏感信息");
    } catch {
      setNotice("复制失败，请检查系统剪贴板权限");
    }
  }

  const progress = Math.min(100,Math.round(((dashboard?.allocatedMinutes ?? 0) / Math.max(targetMinutes,1)) * 100));
  const projects = useMemo(() => new Set(dashboard?.events.map(item => item.projectName) ?? []).size,[dashboard]);
  const confirmed = dashboard?.report?.status === "CONFIRMED";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src="/brand/xiaoyou-icon.svg" alt="小鱿"/><div><strong>迹汇</strong><span>TraceFlow</span></div></div>
      <nav>
        <button className="nav-item active"><LayoutDashboard size={19}/><span>今日工作</span></button>
        <button className="nav-item" disabled title="一期请在今日工作页生成日报"><FileText size={19}/><span>日报周报</span><em>一期</em></button>
        <button className="nav-item" disabled title="二期功能"><TimerReset size={19}/><span>Jira 工时</span><em>二期</em></button>
        <button className="nav-item" onClick={() => document.querySelector(".reports-workspace")?.scrollIntoView({ behavior: "smooth" })}><History size={19}/><span>历史记录</span><em>一期</em></button>
        <button className="nav-item" disabled title="二期功能"><Database size={19}/><span>自动数据源</span><em>二期</em></button>
        <button className="nav-item" disabled title="二期功能"><WandSparkles size={19}/><span>PPT 汇报</span><em>二期</em></button>
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowSettings(true)}><Settings size={19}/><span>设置</span></button><div className="privacy"><span/>本地模式 · 数据未上传</div></div>
    </aside>

    <main>
      <header className="topbar"><div><p className="eyebrow">WORKSPACE / TODAY</p><h1>今天的工作，已经有迹可循</h1></div><div className="top-actions">{monitorStatus === "COLLECTING" && <button className="sync-button monitor-pause" onClick={() => void pauseOneHour()}><Pause size={16}/>暂停 1 小时</button>}<button className={`sync-button monitor-toggle status-${monitorStatus.toLowerCase()}`} onClick={() => void toggleMonitoring()}>{monitorStatus === "COLLECTING" || monitorStatus === "IDLE" || monitorStatus === "PAUSED" ? <Pause size={16}/> : <Play size={16}/>}监控：{{COLLECTING:"采集中",IDLE:"空闲暂停",PAUSED:"已暂停",DISABLED:"已关闭",ERROR:"异常",UNAVAILABLE:"仅桌面版"}[monitorStatus]}</button><button className="icon-button" disabled title="一期固定使用深色模式"><Moon size={18}/></button><button className="sync-button" onClick={() => void loadDashboard()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={17}/>}立即同步</button></div></header>
      <section className="status-strip"><span className="live-dot"/><strong>{notice}</strong><span className="status-time"><Clock3 size={15}/>{settings.generateAt} 自动生成 · {settings.submitAfter} 后确认提交</span></section>

      <section className="metrics">
        <article><div className="metric-icon indigo"><Activity/></div><div><span>有效工作事件</span><strong>{dashboard?.events.length ?? 0}</strong><small>今日自动归集</small></div></article>
        <article><div className="metric-icon violet"><LayoutDashboard/></div><div><span>涉及项目</span><strong>{projects}</strong><small>按项目自动聚合</small></div></article>
        <article><div className="metric-icon green"><Clock3/></div><div><span>已分配工时</span><strong>{minutesLabel(dashboard?.allocatedMinutes ?? 0)}</strong><small>目标 {minutesLabel(targetMinutes)}</small></div></article>
        <article><div className="metric-icon amber"><Check/></div><div><span>今日状态</span><strong className="text-state">{confirmed ? "已确认" : "待确认"}</strong><small>{confirmed ? "等待18:00提交" : "请检查日报草稿"}</small></div></article>
      </section>

      <section className="workspace-grid">
        <div className="panel timeline-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>工作证据时间线</h2></div><div className="timeline-actions"><button className="soft-button" onClick={() => void addPublicTask("会议")}><Plus size={16}/>会议</button><button className="soft-button" onClick={() => void addPublicTask("培训")}><Plus size={16}/>培训</button><button className="soft-button" onClick={() => void addManualEvent()}><Plus size={16}/>手动补充</button></div></div>
          <div className="timeline">{(dashboard?.events ?? []).map((event,index) => <article className="timeline-item" key={event.id}>
            <div className="timeline-time">{formatTime(event.occurredAt)}</div><div className={`timeline-node node-${index % 3}`}>{sourceIcon(event.sourceType)}</div>
            <div className="event-card"><div className="event-meta"><span>{event.projectName}</span><i>·</i><span>{event.sourceName}</span><em>{event.evidenceLevel === "MANUAL" ? "手动" : "元数据"}</em></div><h3>{event.title}</h3><p>{event.summary || "等待补充结果说明"}</p><div className="event-footer"><span><Clock3 size={14}/>{minutesLabel(event.durationMinutes)}</span></div></div>
          </article>)}</div>
        </div>

        <div className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">DAILY REPORT</p><h2>日报与工时草稿</h2></div><span className={`status-pill ${confirmed ? "confirmed" : ""}`}>{confirmed ? "已确认" : "待检查"}</span></div>
          <label>今日工作总结<textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="生成本地草稿，或在这里补充真实工作内容…"/></label>
          <label>明日工作计划<textarea className="plan-input" value={nextPlan} onChange={event => setNextPlan(event.target.value)} placeholder="输入明天的重点计划…"/></label>
          <div className="hours-card"><div className="hours-title"><div><Clock3 size={18}/><span>目标工时</span></div><strong>{(targetMinutes / 60).toFixed(targetMinutes % 60 ? 1 : 0)} 小时</strong></div><input type="range" min="0" max="720" step="30" value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}/><div className="progress-row"><span>当前已分配 {minutesLabel(dashboard?.allocatedMinutes ?? 0)}</span><strong>{progress}%</strong></div><div className="progress"><i style={{width:`${progress}%`}}/></div></div>
          <div className="report-actions"><button className="generate" onClick={() => void generateReport()} disabled={busy}><Sparkles size={18}/>生成本地草稿</button><button className="confirm" onClick={() => void confirmReport()} disabled={busy || confirmed}><Check size={18}/>{confirmed ? "今日已确认" : "确认日报内容"}</button></div>
          <div className="export-actions"><button onClick={() => void copyReport("report")}><Clipboard size={16}/>复制日报</button><button onClick={() => void copyReport("ai")}><Bot size={16}/>导出给 AI 润色</button></div>
          <p className="guardrail"><Check size={14}/>当前版本不自动提交；复制后由你在企业微信中手动提交。</p>
        </div>
      </section>

      <section className="panel sources-panel"><div className="panel-heading"><div><p className="eyebrow">CONNECTORS</p><h2>数据源规划</h2></div><span className="phase-badge">二期功能 · 当前不可用</span></div><div className="source-grid">{(dashboard?.connectors ?? []).map(connector => <article key={connector.id} className={!connector.enabled ? "source-disabled" : ""}><div className="source-icon">{sourceIcon(connector.connectorType)}</div><div><h3>{connector.name}</h3><p>{connector.privacyLevel === "METADATA" ? "计划仅采集元数据" : connector.privacyLevel}</p></div><span className="source-warn">尚未开放</span></article>)}</div></section>
      <ReportsWorkspace api={API} date={today}/>
      <ProjectInbox api={API} date={today}/>
      <AiAssistantPanel settings={settings} onChange={updateSettings} summary={summary} nextPlan={nextPlan}/>
    </main>
    {showOnboarding && <Onboarding
      initial={settings}
      onComplete={completeOnboarding}
      onSkip={() => { markOnboardingCompleted(); setShowOnboarding(false); }}
    />}
    {showSettings && <SettingsPanel
      settings={settings}
      supportEmail={supportEmail}
      onChange={updateSettings}
      onClose={() => setShowSettings(false)}
      onRestartGuide={() => { resetOnboarding(); setShowSettings(false); setShowOnboarding(true); }}
    />}
  </div>;
}
