import { Check, ClipboardPaste, Eye, KeyRound, LoaderCircle, MessageSquareText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ImportedReport = { reportDate: string; summary: string; nextPlan: string; targetMinutes: number; status: string };
type Journal = { journalUuid: string; templateName: string; reportTime: number; submitter: string; textContent: string };
const desktop = () => "__TAURI_INTERNALS__" in window;
const dateValue = (offsetDays = 0) => {
  const value = new Date(); value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
const epochStart = (date: string) => Math.floor(new Date(`${date}T00:00:00`).getTime() / 1000);
const epochEnd = (date: string) => Math.floor(new Date(`${date}T23:59:59`).getTime() / 1000);

export default function WeComWorkspace({ api }: { api: string }) {
  const [date,setDate] = useState("");
  const [summary,setSummary] = useState("");
  const [nextPlan,setNextPlan] = useState("");
  const [targetMinutes,setTargetMinutes] = useState(480);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [reading,setReading] = useState(false);
  const [corpId,setCorpId] = useState(() => localStorage.getItem("traceflow.wecom.corpId") ?? "");
  const [creator,setCreator] = useState(() => localStorage.getItem("traceflow.wecom.creator") ?? "");
  const [secret,setSecret] = useState("");
  const [hasSecret,setHasSecret] = useState(false);
  const [startDate,setStartDate] = useState(dateValue(-7));
  const [endDate,setEndDate] = useState(dateValue());
  const [journals,setJournals] = useState<Journal[]>([]);

  useEffect(() => {
    if (desktop()) void invoke<boolean>("ai_secret_status", { secretId:"wecom-report" }).then(setHasSecret).catch(() => setHasSecret(false));
  }, []);
  const paste = async () => {
    try { setSummary(await navigator.clipboard.readText()); setMessage("已粘贴，请检查并拆分总结与计划"); }
    catch { setMessage("无法读取剪贴板，请检查系统权限或手动粘贴"); }
  };
  const importReport = async () => {
    if (!date || !summary.trim() || !nextPlan.trim()) { setMessage("请填写日期、工作总结和下一步计划"); return; }
    if (!window.confirm(`将把 ${date} 的内容保存为历史日报，确认导入？`)) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/reports/daily/import`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date,summary,nextPlan,targetMinutes}) });
      if (!response.ok) throw new Error(`本地服务返回 ${response.status}`);
      const report:ImportedReport = await response.json(); setMessage(`${report.reportDate} 已导入本机历史，正文已加密保存`);
    } catch (error) { setMessage(`导入失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  };
  const readCurrentWeCom = async () => {
    if (!desktop()) { setMessage("此功能仅在迹汇桌面版中可用"); return; }
    setReading(true); setMessage("请在 3 秒内切换到企业微信，并打开目标汇报正文…");
    try {
      const result = await invoke<{ocr_text:string}>("capture_wecom_uia_preview", { delaySeconds:3 });
      setSummary(result.ocr_text); setMessage("已优先通过 UI Automation 读取；仅在读取不到且你已授权时使用本地 OCR。请检查后导入");
    } catch (error) { setMessage(String(error)); }
    finally { setReading(false); }
  };
  const saveAdminSecret = async () => {
    if (!desktop() || !secret.trim()) return;
    try {
      await invoke("save_ai_secret", { secretId:"wecom-report", value:secret });
      localStorage.setItem("traceflow.wecom.corpId", corpId.trim()); localStorage.setItem("traceflow.wecom.creator", creator.trim());
      setSecret(""); setHasSecret(true); setMessage("Secret 已保存到 Windows 凭据管理器");
    } catch (error) { setMessage(String(error)); }
  };
  const testOfficialApi = async () => {
    setBusy(true);
    try { setMessage(await invoke<string>("test_wecom_connection", { corpId })); }
    catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  const fetchOfficialReports = async () => {
    setBusy(true);
    try {
      const result = await invoke<Journal[]>("fetch_wecom_reports", { request:{ corpId, creator:creator || null, startTime:epochStart(startDate), endTime:epochEnd(endDate) } });
      setJournals(result); setMessage(`读取到 ${result.length} 篇汇报，请选择后检查导入`);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  const selectJournal = (journal: Journal) => {
    setDate(new Date(journal.reportTime * 1000).toLocaleDateString("sv-SE")); setSummary(journal.textContent); setNextPlan("");
    setMessage("已载入企业微信汇报，请拆分工作总结和下一步计划");
  };

  return <section className="integration-page">
    <header className="integration-hero"><div className="integration-icon"><MessageSquareText/></div><div><p className="eyebrow">WECOM</p><h1>企业微信汇报</h1><p>普通用户读取当前窗口；管理员授权后可通过官方接口批量读取历史。</p></div></header>
    <section className="panel import-card">
      <div className="privacy-note"><ShieldCheck/><span>默认不扫描企业微信。只有你主动读取、粘贴或通过官方接口选择的内容才会进入本机加密数据库。</span></div>
      <div className="wecom-quick-actions"><button aria-label="读取当前企业微信" onClick={() => void readCurrentWeCom()} disabled={reading}>{reading ? <LoaderCircle className="spin"/> : <Eye/>}智能读取当前汇报</button><button onClick={() => void paste()}><ClipboardPaste/>从剪贴板粘贴</button></div>
      <label>日报日期<input type="date" value={date} onChange={event => setDate(event.target.value)}/></label>
      <label>今日工作总结<textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="读取、粘贴或手动填写…"/></label>
      <label>下一步计划<textarea value={nextPlan} onChange={event => setNextPlan(event.target.value)} placeholder="填写当时日报中的明日计划…"/></label>
      <label>当日工时<input type="number" min="0" max="1440" step="30" value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}/><span>分钟</span></label>
      <button className="primary-action wecom-import" onClick={() => void importReport()} disabled={busy}><Check/>确认导入本机</button>

      <details className="wecom-admin"><summary>企业管理员：官方 API 批量读取</summary>
        <p>需要企业 ID 和“汇报”应用 Secret，并由管理员授予汇报数据拉取权限。本机企业微信登录状态不能替代该授权。</p>
        <div className="wecom-admin-grid"><label>企业 ID（CorpID）<input value={corpId} onChange={event => setCorpId(event.target.value)}/></label><label>创建人 UserID（可选）<input value={creator} onChange={event => setCreator(event.target.value)}/></label><label>汇报应用 Secret<div className="input-with-icon"><KeyRound/><input type="password" value={secret} onChange={event => setSecret(event.target.value)} placeholder={hasSecret ? "已安全保存，输入可替换" : "输入后不可回读"}/></div></label><button onClick={() => void saveAdminSecret()} disabled={!secret.trim()}>安全保存</button><label>开始日期<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)}/></label><label>结束日期<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)}/></label></div>
        <div className="inline-actions"><button onClick={() => void testOfficialApi()} disabled={busy || !corpId || !hasSecret}>测试连接</button><button className="primary-action" onClick={() => void fetchOfficialReports()} disabled={busy || !corpId || !hasSecret}>读取历史汇报</button></div>
        {journals.map(journal => <button className="journal-result" key={journal.journalUuid} onClick={() => selectJournal(journal)}><strong>{journal.templateName}</strong><span>{new Date(journal.reportTime * 1000).toLocaleString("zh-CN")} · {journal.submitter}</span></button>)}
      </details>
      {message && <p className="settings-message">{message}</p>}
    </section>
  </section>;
}
