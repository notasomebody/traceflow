import { Check, Clipboard, FileInput, History, LoaderCircle, MessageSquareText, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import WeComWorkspace from "./WeComWorkspace";

type ReportType = "DAILY" | "WEEKLY" | "MONTHLY";
type Report = { id: string; reportDate: string; reportType: ReportType; summary: string; nextPlan: string; targetMinutes: number; status: string; updatedAt: string };
type PeriodReport = { report: Report; periodStart: string; periodEnd: string; sourceDailyCount: number };
const labels: Record<ReportType, string> = { DAILY: "日报", WEEKLY: "周报", MONTHLY: "月报" };

export default function ReportsWorkspace({ api, date }: { api: string; date: string }) {
  const [type, setType] = useState<ReportType>("WEEKLY");
  const [current, setCurrent] = useState<PeriodReport>();
  const [summary, setSummary] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [history, setHistory] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showWeCom, setShowWeCom] = useState(false);
  const [importDate, setImportDate] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [importPlan, setImportPlan] = useState("");

  const loadHistory = useCallback(async (reportType: ReportType) => {
    try { const response = await fetch(`${api}/reports/history?type=${reportType}`); if (!response.ok) throw new Error(); setHistory(await response.json()); }
    catch { setMessage("无法读取报告历史"); }
  }, [api]);
  useEffect(() => { void loadHistory(type); setCurrent(undefined); setMessage(""); }, [type, loadHistory]);
  const show = (value: PeriodReport) => { setCurrent(value); setSummary(value.report.summary); setNextPlan(value.report.nextPlan); };

  const generate = async () => {
    if (type === "DAILY") { setMessage("日报请在上方“日报与工时草稿”中生成和确认。"); return; }
    setBusy(true);
    try {
      const response = await fetch(`${api}/reports/${type.toLowerCase()}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, targetMinutes: 480 }) });
      if (!response.ok) throw new Error();
      const generated: PeriodReport = await response.json(); show(generated);
      setMessage(`已汇总 ${generated.sourceDailyCount} 篇日报，请编辑并确认`); await loadHistory(type);
    } catch { setMessage("生成失败，请确认本地服务已启动"); } finally { setBusy(false); }
  };
  const selectHistory = (report: Report) => show({ report, periodStart: report.reportDate, periodEnd: report.reportDate, sourceDailyCount: 0 });
  const confirm = async () => {
    if (!current || type === "DAILY" || !summary.trim() || !nextPlan.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/reports/${type}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: current.report.reportDate, summary, nextPlan, targetMinutes: current.report.targetMinutes }) });
      if (!response.ok) throw new Error();
      const report: Report = await response.json(); show({ ...current, report }); setMessage(`${labels[type]}已确认并保存版本快照`); await loadHistory(type);
    } catch { setMessage("确认失败，请稍后重试"); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(`${labels[current.report.reportType]}（${current.periodStart} 至 ${current.periodEnd}）\n\n工作总结\n${summary}\n\n下周/下月计划\n${nextPlan}`);
    setMessage(`${labels[current.report.reportType]}已复制`);
  };
  const importDaily = async () => {
    if (!importDate || !importSummary.trim() || !importPlan.trim()) { setMessage("请填写完整的历史日报"); return; }
    if (!window.confirm(`将把 ${importDate} 的内容保存为历史日报；同日期已有记录时会保留新版本。确认导入？`)) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/reports/daily/import`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date:importDate,summary:importSummary,nextPlan:importPlan,targetMinutes:480}) });
      if (!response.ok) throw new Error();
      setType("DAILY"); setShowImport(false); setMessage(`${importDate} 历史日报已导入`); await loadHistory("DAILY");
    } catch { setMessage("历史日报导入失败，请检查本地服务"); }
    finally { setBusy(false); }
  };

  return <section className="panel reports-workspace">
    <div className="panel-heading"><div><p className="eyebrow">REPORT CENTER</p><h2>报告与历史</h2></div><div className="history-heading-actions"><button onClick={() => { setShowImport(value => !value); setShowWeCom(false); }}><FileInput/>导入历史日报</button><button onClick={() => { setShowWeCom(value => !value); setShowImport(false); }}><MessageSquareText/>从企业微信导入</button><div className="report-tabs">{(["DAILY", "WEEKLY", "MONTHLY"] as ReportType[]).map(item => <button key={item} className={type === item ? "active" : ""} onClick={() => setType(item)}>{labels[item]}</button>)}</div></div></div>
    {showImport && <section className="history-import"><label>日期<input type="date" value={importDate} onChange={event => setImportDate(event.target.value)}/></label><label>工作总结<textarea value={importSummary} onChange={event => setImportSummary(event.target.value)}/></label><label>下一步计划<textarea value={importPlan} onChange={event => setImportPlan(event.target.value)}/></label><button className="primary-action" onClick={() => void importDaily()} disabled={busy}>确认导入</button></section>}
    {showWeCom && <div className="report-wecom-import"><WeComWorkspace api={api}/></div>}
    <div className="reports-layout"><div className="period-draft">
      <button className="generate" onClick={() => void generate()} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Sparkles/>}生成{labels[type]}</button>
      {current ? <><div className="period-meta"><span>{current.periodStart} 至 {current.periodEnd}</span><em>{current.report.status}</em></div><label>工作总结<textarea value={summary} onChange={event => setSummary(event.target.value)}/></label><label>下周/下月计划<textarea value={nextPlan} onChange={event => setNextPlan(event.target.value)}/></label><div className="inline-actions">{type !== "DAILY" && <button className="primary-action" onClick={() => void confirm()} disabled={busy || current.report.status === "CONFIRMED"}><Check/>确认{labels[type]}</button>}<button className="secondary-action" onClick={() => void copy()}><Clipboard/>复制{labels[type]}</button></div></> : <div className="empty-report"><Sparkles/><span>生成后会在这里显示，不会自动上传</span></div>}
      {message && <p className="settings-message">{message}</p>}
    </div><aside className="report-history"><h3><History/>历史记录</h3>{history.length ? history.map(report => <button key={report.id} onClick={() => selectHistory(report)}><span>{report.reportDate}</span><strong>{labels[report.reportType]}</strong><em>{report.status}</em></button>) : <p>暂无{labels[type]}记录</p>}</aside></div>
  </section>;
}
