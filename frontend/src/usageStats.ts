export type UsageAction = "generate" | "confirm" | "copy" | "aiExport" | "shareExport" | "shareImport";

export type UsageStats = {
  generate: number;
  confirm: number;
  copy: number;
  aiExport: number;
  shareExport: number;
  shareImport: number;
  lastUsedAt?: string;
};

const STATS_KEY = "traceflow.usage-stats.v1";
export const EMPTY_USAGE_STATS: UsageStats = { generate: 0, confirm: 0, copy: 0, aiExport: 0, shareExport: 0, shareImport: 0 };

export function loadUsageStats(): UsageStats {
  try {
    return { ...EMPTY_USAGE_STATS, ...JSON.parse(localStorage.getItem(STATS_KEY) ?? "{}") };
  } catch {
    return { ...EMPTY_USAGE_STATS };
  }
}

export function recordUsage(action: UsageAction, enabled = true): UsageStats {
  if (!enabled) return loadUsageStats();
  const current = loadUsageStats();
  const next = { ...current, [action]: current[action] + 1, lastUsedAt: new Date().toISOString() };
  localStorage.setItem(STATS_KEY, JSON.stringify(next));
  return next;
}

export function clearUsageStats() {
  localStorage.removeItem(STATS_KEY);
}
