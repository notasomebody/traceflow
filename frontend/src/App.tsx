import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronRight, Clock3, CloudCog, Database, FileClock, FileText, GitBranch, History, LayoutDashboard, LoaderCircle, Moon, Plus, RefreshCw, Settings, Sparkles, TimerReset, WandSparkles } from "lucide-react";
import "./App.css";
import "./Onboarding.css";
import Onboarding from "./Onboarding";
import SettingsPanel from "./SettingsPanel";
import { loadSettings, markOnboardingCompleted, onboardingCompleted, resetOnboarding, saveSettings, type AppSettings } from "./settings";

type WorkEvent = { id:string; occurredAt:string; sourceType:string; sourceName:string; projectName:string; title:string; summary:string; evidenceLevel:string; durationMinutes:number; includedInReport:boolean };
type Connector = { id:string; name:string; connectorType:string; enabled:boolean; privacyLevel:string; syncStatus:string; lastSyncedAt?:string };
type Report = { id:string; reportDate:string; summary:string; nextPlan:string; targetMinutes:number; status:"DRAFT"|"CONFIRMED"|"SUBMITTED" };
type Dashboard = { date:string; events:WorkEvent[]; connectors:Connector[]; report?:Report; allocatedMinutes:number; targetMinutes:number };

const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:17890/api";
const today = new Date().toISOString().slice(0, 10);
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

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const response = await fetch(`${API}/dashboard?date=${today}`);
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

  function updateSettings(next: AppSettings) {
    setSettings(next); saveSettings(next); setTargetMinutes(next.targetMinutes);
  }

  function completeOnboarding(next: AppSettings) {
    updateSettings(next); markOnboardingCompleted(); setShowOnboarding(false);
  }

  async function generateReport() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/reports/daily/generate`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:today,targetMinutes}) });
      if (!response.ok) throw new Error();
      const report:Report = await response.json(); setSummary(report.summary); setNextPlan(report.nextPlan);
      setDashboard(current => current ? {...current,report} : current); setNotice("日报草稿已根据真实工作记录生成");
    } catch { setNotice("生成失败，请检查本地后端"); } finally { setBusy(false); }
  }

  async function confirmReport() {
    if (!summary.trim() || !nextPlan.trim()) return setNotice("请补全今日总结和明日计划");
    setBusy(true);
    try {
      const response = await fetch(`${API}/reports/daily/confirm`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:today,summary,nextPlan,targetMinutes}) });
      if (!response.ok) throw new Error();
      const report:Report = await response.json(); setDashboard(current => current ? {...current,report} : current); setNotice("已确认，18:00 后将进入待提交队列");
    } catch { setNotice("确认失败，请稍后重试"); } finally { setBusy(false); }
  }

  async function addManualEvent() {
    const title = window.prompt("补充一项真实工作内容"); if (!title?.trim()) return;
    const projectName = window.prompt("归属项目", "数据中台")?.trim() || "未分类项目";
    const response = await fetch(`${API}/events`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({sourceType:"MANUAL",sourceName:"手动补充",projectName,title,durationMinutes:0}) });
    if (response.ok) await loadDashboard(); else setNotice("补充失败，请检查本地服务");
  }

  const progress = Math.min(100,Math.round(((dashboard?.allocatedMinutes ?? 0) / Math.max(targetMinutes,1)) * 100));
  const projects = useMemo(() => new Set(dashboard?.events.map(item => item.projectName) ?? []).size,[dashboard]);
  const confirmed = dashboard?.report?.status === "CONFIRMED";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src="/brand/xiaoyou-icon.svg" alt="小鱿"/><div><strong>迹汇</strong><span>TraceFlow</span></div></div>
      <nav>
        <button className="nav-item active"><LayoutDashboard size={19}/><span>今日工作</span></button>
        <button className="nav-item"><FileText size={19}/><span>日报周报</span><em>1</em></button>
        <button className="nav-item"><TimerReset size={19}/><span>工时管理</span></button>
        <button className="nav-item"><History size={19}/><span>历史记录</span></button>
        <button className="nav-item"><Database size={19}/><span>数据源</span></button>
        <button className="nav-item"><WandSparkles size={19}/><span>PPT 汇报</span></button>
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowSettings(true)}><Settings size={19}/><span>设置</span></button><div className="privacy"><span/>本地模式 · 数据未上传</div></div>
    </aside>

    <main>
      <header className="topbar"><div><p className="eyebrow">WORKSPACE / TODAY</p><h1>今天的工作，已经有迹可循</h1></div><div className="top-actions"><button className="icon-button"><Moon size={18}/></button><button className="sync-button" onClick={() => void loadDashboard()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={17}/>}立即同步</button></div></header>
      <section className="status-strip"><span className="live-dot"/><strong>{notice}</strong><span className="status-time"><Clock3 size={15}/>{settings.generateAt} 自动生成 · {settings.submitAfter} 后确认提交</span></section>

      <section className="metrics">
        <article><div className="metric-icon indigo"><Activity/></div><div><span>有效工作事件</span><strong>{dashboard?.events.length ?? 0}</strong><small>今日自动归集</small></div></article>
        <article><div className="metric-icon violet"><LayoutDashboard/></div><div><span>涉及项目</span><strong>{projects}</strong><small>按项目自动聚合</small></div></article>
        <article><div className="metric-icon green"><Clock3/></div><div><span>已分配工时</span><strong>{minutesLabel(dashboard?.allocatedMinutes ?? 0)}</strong><small>目标 {minutesLabel(targetMinutes)}</small></div></article>
        <article><div className="metric-icon amber"><Check/></div><div><span>今日状态</span><strong className="text-state">{confirmed ? "已确认" : "待确认"}</strong><small>{confirmed ? "等待18:00提交" : "请检查日报草稿"}</small></div></article>
      </section>

      <section className="workspace-grid">
        <div className="panel timeline-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>工作证据时间线</h2></div><button className="soft-button" onClick={() => void addManualEvent()}><Plus size={16}/>手动补充</button></div>
          <div className="timeline">{(dashboard?.events ?? []).map((event,index) => <article className="timeline-item" key={event.id}>
            <div className="timeline-time">{formatTime(event.occurredAt)}</div><div className={`timeline-node node-${index % 3}`}>{sourceIcon(event.sourceType)}</div>
            <div className="event-card"><div className="event-meta"><span>{event.projectName}</span><i>·</i><span>{event.sourceName}</span><em>{event.evidenceLevel === "MANUAL" ? "手动" : "元数据"}</em></div><h3>{event.title}</h3><p>{event.summary || "等待补充结果说明"}</p><div className="event-footer"><span><Clock3 size={14}/>{minutesLabel(event.durationMinutes)}</span><button>查看证据 <ChevronRight size={14}/></button></div></div>
          </article>)}</div>
        </div>

        <div className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">DAILY REPORT</p><h2>日报与工时草稿</h2></div><span className={`status-pill ${confirmed ? "confirmed" : ""}`}>{confirmed ? "已确认" : "待检查"}</span></div>
          <label>今日工作总结<textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="点击 AI 生成，或在这里补充真实工作内容…"/></label>
          <label>明日工作计划<textarea className="plan-input" value={nextPlan} onChange={event => setNextPlan(event.target.value)} placeholder="输入明天的重点计划…"/></label>
          <div className="hours-card"><div className="hours-title"><div><Clock3 size={18}/><span>目标工时</span></div><strong>{(targetMinutes / 60).toFixed(targetMinutes % 60 ? 1 : 0)} 小时</strong></div><input type="range" min="0" max="720" step="30" value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}/><div className="progress-row"><span>当前已分配 {minutesLabel(dashboard?.allocatedMinutes ?? 0)}</span><strong>{progress}%</strong></div><div className="progress"><i style={{width:`${progress}%`}}/></div></div>
          <div className="report-actions"><button className="generate" onClick={() => void generateReport()} disabled={busy}><Sparkles size={18}/>AI 生成草稿</button><button className="confirm" onClick={() => void confirmReport()} disabled={busy || confirmed}><Check size={18}/>{confirmed ? "今日已确认" : "确认并等待提交"}</button></div><p className="guardrail"><Check size={14}/>只整理真实工作记录，提交前始终由你确认。</p>
        </div>
      </section>

      <section className="panel sources-panel"><div className="panel-heading"><div><p className="eyebrow">CONNECTORS</p><h2>数据源状态</h2></div><button className="plain-link">管理全部数据源 <ChevronRight size={15}/></button></div><div className="source-grid">{(dashboard?.connectors ?? []).map(connector => <article key={connector.id} className={!connector.enabled ? "source-disabled" : ""}><div className="source-icon">{sourceIcon(connector.connectorType)}</div><div><h3>{connector.name}</h3><p>{connector.privacyLevel === "METADATA" ? "仅采集元数据" : connector.privacyLevel}</p></div><span className="source-warn">{connector.enabled ? "待配置" : "未启用"}</span></article>)}</div></section>
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
