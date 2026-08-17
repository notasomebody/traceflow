import { useCallback, useEffect, useState } from "react";
import { Bot, BriefcaseBusiness, Check, Clipboard, Clock3, CloudCog, FileClock, FileText, FolderKanban, GitBranch, History, LayoutDashboard, ListChecks, LoaderCircle, Moon, Pause, Play, Plus, RefreshCw, Settings, Sparkles, Sun } from "lucide-react";
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
import ProjectInbox from "./ProjectInbox";
import { localDateKey, shouldGenerateDaily } from "./reportScheduler";
import { fetchLocal } from "./localApi";
import { listDraftVersions, loadLocalDraft, saveLocalDraft } from "./draftHistory";

type WorkEvent = { id:string; occurredAt:string; sourceType:string; sourceName:string; projectName:string; title:string; summary:string; evidenceLevel:string; durationMinutes:number; includedInReport:boolean };
type Connector = { id:string; name:string; connectorType:string; enabled:boolean; privacyLevel:string; syncStatus:string; lastSyncedAt?:string };
type Report = { id:string; reportDate:string; summary:string; nextPlan:string; targetMinutes:number; status:"DRAFT"|"CONFIRMED"|"SUBMITTED" };
type Dashboard = { date:string; events:WorkEvent[]; connectors:Connector[]; report?:Report; allocatedMinutes:number; targetMinutes:number };

