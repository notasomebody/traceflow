import { BrainCircuit, Check, Clipboard, Download, KeyRound, LockKeyhole, Mail, Plug, RotateCcw, Settings2, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import AiAssistantPanel from "./AiAssistantPanel";
import CapturePolicyEditor from "./CapturePolicyEditor";
import PrivacyControls from "./PrivacyControls";
import ScreenshotSettingsEditor from "./ScreenshotSettingsEditor";
import WeComWorkspace from "./WeComWorkspace";
import { exportShareCode, importShareCode, type AppSettings } from "./settings";
import { clearUsageStats, loadUsageStats, recordUsage } from "./usageStats";

type Tab = "habits" | "automation" | "connections" | "privacy";
type Props = {
  settings: AppSettings;
  supportEmail: string;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  onRestartGuide: () => void;
};

export default function SettingsPanel({ settings, supportEmail, onChange, onClose, onRestartGuide }: Props) {
  const [tab, setTab] = useState<Tab>("habits");
  const [shareCode, setShareCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Partial<AppSettings>>();
  const [stats, setStats] = useState(() => loadUsageStats());
  useEffect(() => setMessage(""), [tab]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const makeCode = async () => {
    const code = await exportShareCode(settings, password);
    setShareCode(code);
    setStats(recordUsage("shareExport", settings.localStatistics));
    setMessage(password ? "已生成密码加密分享码" : "已生成完全离线分享码");
  };
  const readCode = async () => {
    try {
      const imported = await importShareCode(shareCode, password);
      setPreview(imported);
      setStats(recordUsage("shareImport", settings.localStatistics));
      setMessage("校验通过，请确认后应用");
    } catch (error) {
      setPreview(undefined);
      setMessage(error instanceof Error ? error.message : "导入失败");
    }
  };

  return <div className="drawer-backdrop" onMouseDown={onClose}>
    <section className="settings-drawer" onMouseDown={event => event.stopPropagation()}>
      <header><div><p className="eyebrow">PREFERENCES</p><h2>设置</h2></div><button onClick={onClose} aria-label="关闭设置"><X/></button></header>
      <nav className="settings-tabs settings-entry-tabs">
        <button className={tab === "habits" ? "active" : ""} onClick={() => setTab("habits")}><Settings2/>工作习惯</button>
        <button className={tab === "automation" ? "active" : ""} onClick={() => setTab("automation")}><BrainCircuit/>自动整理</button>
        <button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><Plug/>连接服务</button>
        <button className={tab === "privacy" ? "active" : ""} onClick={() => setTab("privacy")}><ShieldCheck/>数据与安全</button>
      </nav>
      <div className="settings-body">
        {tab === "habits" && <>
          <h3>工作习惯</h3>
          <div className="settings-fields">
            <label>每日默认工时<input type="number" min="0" max="24" step="0.5" value={settings.targetMinutes / 60} onChange={event => update("targetMinutes", Number(event.target.value) * 60)}/></label>
            <label>日报生成时间<input type="time" value={settings.generateAt} onChange={event => update("generateAt", event.target.value)}/></label>
            <label>允许提交时间<input type="time" value={settings.submitAfter} onChange={event => update("submitAfter", event.target.value)}/></label>
          </div>
          <CapturePolicyEditor/>
          <div className="fixed-setting"><strong>关闭窗口时缩小到托盘</strong><small>默认开启，避免误关程序；可从托盘彻底退出。</small></div>
          <button className="secondary-action" onClick={onRestartGuide}><RotateCcw/>重新运行首次引导</button>
        </>}

        {tab === "automation" && <>
          <h3>自动整理</h3>
          <label className="toggle-row"><span><strong>自动采集并整理工作</strong><small>仅记录应用、窗口标题和活跃时长，不记录按键内容</small></span><input type="checkbox" checked={settings.monitoringEnabled} onChange={event => update("monitoringEnabled", event.target.checked)}/></label>
          <label className="toggle-row"><span><strong>读取今天修改的工作文件正文</strong><small>只读工作目录中的文本类文件；自动排除密钥、凭据、构建目录和大文件</small></span><input type="checkbox" checked={settings.fileContentAuthorized} onChange={event => onChange({ ...settings, fileContentAuthorized:event.target.checked, metadataOnly:!event.target.checked })}/></label>
          <label className="toggle-row"><span><strong>企业微信使用时被动学习</strong><small>仅在你打开汇报正文时读取；UI Automation 优先，本地 OCR 需另行授权</small></span><input type="checkbox" checked={settings.wecomPassiveCapture} onChange={event => update("wecomPassiveCapture", event.target.checked)}/></label>
          <label className="toggle-row"><span><strong>空闲时补齐企业微信历史</strong><small>你一操作电脑就暂停，并从已保存进度继续</small></span><input type="checkbox" checked={settings.wecomIdleSync} onChange={event => update("wecomIdleSync", event.target.checked)}/></label>
          <ScreenshotSettingsEditor/>
          <AiAssistantPanel settings={settings} onChange={onChange} summary="" nextPlan=""/>
        </>}

        {tab === "connections" && <>
          <h3>连接服务</h3>
          <p className="settings-copy">普通用户只需选择“读取当前企业微信”或粘贴；企业管理员接口收在高级连接中。</p>
          <WeComWorkspace api="http://127.0.0.1:17890/api"/>
        </>}

        {tab === "privacy" && <>
          <h3>数据与安全</h3>
          <div className="privacy-cards">
            <article><LockKeyhole/><div><strong>本地优先</strong><p>本地接口只监听 127.0.0.1，报告、OCR 和活动标题均加密保存。</p></div></article>
            <article><ShieldCheck/><div><strong>发送前确认</strong><p>外部 AI 和企业微信提交均在你确认后执行，失败时保留草稿。</p></div></article>
          </div>
          <PrivacyControls api="http://127.0.0.1:17890/api"/>
          <label className="toggle-row"><span><strong>仅本机使用统计</strong><small>只记录功能使用次数，不上传、不记录正文</small></span><input type="checkbox" checked={settings.localStatistics} onChange={event => update("localStatistics", event.target.checked)}/></label>
          <div className="local-stats"><strong>本机使用次数</strong><span>生成 {stats.generate} · 确认 {stats.confirm} · 复制 {stats.copy} · AI {stats.aiExport} · 分享 {stats.shareExport + stats.shareImport}</span><button onClick={() => { clearUsageStats(); setStats(loadUsageStats()); setMessage("本机统计已清空"); }}>清空统计</button></div>

          <details className="settings-details"><summary>离线配置分享</summary>
            <p className="settings-copy">分享码自动排除姓名、密码、令牌、报告和历史记录。</p>
            <label>可选分享密码<div className="input-with-icon"><KeyRound/><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="留空生成普通分享码"/></div></label>
            <button className="primary-action" onClick={() => void makeCode()}><Download/>生成分享码</button>
            <label>分享码<textarea value={shareCode} onChange={event => { setShareCode(event.target.value); setPreview(undefined); }} placeholder="生成或粘贴完全离线分享码"/></label>
            <div className="inline-actions"><button onClick={() => void navigator.clipboard.writeText(shareCode)} disabled={!shareCode}><Clipboard/>复制</button><button onClick={() => void readCode()} disabled={!shareCode}><Upload/>校验并预览</button></div>
            {preview && <div className="import-preview"><strong>即将导入</strong><p>默认工时 {(preview.targetMinutes ?? 480) / 60} 小时，生成时间 {preview.generateAt}</p><button className="primary-action" onClick={() => { onChange({ ...settings, ...preview }); setPreview(undefined); setMessage("配置已合并"); }}><Check/>确认合并</button></div>}
          </details>

          <details className="settings-details"><summary>帮助与反馈</summary>
            <p className="settings-copy">反馈邮件不会自动附带报告正文、密码或源码。</p>
            <a className="primary-action link-action" href={`mailto:${supportEmail}?subject=${encodeURIComponent("迹汇 TraceFlow 使用反馈")}&body=${encodeURIComponent("问题类型：\n问题描述：\n复现步骤：\n\n我已确认邮件中不包含敏感工作内容。")}`}><Mail/>发送反馈邮件</a>
          </details>
        </>}
        {message && <p className="settings-message">{message}</p>}
      </div>
    </section>
  </div>;
}
