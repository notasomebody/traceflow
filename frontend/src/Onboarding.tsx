import { Check, Clock3, FileSearch, MonitorCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { AppSettings } from "./settings";

type Props = { initial: AppSettings; onComplete: (settings: AppSettings) => void; onSkip: () => void };

export default function Onboarding({ initial, onComplete, onSkip }: Props) {
  const [readContent, setReadContent] = useState(initial.fileContentAuthorized);
  const [targetHours, setTargetHours] = useState(initial.targetMinutes / 60);
  const start = () => onComplete({
    ...initial,
    targetMinutes: targetHours * 60,
    monitoringEnabled: true,
    metadataOnly: !readContent,
    fileContentAuthorized: readContent,
    wecomPassiveCapture: true,
    wecomIdleSync: true,
    wecomHistoryDays: 90,
  });

  return <div className="onboarding-backdrop">
    <section className="onboarding-card onboarding-single">
      <aside className="onboarding-aside">
        <img src="/brand/xiaoyou-icon.svg" alt="小鱿"/>
        <h2>迹汇 TraceFlow</h2>
        <p>安装一次，之后每天只检查一次结果。</p>
        <div className="onboarding-flow">
          <span><MonitorCheck/>自动发现工作</span>
          <span><FileSearch/>自动归到项目</span>
          <span><Check/>17:50 生成日报</span>
        </div>
        <div className="onboarding-privacy"><ShieldCheck size={17}/><span>工作数据默认只保存在本机；不会记录按键，也不会扫描整块硬盘。</span></div>
      </aside>
      <div className="onboarding-content">
        <button className="skip-button" onClick={onSkip}>暂不启用</button>
        <div className="guide-page">
          <p className="eyebrow">ZERO-ORGANIZING</p>
          <h1>让迹汇自动整理今天的工作</h1>
          <p>迹汇会根据前台应用、窗口标题和今天实际修改的工作文件形成工作线索。高置信度内容自动归类，低置信度按主题汇总，不再要求逐条确认。</p>
          <div className="guide-options">
            <article><MonitorCheck/><div><strong>自动采集工作线索</strong><span>锁屏与空闲时自动暂停；你操作电脑时，企业微信历史读取也会立即让路。</span></div></article>
            <article><Clock3/><div><strong>每天只做一次最终检查</strong><span>默认 17:50 生成日报，目标工时可随时调整。</span></div></article>
          </div>
          <div className="form-grid onboarding-essential">
            <label>每日默认工时<input aria-label="每日默认工时" type="number" min="0" max="24" step="0.5" value={targetHours} onChange={event => setTargetHours(Number(event.target.value))}/></label>
          </div>
          <label className="check-row">
            <input aria-label="允许读取今天实际修改的工作文件正文" type="checkbox" checked={readContent} onChange={event => setReadContent(event.target.checked)}/>
            <span><strong>允许读取今天实际修改的工作文件正文</strong><small>只读已打开或修改的工作文件；自动排除密钥、凭据、构建目录和大文件。关闭时仅使用文件名与时间。</small></span>
          </label>
        </div>
        <footer className="guide-actions single-actions">
          <span><ShieldCheck/>截图识别和本地 OCR 仍保持关闭，需要时单独授权。</span>
          <button className="primary" onClick={start}>开始自动整理<Check/></button>
        </footer>
      </div>
    </section>
  </div>;
}
