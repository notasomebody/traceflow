import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./settings";

export type AutoOrganizerStatus = {
  enabled: boolean;
  lastScanAt?: string;
  discoveredFiles: number;
  importedFiles: number;
  lastError?: string;
};

export type WeComHistoryStatus = {
  stage: "IDLE" | "WAITING_FOR_WE_COM" | "RUNNING" | "PAUSED_FOR_USER" | "COMPLETED" | "ERROR";
  visitedRows: number;
  importedReports: number;
  message: string;
};

const desktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function applyAutoOrganizerSettings(settings: AppSettings) {
  if (!desktop()) return;
  await invoke("set_auto_organizer_settings", { settings: {
    enabled: settings.monitoringEnabled,
    fileDiscoveryEnabled: true,
    fileContentAuthorized: settings.fileContentAuthorized,
    autoCreateProjects: true,
    wecomPassiveCaptureEnabled: settings.wecomPassiveCapture,
    wecomIdleSyncEnabled: settings.wecomIdleSync,
    wecomHistoryDays: settings.wecomHistoryDays,
  }});
}

export async function scanWorkArtifactsNow() {
  if (!desktop()) return null;
  return invoke<AutoOrganizerStatus>("scan_work_artifacts_now");
}

export async function getWeComHistoryStatus() {
  if (!desktop()) return null;
  return invoke<WeComHistoryStatus>("wecom_history_status");
}

export async function startWeComHistorySync(historyDays: number) {
  if (!desktop()) throw new Error("此功能仅在迹汇桌面版中可用");
  return invoke<WeComHistoryStatus>("start_wecom_history_sync", { historyDays });
}

export async function stopWeComHistorySync() {
  if (!desktop()) return;
  await invoke("stop_wecom_history_sync");
}
