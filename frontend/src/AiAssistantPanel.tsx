import { invoke } from "@tauri-apps/api/core";
import { Bot, Check, KeyRound, LoaderCircle, Send, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AiProvider, AppSettings } from "./settings";

type Props = { settings: AppSettings; onChange: (settings: AppSettings) => void; summary: string; nextPlan: string };
type AiResponse = { content: string; provider: string; model: string };
const secretId = (provider: AiProvider) => provider === "OPENAI" ? "openai" : provider === "COMPATIBLE" ? "compatible" : provider === "CODEX" ? "codex" : "";
const isDesktop = () => "__TAURI_INTERNALS__" in window;

export default function AiAssistantPanel({ settings, onChange, summary, nextPlan }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");
  const id = secretId(settings.aiProvider);
  const prompt = useMemo(() => `请将以下工作汇报润色为真实、充实、专业的中文汇报。不得虚构事实、数据或完成项。\n\n工作总结：\n${summary}\n\n下一步计划：\n${nextPlan}`, [summary, nextPlan]);

  useEffect(() => {
    if (!isDesktop() || !id) { setHasSecret(false); return; }
    void invoke<boolean>("ai_secret_status", { secretId: id }).then(setHasSecret).catch(() => setHasSecret(false));
  }, [id]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const saveKey = async () => {
    if (!id || !apiKey) return;
    try { await invoke("save_ai_secret", { secretId: id, value: apiKey }); setApiKey(""); setHasSecret(true); setMessage("API Key 已保存到 Windows 凭据管理器"); }
    catch (error) { setMessage(String(error)); }
  };
  const removeKey = async () => {
    if (!id) return;
    try { await invoke("delete_ai_secret", { secretId: id }); setHasSecret(false); setMessage("密钥已删除"); } catch (error) { setMessage(String(error)); }
  };
  const generate = async () => {
    setBusy(true);
    try {
      const response = await invoke<AiResponse>("generate_with_ai", { request: { provider: settings.aiProvider, baseUrl: settings.aiBaseUrl || null, model: settings.aiModel, prompt } });
      setResult(response.content); setPreviewing(false); setMessage(`${response.provider} 已返回结果，内容未自动覆盖原报告`);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  return <section className="panel ai-panel">
    <div className="panel-heading"><div><p className="eyebrow">AI ASSISTANT</p><h2>AI 润色与 Codex</h2></div><span className="privacy-chip"><ShieldCheck/>发送前必须确认</span></div>
    <div className="ai-config"><label>提供方<select value={settings.aiProvider} onChange={event => update("aiProvider", event.target.value as AiProvider)}><option value="OPENAI">OpenAI</option><option value="COMPATIBLE">OpenAI 兼容接口</option><option value="OLLAMA">Ollama 本机</option><option value="CODEX">Codex 本地引擎</option></select></label><label>模型<input value={settings.aiModel} onChange={event => update("aiModel", event.target.value)}/></label>{(settings.aiProvider === "COMPATIBLE" || settings.aiProvider === "OLLAMA") && <label className="wide">接口地址<input value={settings.aiBaseUrl} onChange={event => update("aiBaseUrl", event.target.value)} placeholder={settings.aiProvider === "OLLAMA" ? "http://127.0.0.1:11434/api/chat" : "https://example.com/v1/chat/completions"}/></label>}</div>
    {id && <div className="key-row"><KeyRound/><span>{hasSecret ? "密钥已安全保存" : "未配置密钥"}</span><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="输入后不可回读"/><button onClick={() => void saveKey()} disabled={!apiKey}><Check/>保存</button>{hasSecret && <button onClick={() => void removeKey()}><Trash2/></button>}</div>}
    {!previewing ? <button className="primary-action" onClick={() => setPreviewing(true)} disabled={!summary.trim()}><Bot/>预览将要发送的内容</button> : <div className="ai-preview"><strong>仅以下文本将发送给 {settings.aiProvider}</strong><pre>{prompt}</pre><div className="inline-actions"><button onClick={() => setPreviewing(false)}>取消</button><button className="primary-action" onClick={() => void generate()} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Send/>}我已检查，确认发送</button></div></div>}
    {result && <label className="ai-result">AI 返回结果<textarea value={result} onChange={event => setResult(event.target.value)}/><button className="secondary-action" onClick={() => void navigator.clipboard.writeText(result)}>复制结果</button></label>}
    {message && <p className="settings-message">{message}</p>}
  </section>;
}
