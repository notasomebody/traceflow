import { invoke } from "@tauri-apps/api/core";
import { Download, Power, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type BackupResponse = { backup: string | null; restoredCount: number };

export default function PrivacyControls({ api }: { api: string }) {
  const [autostart, setAutostartState] = useState(false);
  const [password, setPassword] = useState("");
  const [backupText, setBackupText] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const desktop = "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    if (desktop) void invoke<boolean>("autostart_status").then(setAutostartState).catch(() => undefined);
  }, [desktop]);

  const setAutostart = async (enabled: boolean) => {
    try {
      setAutostartState(await invoke("set_autostart", { enabled }));
      setMessage(enabled ? "已设置为当前 Windows 用户登录后自动启动" : "已关闭开机自动启动");
    } catch (error) { setMessage(String(error)); }
  };

  const exportBackup = async () => {
    if (password.length < 8) { setMessage("备份密码至少需要 8 位"); return; }
    try {
      const response = await fetch(`${api}/backups/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error("生成加密备份失败");
      const result = await response.json() as BackupResponse;
      if (!result.backup) throw new Error("备份内容为空");
      const url = URL.createObjectURL(new Blob([result.backup], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url; link.download = `TraceFlow-${new Date().toISOString().slice(0, 10)}.tfbackup`; link.click();
      URL.revokeObjectURL(url);
      setMessage("加密备份已生成。请妥善保管密码，密码无法找回");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const chooseBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { setMessage("备份文件不能超过 50 MB"); return; }
    setBackupText((await file.text()).trim());
    setMessage(`已读取 ${file.name}，确认后才会覆盖本机数据`);
  };

  const importBackup = async () => {
    if (!backupText) { setMessage("请先选择 .tfbackup 文件"); return; }
    if (password.length < 8) { setMessage("请输入导出时使用的备份密码"); return; }
    if (!window.confirm("恢复会覆盖当前项目、活动、OCR、日报、周报和月报数据。建议先导出当前备份。是否继续？")) return;
    try {
      const response = await fetch(`${api}/backups/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backup: backupText, password }) });
      if (!response.ok) throw new Error(response.status === 400 ? "密码错误、文件损坏或版本不受支持" : "恢复备份失败");
      const result = await response.json() as BackupResponse;
      setMessage(`已恢复 ${result.restoredCount} 条数据，正在刷新界面`);
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const clearAll = async () => {
    if (!window.confirm("将永久删除所有活动、OCR、项目、日报、周报、月报、截图缓存、日志和 AI 密钥。此操作无法撤销，是否继续？")) return;
    const phrase = window.prompt("请输入“彻底清除”以确认");
    if (phrase !== "彻底清除") { setMessage("已取消清理"); return; }
    try {
      const response = await fetch(`${api}/privacy/all-data`, { method: "DELETE" });
      if (!response.ok) throw new Error("本地数据库清理失败");
      if (desktop) await invoke("clear_desktop_private_data");
      localStorage.removeItem("traceflow.usage.stats.v1");
      setMessage("所有本机隐私数据已清理，请重启 TraceFlow");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <section className="privacy-controls">
    <div className="privacy-control-title"><ShieldAlert/><div><strong>系统、备份与隐私操作</strong><span>数据默认只保存在当前电脑；备份由你的密码独立加密</span></div></div>
    <label className="toggle-row"><span><strong>开机自动启动</strong><small>当前 Windows 用户登录后启动 TraceFlow，不需要管理员权限</small></span><input type="checkbox" checked={autostart} disabled={!desktop} onChange={event => void setAutostart(event.target.checked)}/></label>
    <div className="backup-controls">
      <label>备份密码<input type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 8 位；TraceFlow 不保存此密码"/></label>
      <div className="backup-actions"><button onClick={() => void exportBackup()}><Download/>导出加密备份</button><button onClick={() => fileInput.current?.click()}><Upload/>选择备份文件</button></div>
      <input ref={fileInput} hidden type="file" accept=".tfbackup,application/octet-stream" onChange={event => void chooseBackup(event.target.files?.[0])}/>
      {backupText && <button className="restore-action" onClick={() => void importBackup()}><Upload/>确认并恢复备份</button>}
      <small>备份可复制到另一台电脑恢复，不依赖原电脑；不包含 AI API Key、系统凭据和截图原图。</small>
    </div>
    <button className="danger-action" onClick={() => void clearAll()}><Trash2/>彻底清除本机数据</button>
    <p className="danger-copy"><Power/>清理前会停止监控和截图，并删除 Windows 凭据中的 AI Key。</p>
    {message && <p className="settings-message">{message}</p>}
  </section>;
}
