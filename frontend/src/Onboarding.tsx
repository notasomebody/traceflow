import { ArrowLeft, ArrowRight, Bot, Check, Clock3, Database, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { AiMode, AppSettings } from "./settings";

type Props = { initial: AppSettings; onComplete: (settings: AppSettings) => void; onSkip: () => void };
const steps = ["工作习惯", "自动整理", "生成方式"];

export default function Onboarding({ initial, onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(initial);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setSettings(current => ({ ...current, [key]: value }));

  return <div className="onboarding-backdrop">
    <section className="onboarding-card">
      <aside className="onboarding-aside">
        <img src="/brand/xiaoyou-icon.svg" alt="小鱿"/>
        <h2>三步开始使用</h2>
        <p>其余选项以后再设置，不影响自动整理。</p>
        <ol>{steps.map((label, index) => <li key={label} className={index === step ? "current" : index < step ? "done" : ""}><span>{index < step ? <Check size={13}/> : index + 1}</span>{label}</li>)}</ol>
        <div className="onboarding-privacy"><ShieldCheck size={17}/><span>配置与工作数据默认只保存在本机</span></div>
      </aside>
      <div className="onboarding-content">
        <button className="skip-button" onClick={onSkip}>使用默认设置</button>
        {step === 0 && <div className="guide-page"><p className="eyebrow">WORK RHYTHM</p><h1>确认工作时间</h1><p>默认每天 8 小时，17:50 自动整理草稿。保持默认即可继续。</p><div className="form-grid"><label>每日默认工时<input type="number" min="0" max="24" step="0.5" value={settings.targetMinutes / 60} onChange={event => update("targetMinutes", Number(event.target.value) * 60)}/></label><label>日报生成时间<input type="time" value={settings.generateAt} onChange={event => update("generateAt", event.target.value)}/></label><label>允许提交时间<input type="time" value={settings.submitAfter} onChange={event => update("submitAfter", event.target.value)}/></label></div></div>}
        {step === 1 && <div className="guide-page"><p className="eyebrow">AUTOMATIC ORGANIZATION</p><h1>让迹汇自动整理</h1><p>只记录前台应用、窗口标题和活跃时长。低置信记录也会按主题进入日报，不要求逐条确认。</p><div className="guide-options"><article><Database/><div><strong>数据只进入本机</strong><span>系统会自动发现项目线索并聚合工作主题</span></div></article><article><Clock3/><div><strong>锁屏和空闲自动暂停</strong><span>截图和 OCR 默认关闭，需要时再单独授权</span></div></article></div><label className="check-row"><input type="checkbox" checked={settings.monitoringEnabled} onChange={event => update("monitoringEnabled", event.target.checked)}/><span><strong>开启本机工作活动监控</strong><small>可随时从主界面或托盘暂停</small></span></label><label className="check-row"><input type="checkbox" checked={settings.metadataOnly} onChange={event => update("metadataOnly", event.target.checked)}/><span><strong>仅采集元数据</strong><small>推荐保持开启，正文读取另行授权</small></span></label></div>}
        {step === 2 && <div className="guide-page"><p className="eyebrow">REPORT MODE</p><h1>选择生成方式</h1><p>不确定时保持“本地草稿”，以后可在设置中连接 API、本地模型或 Codex。</p><div className="ai-options">{([{"id":"EXPORT","title":"本地草稿 / 导出给 Codex","text":"推荐，零配置即可开始"},{"id":"LOCAL","title":"本地模型","text":"数据不离开电脑，需要本地模型环境"},{"id":"API","title":"自己的 API","text":"使用自己的服务商和密钥"}] as {id:AiMode;title:string;text:string}[]).map(item => <button key={item.id} className={settings.aiMode === item.id ? "selected" : ""} onClick={() => update("aiMode", item.id)}><Bot/><span><strong>{item.title}</strong><small>{item.text}</small></span><i>{settings.aiMode === item.id && <Check/>}</i></button>)}</div><label className="check-row"><input type="checkbox" checked={settings.localStatistics} onChange={event => update("localStatistics", event.target.checked)}/><span><strong>启用仅本机使用统计</strong><small>只记录次数和耗时，不记录工作正文</small></span></label></div>}
        <footer className="guide-actions"><button disabled={step === 0} onClick={() => setStep(value => value - 1)}><ArrowLeft/>上一步</button>{step < steps.length - 1 ? <button className="primary" onClick={() => setStep(value => value + 1)}>继续<ArrowRight/></button> : <button className="primary" onClick={() => onComplete(settings)}>开始使用<Check/></button>}</footer>
      </div>
    </section>
  </div>;
}
