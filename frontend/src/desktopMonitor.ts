import { invoke } from "@tauri-apps/api/core";

export type MonitorStatus = "DISABLED" | "PAUSED" | "IDLE" | "COLLECTING" | "ERROR" | "UNAVAILABLE";
export type WorkInterval = { weekday: number; start_minute: number; end_minute: number };
export type CapturePolicy = { work_intervals: WorkInterval[]; excluded_applications: string[]; excluded_dates: string[]; additional_work_dates: string[]; idle_threshold_seconds: number };

const isDesktop = () => "__TAURI_INTERNALS__" in window;

export async function getMonitorStatus(): Promise<MonitorStatus> {
  if (!isDesktop()) return "UNAVAILABLE";
  return invoke<MonitorStatus>("monitor_status");
}

export async function setMonitorEnabled(enabled: boolean): Promise<MonitorStatus> {
  if (!isDesktop()) return "UNAVAILABLE";
  return invoke<MonitorStatus>("set_monitor_enabled", { enabled });
}

export async function pauseMonitor(minutes: number): Promise<MonitorStatus> {
  if (!isDesktop()) return "UNAVAILABLE";
  return invoke<MonitorStatus>("pause_monitor", { minutes });
}

export async function getCapturePolicy(): Promise<CapturePolicy | null> {
  if (!isDesktop()) return null;
  return invoke<CapturePolicy>("capture_policy");
}

export async function saveCapturePolicy(policy: CapturePolicy): Promise<CapturePolicy> {
  if (!isDesktop()) throw new Error("采集策略只能在桌面版修改");
  return invoke<CapturePolicy>("set_capture_policy", { policy });
}

export function weekdayPolicy(startMorning: number, endMorning: number, startAfternoon: number, endAfternoon: number, excludedApplications: string[], excludedDates: string[], additionalWorkDates: string[], idleThresholdSeconds: number): CapturePolicy {
  const work_intervals: WorkInterval[] = [];
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    work_intervals.push({ weekday, start_minute: startMorning, end_minute: endMorning });
    work_intervals.push({ weekday, start_minute: startAfternoon, end_minute: endAfternoon });
  }
  return { work_intervals, excluded_applications: excludedApplications, excluded_dates: excludedDates, additional_work_dates: additionalWorkDates, idle_threshold_seconds: idleThresholdSeconds };
}
