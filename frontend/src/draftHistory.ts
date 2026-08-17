export type LocalDraftVersion = {
  summary: string;
  nextPlan: string;
  savedAt: string;
};

const key = (date: string) => `traceflow.local-draft.${date}`;

export function listDraftVersions(date: string): LocalDraftVersion[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(date)) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadLocalDraft(date: string) {
  return listDraftVersions(date)[0];
}

export function saveLocalDraft(date: string, summary: string, nextPlan: string) {
  const versions = listDraftVersions(date);
  if (versions[0]?.summary === summary && versions[0]?.nextPlan === nextPlan) return versions[0];
  const version = { summary, nextPlan, savedAt: new Date().toISOString() };
  localStorage.setItem(key(date), JSON.stringify([version, ...versions].slice(0, 20)));
  return version;
}