const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:17890/api";
const today = localDateKey();
const sourceIcon = (type:string) => type === "GIT" ? <GitBranch size={17}/> : type === "BROWSER" || type === "JIRA" ? <CloudCog size={17}/> : type === "FILESYSTEM" ? <FileClock size={17}/> : <FileText size={17}/>;
const formatTime = (value:string) => new Intl.DateTimeFormat("zh-CN", { hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value));
const minutesLabel = (minutes:number) => `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分` : ""}`;
const textOrEmpty = (value: unknown) => typeof value === "string" ? value : "";

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
  const [taskDialog,setTaskDialog] = useState<"会议" | "培训" | "手动补充" | null>(null);
  const [page,setPage] = useState<"today" | "records" | "reports" | "projects">("today");
  const [theme,setTheme] = useState<"dark" | "light">(() => localStorage.getItem("traceflow.theme") === "light" ? "light" : "dark");
  const [dashboardLoaded,setDashboardLoaded] = useState(false);
  const [showVersions,setShowVersions] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const response = await fetchLocal(`${API}/dashboard?date=${today}`);
      if (!response.ok) throw new Error();
      const data:Dashboard = await response.json();
      const localDraft = loadLocalDraft(today);
      setDashboard(data); setSummary(textOrEmpty(data.report?.summary ?? localDraft?.summary)); setNextPlan(textOrEmpty(data.report?.nextPlan ?? localDraft?.nextPlan));
      setTargetMinutes(data.report?.targetMinutes ?? settings.targetMinutes ?? data.targetMinutes ?? 480); setNotice("本地数据已同步");
      setDashboardLoaded(true);
      return true;
    } catch { if (!silent) setNotice("同步失败：无法连接本地服务，请重试或重启迹汇"); return false; }
    finally { if (!silent) setBusy(false); }
  }, [settings.targetMinutes]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      const loaded = await loadDashboard(true);
      if (!loaded && !cancelled) setNotice("连接失败：本地服务未就绪，请点击立即同步重试");
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
      const response = await fetchLocal(`${API}/reports/daily/generate`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:today,targetMinutes}) }, 1);
      if (!response.ok) throw new Error();
      const report:Report = await response.json(); setSummary(textOrEmpty(report.summary)); setNextPlan(textOrEmpty(report.nextPlan));
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
        setSummary(textOrEmpty(report.summary)); setNextPlan(textOrEmpty(report.nextPlan));
        setDashboard(current => current ? { ...current, report } : current);
        setNotice(`${settings.generateAt} 日报草稿已自动生成，请检查后确认`);
        recordUsage("generate", settings.localStatistics);
      } finally { running = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(timer);
  }, [dashboard?.report, settings.generateAt, settings.localStatistics, targetMinutes]);

  useEffect(() => {
    if (!dashboardLoaded || (!summary.trim() && !nextPlan.trim())) return;
    const timer = window.setTimeout(() => saveLocalDraft(today, summary, nextPlan), 800);
    return () => window.clearTimeout(timer);
  }, [dashboardLoaded, summary, nextPlan]);

  async function confirmReport() {
    if (!summary.trim() || !nextPlan.trim()) return setNotice("请补全今日总结和明日计划");
    setBusy(true);
    try {
      const response = await fetchLocal(`${API}/reports/daily/confirm`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:today,summary,nextPlan,targetMinutes}) }, 1);
      if (!response.ok) throw new Error();
      const report:Report = await response.json(); setDashboard(current => current ? {...current,report} : current); setNotice("已确认；当前版本请复制后手动提交到企业微信");
      recordUsage("confirm", settings.localStatistics);
    } catch { setNotice("确认失败，请稍后重试"); } finally { setBusy(false); }
  }

  async function saveTask(task: { kind: "会议" | "培训" | "手动补充"; title: string; projectName: string; summary: string; durationMinutes: number }) {
    setBusy(true);
    try {
      const response = await fetchLocal(`${API}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: task.kind === "手动补充" ? "MANUAL" : "PUBLIC_TASK", sourceName: task.kind, projectName: task.projectName, title: task.title, summary: task.summary, durationMinutes: task.durationMinutes }) }, 1);
      if (!response.ok) throw new Error();
      setTaskDialog(null); setNotice(`${task.kind}已添加到今日工作`); await loadDashboard(true);
    } catch { setNotice(`${task.kind}添加失败，请检查本地服务`); }
    finally { setBusy(false); }
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
  const confirmed = dashboard?.report?.status === "CONFIRMED";

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); localStorage.setItem("traceflow.theme", next);
  }

  return <div className={`app-shell theme-${theme}`}>
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src="/brand/xiaoyou-icon.svg" alt="小鱿"/><div><strong>迹汇</strong><span>TraceFlow</span></div></div>
      <nav>
        <button aria-label="今日" className={`nav-item ${page === "today" ? "active" : ""}`} onClick={() => setPage("today")}><LayoutDashboard size={19}/><span>今日</span></button>
        <button aria-label="工作记录" className={`nav-item ${page === "records" ? "active" : ""}`} onClick={() => setPage("records")}><ListChecks size={19}/><span>工作记录</span></button>
        <button aria-label="汇报中心" className={`nav-item ${page === "reports" ? "active" : ""}`} onClick={() => setPage("reports")}><FileText size={19}/><span>汇报中心</span></button>
        <button aria-label="项目" className={`nav-item ${page === "projects" ? "active" : ""}`} onClick={() => setPage("projects")}><FolderKanban size={19}/><span>项目</span></button>
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowSettings(true)}><Settings size={19}/><span>设置</span></button><div className="privacy"><span/>本地模式 · 数据未上传</div></div>
    </aside>

    <main>
      {page === "today" && <>
      <header className="topbar"><div><p className="eyebrow">WORKSPACE / TODAY</p><h1>今天的工作，已经有迹可循</h1></div><div className="top-actions">{monitorStatus === "COLLECTING" && <button className="sync-button monitor-pause" onClick={() => void pauseOneHour()}><Pause size={16}/>暂停 1 小时</button>}<button className={`sync-button monitor-toggle status-${monitorStatus.toLowerCase()}`} onClick={() => void toggleMonitoring()}>{monitorStatus === "COLLECTING" || monitorStatus === "IDLE" || monitorStatus === "PAUSED" ? <Pause size={16}/> : <Play size={16}/>}监控：{{COLLECTING:"采集中",IDLE:"空闲暂停",PAUSED:"已暂停",DISABLED:"已关闭",ERROR:"异常",UNAVAILABLE:"仅桌面版"}[monitorStatus]}</button><button className="icon-button" aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="sync-button" onClick={() => void loadDashboard()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={17}/>}立即整理</button></div></header>
      <section className="status-strip"><span className="live-dot"/><strong>{notice}</strong><span className="status-time"><Clock3 size={15}/>{settings.generateAt} 自动生成 · {settings.submitAfter} 后确认提交</span></section>
      <section className="day-summary"><BriefcaseBusiness size={16}/><span>{dashboard?.events.length ?? 0} 条有效记录</span><i/> <span>{minutesLabel(dashboard?.allocatedMinutes ?? 0)} 已归集</span><i/><strong>{confirmed ? "日报已确认" : "日报待确认"}</strong></section>

      <section className="workspace-grid">
        <div className="panel timeline-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>工作证据时间线</h2></div><div className="timeline-actions"><button className="soft-button" onClick={() => setTaskDialog("会议")}><Plus size={16}/>会议</button><button className="soft-button" onClick={() => setTaskDialog("培训")}><Plus size={16}/>培训</button><button className="soft-button" onClick={() => setTaskDialog("手动补充")}><Plus size={16}/>手动补充</button></div></div>
          <div className="timeline">{(dashboard?.events ?? []).map((event,index) => <article className="timeline-item" key={event.id}>
            <div className="timeline-time">{formatTime(event.occurredAt)}</div><div className={`timeline-node node-${index % 3}`}>{sourceIcon(event.sourceType)}</div>
            <div className="event-card"><div className="event-meta"><span>{event.projectName}</span><i>·</i><span>{event.sourceName}</span><em>{event.evidenceLevel === "MANUAL" ? "手动" : "元数据"}</em></div><h3>{event.title}</h3><p>{event.summary || "等待补充结果说明"}</p><div className="event-footer"><span><Clock3 size={14}/>{minutesLabel(event.durationMinutes)}</span></div></div>
          </article>)}</div>
        </div>

        <div className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">DAILY REPORT</p><h2>日报与工时草稿</h2></div><div className="report-heading-actions"><button onClick={() => setShowVersions(value => !value)}><History/>版本</button><span className={`status-pill ${confirmed ? "confirmed" : ""}`}>{confirmed ? "已确认" : "待检查"}</span></div></div>
          {showVersions && <div className="draft-versions"><strong>最近自动保存</strong>{listDraftVersions(today).length ? listDraftVersions(today).map(version => <button key={version.savedAt} onClick={() => { setSummary(version.summary); setNextPlan(version.nextPlan); setShowVersions(false); setNotice("已恢复所选日报版本"); }}><span>{new Date(version.savedAt).toLocaleString("zh-CN")}</span><small>{version.summary.slice(0, 34) || "空白总结"}</small></button>) : <p>尚无本地版本</p>}</div>}
          <label>今日工作总结<textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="生成本地草稿，或在这里补充真实工作内容…"/></label>
          <label>明日工作计划<textarea className="plan-input" value={nextPlan} onChange={event => setNextPlan(event.target.value)} placeholder="输入明天的重点计划…"/></label>
          <div className="hours-card"><div className="hours-title"><div><Clock3 size={18}/><span>目标工时</span></div><strong>{(targetMinutes / 60).toFixed(targetMinutes % 60 ? 1 : 0)} 小时</strong></div><input type="range" min="0" max="720" step="30" value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}/><div className="progress-row"><span>当前已分配 {minutesLabel(dashboard?.allocatedMinutes ?? 0)}</span><strong>{progress}%</strong></div><div className="progress"><i style={{width:`${progress}%`}}/></div></div>
          <div className="report-actions"><button className="generate" onClick={() => void generateReport()} disabled={busy}><Sparkles size={18}/>生成本地草稿</button><button className="confirm" onClick={() => void confirmReport()} disabled={busy || confirmed}><Check size={18}/>{confirmed ? "今日已确认" : "确认日报内容"}</button></div>
          <div className="export-actions"><button onClick={() => void copyReport("report")}><Clipboard size={16}/>复制日报</button><button onClick={() => void copyReport("ai")}><Bot size={16}/>导出给 AI 润色</button></div>
          <p className="guardrail"><Check size={14}/>当前版本不自动提交；复制后由你在企业微信中手动提交。</p>
        </div>
      </section>

      </>}
      {page === "records" && <section className="page-workspace"><header><p className="eyebrow">REVIEW</p><h1>工作记录</h1><span>监控记录会自动聚合并进入日报，只需在需要时纠正项目归属。</span></header><ProjectInbox api={API} date={today} mode="records"/></section>}
      {page === "reports" && <section className="page-workspace"><header><p className="eyebrow">REPORTS</p><h1>汇报中心</h1><span>日报、周报和月报统一管理。</span></header><ReportsWorkspace api={API} date={today}/></section>}
      {page === "projects" && <section className="page-workspace"><header><p className="eyebrow">PROJECTS</p><h1>项目</h1><span>确认项目一次，后续自动归类。</span></header><ProjectInbox api={API} date={today} mode="projects"/></section>}
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
    {taskDialog && <TaskDialog kind={taskDialog} onClose={() => setTaskDialog(null)} onSave={saveTask}/>}
  </div>;
}

