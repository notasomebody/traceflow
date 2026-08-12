import { ArrowLeft, ArrowRight, Bot, Check, Clock3, Database, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import type { AiMode, AppSettings } from "./settings";

type Props = { initial: AppSettings; onComplete: (settings: AppSettings) => void; onSkip: () => void };
const steps = ["欢迎", "个人偏好", "本机监控", "AI 模式", "完成"];

export default function Onboarding({ initial, onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(initial);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setSettings(current => ({ ...current, [key]: value }));

  return <div className="onboarding-backdrop">
    <section className="onboarding-card">
      <aside className="onboarding-aside">
        <img src="/brand/xiaoyou-icon.svg" alt="小鱿"/>
        <h2>欢迎使用迹汇</h2>
        <p>让工作痕迹，自动成为汇报。</p>
        <ol>{steps.map((label, index) => <li key={label} className={index === step ? "current" : index < step ? "done" : ""}><span>{index < step ? <Check size={13}/> : index + 1}</span>{label}</li>)}</ol>
        <div className="onboarding-privacy"><ShieldCheck size={17}/><span>配置与工作数据默认只保存在本机</span></div>
      </aside>
      <div className="onboarding-content">
        <button className="skip-button" onClick={onSkip}>稍后配置</button>
        {step === 0 && <div className="guide-page hero-guide"><span className="guide-icon"><Sparkles/></span><p className="eyebrow">LOCAL-FIRST WORK ASSISTANT</p><h1>每天少整理一点，<br/>留下更多真实成果</h1><p>迹汇会在本机汇集代码、Jira 和工作记录。生成、修改和提交始终由你控制。</p><div className="security-chips"><span><LockKeyhole size={15}/>密码进入系统凭据库</span><span><ShieldCheck size={15}/>默认不上传工作内容</span></div></div>}
        {step === 1 && <div className="guide-page"><p className="eyebrow">BASIC PREFERENCES</p><h1>设置你的工作节奏</h1><p>之后可以随时在设置中修改。</p><label>怎么称呼你<input value={settings.displayName} onChange={event => update("displayName", event.target.value)} placeholder="例如：小陈"/></label><div className="form-grid"><label>每日默认工时<input type="number" min="0" max="24" step="0.5" value={settings.targetMinutes / 60} onChange={event => update("targetMinutes", Number(event.target.value) * 60)}/></label><label>日报生成时间<input type="time" value={settings.generateAt} onChange={event => update("generateAt", event.target.value)}/></label><label>允许提交时间<input type="time" value={settings.submitAfter} onChange={event => update("submitAfter", event.target.value)}/></label></div></div>}
        {step === 2 && <div className="guide-page"><p className="eyebrow">WINDOWS ACTIVITY</p><h1>授权本机工作监控</h1><p>只记录前台应用、窗口标题和活跃时长，不记录具体按键、鼠标内容、剪贴板或完整网址。你可以随时从托盘暂停。</p><div className="guide-options"><article><Database/><div><strong>数据只进入本机</strong><span>活动先进入待归类，由你创建项目并调整</span></div></article><article><Clock3/><div><strong>空闲和锁屏自动暂停</strong><span>默认 5 分钟无操作停止计时</span></div></article></div><label className="check-row"><input type="checkbox" checked={settings.monitoringEnabled} onChange={event => update("monitoringEnabled", event.target.checked)}/><span><strong>允许迹汇采集 Windows 工作活动</strong><small>默认关闭；勾选表示你已了解采集范围</small></span></label><label className="check-row"><input type="checkbox" checked={settings.metadataOnly} onChange={event => update("metadataOnly", event.target.checked)}/><span><strong>仅采集元数据</strong><small>截图识别仍保持关闭，需在设置中单独授权</small></span></label></div>}
        {step === 3 && <div className="guide-page"><p className="eyebrow">AI MODE</p><h1>选择汇报生成方式</h1><p>三种模式之后可以随时切换。</p><div className="ai-options">{([{"id":"EXPORT","title":"导出给 Codex 或其他 AI","text":"最容易开始，发送内容前可检查"},{"id":"LOCAL","title":"本地模型","text":"数据不离开电脑，需要本地模型环境"},{"id":"API","title":"自己的 API","text":"使用自己的服务商和密钥"}] as {id:AiMode;title:string;text:string}[]).map(item => <button key={item.id} className={settings.aiMode === item.id ? "selected" : ""} onClick={() => update("aiMode", item.id)}><Bot/><span><strong>{item.title}</strong><small>{item.text}</small></span><i>{settings.aiMode === item.id && <Check/>}</i></button>)}</div></div>}
        {step === 4 && <div className="guide-page complete-guide"><img src="/brand/xiaoyou-icon.svg" alt="小鱿"/><p className="eyebrow">READY</p><h1>小鱿准备好了</h1><p>{settings.monitoringEnabled ? "本机活动监控将在开始使用后启动。" : "本机活动监控保持关闭，可稍后在设置中授权。"} 迹汇将在 {settings.generateAt} 整理日报。</p><label className="check-row"><input type="checkbox" checked={settings.localStatistics} onChange={event => update("localStatistics", event.target.checked)}/><span><strong>启用仅本机使用统计</strong><small>只记录次数、成功状态和耗时，不记录工作正文</small></span></label></div>}
        <footer className="guide-actions"><button disabled={step === 0} onClick={() => setStep(value => value - 1)}><ArrowLeft/>上一步</button>{step < steps.length - 1 ? <button className="primary" onClick={() => setStep(value => value + 1)}>继续<ArrowRight/></button> : <button className="primary" onClick={() => onComplete(settings)}>开始使用<Check/></button>}</footer>
      </div>
    </section>
  </div>;
}
