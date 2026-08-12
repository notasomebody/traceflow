import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Camera, Eye, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

type ScreenshotSettings = { enabled: boolean; interval_minutes: number; retain_raw_days: number };
type ScreenshotPreview = { image_path?: string; ocr_text: string };
const isDesktop = () => "__TAURI_INTERNALS__" in window;

export default function ScreenshotSettingsEditor() {
  const [settings, setSettings] = useState<ScreenshotSettings>();
  const [preview, setPreview] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isDesktop()) return;
    void invoke<ScreenshotSettings>("screenshot_settings").then(setSettings).catch(() => setMessage("无法读取截图设置"));
  }, []);

  const update = <K extends keyof ScreenshotSettings>(key: K, value: ScreenshotSettings[K]) => setSettings(current => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (!settings) return;
    try { setSettings(await invoke("set_screenshot_settings", { settings })); setMessage("截图隐私设置已保存到本机"); }
    catch (error) { setMessage(String(error)); }
  };
  const capture = async () => {
    setBusy(true); setMessage("请在 2 秒内切换到要预览的窗口…");
    try {
      const result = await invoke<ScreenshotPreview>("capture_screenshot_preview", { delaySeconds: 2 });
      setPreview(result.image_path ? convertFileSrc(result.image_path) : "");
      setOcrText(result.ocr_text);
      setMessage(result.image_path ? "原图已按留存设置保存在本机" : "本地 OCR 完成，原图已立即删除");
    }
    catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  if (!isDesktop()) return <section className="screenshot-settings unavailable"><Camera/><div><strong>活动窗口截图</strong><span>仅 Windows 桌面版可用，默认关闭</span></div></section>;
  if (!settings) return <section className="screenshot-settings"><LoaderCircle className="spin"/><span>读取截图隐私设置…</span></section>;
  return <section className="screenshot-settings">
    <div className="screenshot-title"><Camera/><div><strong>活动窗口截图识别</strong><span>默认关闭；不截全屏，不自动上传</span></div></div>
    <label className="toggle-row"><span><strong>允许定时截取活动窗口</strong><small>开启后仍会跳过密码管理器、登录和提权窗口</small></span><input type="checkbox" checked={settings.enabled} onChange={event => update("enabled", event.target.checked)}/></label>
    <label>采集频率：{settings.interval_minutes} 分钟<input type="range" min="1" max="30" value={settings.interval_minutes} onChange={event => update("interval_minutes", Number(event.target.value))}/></label>
    <label>原图保留<select value={settings.retain_raw_days} onChange={event => update("retain_raw_days", Number(event.target.value))}><option value="0">OCR 后立即删除（推荐）</option><option value="1">1 天</option><option value="3">3 天</option><option value="7">7 天</option></select></label>
    <div className="inline-actions"><button onClick={() => void save()}><ShieldCheck/>保存设置</button><button onClick={() => void capture()} disabled={busy}><Eye/>{busy ? "等待切换窗口" : "2 秒后手动预览"}</button></div>
    {preview && <img className="screenshot-preview" src={preview} alt="本地活动窗口截图预览"/>}
    {ocrText && <label>本地 OCR 结果<textarea className="ocr-preview" value={ocrText} readOnly/></label>}
    {message && <p className="settings-message">{message}</p>}
  </section>;
}