function TaskDialog({ kind, onClose, onSave }: { kind: "会议" | "培训" | "手动补充"; onClose: () => void; onSave: (task: { kind: "会议" | "培训" | "手动补充"; title: string; projectName: string; summary: string; durationMinutes: number }) => Promise<void> }) {
  const [title,setTitle] = useState("");
  const [projectName,setProjectName] = useState(kind === "手动补充" ? "未分类项目" : "公共事务");
  const [summary,setSummary] = useState("");
  const [durationMinutes,setDurationMinutes] = useState(kind === "手动补充" ? 30 : 60);
  const [error,setError] = useState("");
  const submit = () => {
    if (!title.trim()) return setError(`请填写${kind === "手动补充" ? "工作内容" : `${kind}主题`}`);
    if (!projectName.trim()) return setError("请填写归属项目");
    if (durationMinutes <= 0 || durationMinutes > 1440) return setError("实际时长需为 1～1440 分钟");
    void onSave({ kind, title: title.trim(), projectName: projectName.trim(), summary: summary.trim(), durationMinutes });
  };
  return <div className="task-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="task-dialog" role="dialog" aria-modal="true" aria-label={`添加${kind}`}><div className="task-dialog-title"><div><p className="eyebrow">QUICK ADD</p><h2>添加{kind}</h2><span>记录真实工作内容，保存后自动进入今日时间线和日报草稿。</span></div><button onClick={onClose} aria-label="关闭">×</button></div><label>{kind === "手动补充" ? "工作内容" : `${kind}主题`}<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder={kind === "会议" ? "例如：数据中台需求评审会" : kind === "培训" ? "例如：平台新版本功能培训" : "例如：完成接口异常场景验证"}/></label><div className="task-dialog-grid"><label>归属项目<input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="输入项目名称"/></label><label>实际时长（分钟）<input type="number" min="1" max="1440" value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))}/></label></div><div className="duration-presets">{[30,60,90,120].map(minutes => <button key={minutes} className={durationMinutes === minutes ? "active" : ""} onClick={() => setDurationMinutes(minutes)}>{minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}</button>)}</div><label>结果或备注（可选）<textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="填写结论、产出或后续事项，生成日报时会自动引用。"/></label>{error && <p className="task-dialog-error">{error}</p>}<div className="task-dialog-actions"><button onClick={onClose}>取消</button><button className="primary-action" onClick={submit}>保存到今日工作</button></div></section></div>;
}
