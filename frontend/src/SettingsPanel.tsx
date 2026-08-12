import { Check, Clipboard, Download, KeyRound, LockKeyhole, Mail, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { exportShareCode, importShareCode, type AppSettings } from "./settings";
import { clearUsageStats, loadUsageStats, recordUsage } from "./usageStats";
import CapturePolicyEditor from "./CapturePolicyEditor";
import ScreenshotSettingsEditor from "./ScreenshotSettingsEditor";
import PrivacyControls from "./PrivacyControls";

type Props = { settings: AppSettings; supportEmail: string; onChange: (settings: AppSettings) => void; onClose: () => void; onRestartGuide: () => void };

export default function SettingsPanel({ settings, supportEmail, onChange, onClose, onRestartGuide }: Props) {
  const [tab, setTab] = useState<"general"|"privacy"|"share"|"support">("general");
  const [shareCode, setShareCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Partial<AppSettings>>();
  const [stats, setStats] = useState(() => loadUsageStats());
  useEffect(() => setMessage(""), [tab]);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const makeCode = async () => { const code = await exportShareCode(settings, password); setShareCode(code); setStats(recordUsage("shareExport", settings.localStatistics)); setMessage(password ? "已生成密码加密分享码" : "已生成离线分享码"); };
  const readCode = async () => { try { const imported = await importShareCode(shareCode, password); setPreview(imported); setStats(recordUsage("shareImport", settings.localStatistics)); setMessage("校验通过，请确认差异后应用"); } catch (error) { setPreview(undefined); setMessage(error instanceof Error ? error.message : "导入失败"); } };
  const copyCode = async () => { await navigator.clipboard.writeText(shareCode); setMessage("分享码已复制"); };
  return <div className="drawer-backdrop" onMouseDown={onClose}><section className="settings-drawer" onMouseDown={event => event.stopPropagation()}>
    <header><div><p className="eyebrow">PREFERENCES</p><h2>设置与隐私</h2></div><button onClick={onClose}><X/></button></header>
    <nav className="settings-tabs"><button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>常规</button><button className={tab === "privacy" ? "active" : ""} onClick={() => setTab("privacy")}>数据与隐私</button><button className={tab === "share" ? "active" : ""} onClick={() => setTab("share")}>配置分享</button><button className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}>帮助与反馈</button></nav>
    <div className="settings-body">
      {tab === "general" && <CapturePolicyEditor/>}
      {tab === "privacy" && <ScreenshotSettingsEditor/>}
      {tab === "privacy" && <PrivacyControls api="http://127.0.0.1:17890/api"/>}
      {tab === "general" && <><h3>工作偏好</h3><div className="settings-fields"><label>每日默认工时<input type="number" min="0" max="24" step="0.5" value={settings.targetMinutes / 60} onChange={event => update("targetMinutes", Number(event.target.value) * 60)}/></label><label>日报生成时间<input type="time" value={settings.generateAt} onChange={event => update("generateAt", event.target.value)}/></label><label>允许提交时间<input type="time" value={settings.submitAfter} onChange={event => update("submitAfter", event.target.value)}/></label></div><label className="toggle-row"><span><strong>Windows 工作活动监控</strong><small>记录前台应用、窗口标题和活跃时长；不记录按键内容</small></span><input type="checkbox" checked={settings.monitoringEnabled} onChange={event => update("monitoringEnabled", event.target.checked)}/></label><div className="fixed-setting"><strong>关闭窗口时缩小到托盘</strong><small>一期固定开启，避免误关程序；可从托盘彻底退出。</small></div><button className="secondary-action" onClick={onRestartGuide}><RotateCcw/>重新运行首次引导</button></>}
      {tab === "privacy" && <><h3>本机数据与隐私</h3><div className="privacy-cards"><article><LockKeyhole/><div><strong>当前安全边界</strong><p>本地接口只监听 127.0.0.1；一期尚未接入账号凭据，不会保存 Jira、企业微信或内网平台密码。</p></div></article><article><ShieldCheck/><div><strong>AI 导出</strong><p>仅复制到系统剪贴板，不会由迹汇上传；粘贴到外部 AI 前请自行检查和脱敏。</p></div></article></div><label className="toggle-row"><span><strong>默认仅采集元数据</strong><small>一期自动采集连接器尚未开放</small></span><input type="checkbox" checked={settings.metadataOnly} onChange={event => update("metadataOnly", event.target.checked)}/></label><label className="toggle-row"><span><strong>仅本机使用统计</strong><small>只记录按钮使用次数，不上传、不记录正文</small></span><input type="checkbox" checked={settings.localStatistics} onChange={event => update("localStatistics", event.target.checked)}/></label><div className="local-stats"><strong>本机使用次数</strong><span>生成 {stats.generate} · 确认 {stats.confirm} · 复制 {stats.copy} · AI 导出 {stats.aiExport} · 分享 {stats.shareExport + stats.shareImport}</span><button onClick={() => { clearUsageStats(); setStats(loadUsageStats()); setMessage("本机统计已清空"); }}>清空统计</button></div></>}
      {tab === "share" && <><h3>离线配置分享码</h3><p className="settings-copy">分享码不依赖服务器，并自动排除姓名、密码、令牌、Cookie、报告和历史记录。公司内网地址应仅分享给可信人员。</p><label>可选分享密码<div className="input-with-icon"><KeyRound/><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="留空生成普通分享码"/></div></label><button className="primary-action" onClick={() => void makeCode()}><Download/>生成分享码</button><label>分享码<textarea value={shareCode} onChange={event => { setShareCode(event.target.value); setPreview(undefined); }} placeholder="生成分享码，或粘贴别人发给你的分享码"/></label><div className="inline-actions"><button onClick={() => void copyCode()} disabled={!shareCode}><Clipboard/>复制</button><button onClick={() => void readCode()} disabled={!shareCode}><Upload/>校验并预览</button></div>{preview && <div className="import-preview"><strong>即将导入</strong><dl><div><dt>默认工时</dt><dd>{(preview.targetMinutes ?? 480) / 60} 小时</dd></div><div><dt>生成 / 提交</dt><dd>{preview.generateAt} / {preview.submitAfter}</dd></div><div><dt>AI 模式</dt><dd>{preview.aiMode}</dd></div></dl><button className="primary-action" onClick={() => { onChange({ ...settings, ...preview }); setPreview(undefined); setMessage("配置已合并，可继续修改"); }}><Check/>确认合并</button></div>}</>}
      {tab === "support" && <><h3>帮助与反馈</h3><p className="settings-copy">反馈邮件默认只包含版本和系统信息。诊断包需由你主动生成和检查，不包含密码、源码或报告正文。</p><a className="primary-action link-action" href={`mailto:${supportEmail}?subject=${encodeURIComponent("迹汇 TraceFlow 使用反馈")}&body=${encodeURIComponent("问题类型：\n问题描述：\n复现步骤：\n\n我已确认邮件中不包含敏感工作内容。")}`}><Mail/>发送反馈邮件</a><div className="support-address"><span>反馈邮箱</span><strong>{supportEmail || "尚未配置"}</strong></div></>}
      {message && <p className="settings-message">{message}</p>}
    </div>
  </section></div>;
}
