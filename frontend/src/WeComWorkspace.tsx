import { Check, ClipboardPaste, Eye, FileInput, LoaderCircle, MessageSquareText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ImportedReport = { reportDate: string; summary: string; nextPlan: string; targetMinutes: number; status: string };

export default function WeComWorkspace({ api }: { api: string }) {
  const [date,setDate] = useState("");
  const [summary,setSummary] = useState("");
  const [nextPlan,setNextPlan] = useState("");
  const [targetMinutes,setTargetMinutes] = useState(480);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [reading,setReading] = useState(false);

  const paste = async () => {
    try { setSummary(await navigator.clipboard.readText()); setMessage("已粘贴到预览区，请拆分并检查内容"); }
    catch { setMessage("无法读取剪贴板，请检查系统权限或手动粘贴"); }
  };
  const importReport = async () => {
    if (!date || !summary.trim() || !nextPlan.trim()) { setMessage("请填写日期、工作总结和下一步计划"); return; }
    if (!window.confirm(`将把 ${date} 的内容保存为历史日报；同日期已有记录时会保留新版本。确认导入？`)) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/reports/daily/import`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date,summary,nextPlan,targetMinutes}) });
      if (!response.ok) throw new Error(`本地服务返回 ${response.status}`);
      const report:ImportedReport = await response.json();
      setMessage(`${report.reportDate} 已导入本机历史，正文已加密保存`);
    } catch (error) { setMessage(`导入失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  };
  const readCurrentWeCom = async () => {
    if (!("__TAURI_INTERNALS__" in window)) { setMessage("此功能仅在迹汇 Windows 桌面版中可用"); return; }
    setReading(true); setMessage("请在 3 秒内切换到企业微信，并打开目标汇报正文…");
    try {
      const result = await invoke<{ocr_text:string}>("capture_wecom_uia_preview", { delaySeconds:3 });
      setSummary(result.ocr_text); setMessage("已读取当前企业微信窗口，请检查并拆分总结与计划后再导入");
    } catch (error) { setMessage(String(error)); }
    finally { setReading(false); }
  };

  return <section className="integration-page">
    <header className="integration-hero"><div className="integration-icon"><MessageSquareText/></div><div><p className="eyebrow">WECOM / LOCAL IMPORT</p><h1>企业微信汇报</h1><p>当前版本支持把你确认过的企业微信历史日报导入本机，用于历史查询和后续风格参考。</p></div></header>
    <div className="integration-grid">
      <section className="panel import-card"><div className="panel-heading"><div><p className="eyebrow">IMPORT</p><h2>导入历史日报</h2></div><FileInput/></div>
        <div className="privacy-note"><ShieldCheck/><span>不会后台扫描企业微信；只有你主动粘贴并确认的正文才写入本机加密数据库。</span></div>
        <label>日报日期<input type="date" value={date} onChange={event => setDate(event.target.value)}/></label>
        <label>今日工作总结<textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="从企业微信复制历史日报内容，或手动填写…"/></label>
        <label>下一步计划<textarea value={nextPlan} onChange={event => setNextPlan(event.target.value)} placeholder="填写当时日报中的明日计划…"/></label>
        <label>当日工时<input type="number" min="0" max="1440" step="30" value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}/><span>分钟</span></label>
        <div className="integration-actions three"><button onClick={() => void readCurrentWeCom()} disabled={reading}>{reading ? <LoaderCircle className="spin"/> : <Eye/>}读取当前企业微信</button><button onClick={() => void paste()}><ClipboardPaste/>从剪贴板粘贴</button><button className="primary-action" onClick={() => void importReport()} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Check/>}确认导入本机</button></div>
        {message && <p className="settings-message">{message}</p>}
      </section>
      <aside className="panel capability-card"><Eye/><h2>查看企业微信历史</h2><p>企业微信客户端没有提供当前可用的历史汇报 API，因此迹汇只读取你主动打开的当前窗口，不会后台遍历全部历史。</p><ol><li>点击“读取当前企业微信”</li><li>3 秒内切换到目标汇报正文</li><li>回到迹汇检查识别结果</li><li>确认后进入“历史记录”页面</li></ol><strong>读取需要先在“设置 → 数据与隐私”开启 UI Automation；不会触发截图 OCR。</strong></aside>
    </div>
  </section>;
}
