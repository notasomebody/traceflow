import { Archive, Check, Clock3, FolderKanban, Inbox, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchLocal, waitForLocalApi } from "./localApi";

type Project = { id: string; name: string; code: string; status: "ACTIVE" | "ARCHIVED"; matchKeywords: string[] };
type Observation = { id: string; capturedAt: string; applicationName: string; windowTitle: string; durationSeconds: number; projectId?: string; projectName: string; classification: "AUTO" | "PENDING" | "MANUAL"; confidence: number };
type Candidate = { suggestedName: string; code: string; occurrenceCount: number; confidence: number; examples: string[] };

export default function ProjectInbox({ api, date, mode = "all" }: { api: string; date: string; mode?: "all" | "records" | "projects" }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [keywords, setKeywords] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(date);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const [projectResponse, activityResponse, candidateResponse] = await Promise.all([fetchLocal(`${api}/projects`), fetchLocal(`${api}/activity?date=${selectedDate}`), fetchLocal(`${api}/projects/candidates?date=${selectedDate}`)]);
      if (!projectResponse.ok || !activityResponse.ok) throw new Error();
      setProjects(await projectResponse.json()); setObservations(await activityResponse.json());
      setCandidates(candidateResponse.ok ? await candidateResponse.json() : []);
    } catch { setMessage("无法读取项目库或活动记录"); }
  }, [api, selectedDate]);
  useEffect(() => { void load(); }, [load]);

  const createProject = async (candidate?: Candidate) => {
    const projectName = candidate?.suggestedName ?? name;
    const projectCode = candidate?.code ?? code;
    const matchKeywords = candidate ? [candidate.code] : keywords.split(/,|，|\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!projectName.trim()) { setMessage("请填写项目名称"); return; }
    let response: Response;
    setCreating(true);
    setMessage("正在等待本地服务并创建项目…");
    try {
      await waitForLocalApi(api);
      response = await fetch(`${api}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName, code: projectCode, matchKeywords }) });
    }
    catch { setMessage("本地服务未能启动，请重启迹汇后再试"); setCreating(false); return; }
    if (!response.ok) { setMessage(response.status === 409 ? "项目名称已存在" : "项目创建失败，请稍后重试"); setCreating(false); return; }
    setName(""); setCode(""); setKeywords(""); setMessage("项目已创建，新活动将按关键词自动归类"); await load();
    setCreating(false);
  };
  const setStatus = async (project: Project) => {
    await fetch(`${api}/projects/${project.id}/status?status=${project.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"}`, { method: "POST" }); await load();
  };
  const classify = async (observation: Observation, projectId: string) => {
    const issueCode = observation.windowTitle.match(/\b([A-Z][A-Z0-9]{1,11})-\d+\b/i)?.[1];
    const rememberKeyword = issueCode || observation.windowTitle;
    const response = await fetch(`${api}/activity/${observation.id}/classify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, rememberKeyword }) });
    if (!response.ok) { setMessage("归类失败"); return; }
    setMessage("已归类，并记住此类窗口的项目规则"); await load();
  };
  const editDuration = async (observation: Observation) => {
    const entered = window.prompt("修正活动时长（分钟）", String(Math.max(1, Math.round(observation.durationSeconds / 60))));
    if (entered === null) return;
    const minutes = Number(entered);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) { setMessage("时长需为 1～1440 分钟"); return; }
    const response = await fetch(`${api}/activity/${observation.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationSeconds: Math.round(minutes * 60) }) });
    if (!response.ok) { setMessage("活动时长修正失败"); return; }
    setMessage("活动时长已修正"); await load();
  };
  const deleteActivity = async (observation: Observation) => {
    if (!window.confirm(`删除“${observation.applicationName}”这条活动记录？`)) return;
    const response = await fetch(`${api}/activity/${observation.id}`, { method: "DELETE" });
    if (!response.ok) { setMessage("活动记录删除失败"); return; }
    setMessage("活动记录已删除"); await load();
  };
  const visible = observations.filter(item => {
    const text = `${item.applicationName}\n${item.windowTitle}\n${item.projectName}`.toLowerCase();
    return (!query.trim() || text.includes(query.trim().toLowerCase()))
      && (!projectFilter || item.projectName === projectFilter)
      && (!sourceFilter || item.applicationName === sourceFilter);
  });
  const pending = visible.filter(item => item.classification === "PENDING");

  return <section className={`panel project-inbox mode-${mode}`}>
    <div className="panel-heading"><div><p className="eyebrow">{mode === "records" ? "WORK EVIDENCE" : "PROJECT CLASSIFICATION"}</p><h2>{mode === "records" ? "自动采集时间线" : "项目库"}</h2></div>{mode === "records" && <span className="pending-count"><Check/>{observations.length} 条记录已自动参与总结</span>}</div>
    {mode === "records" && <div className="record-filters"><input type="date" aria-label="记录日期" value={selectedDate} onChange={event => setSelectedDate(event.target.value)}/><input aria-label="搜索工作记录" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索窗口、应用或项目…"/><select aria-label="筛选项目" value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">全部项目</option>{Array.from(new Set(observations.map(item => item.projectName))).map(value => <option key={value}>{value}</option>)}</select><select aria-label="筛选来源" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="">全部来源</option>{Array.from(new Set(observations.map(item => item.applicationName))).map(value => <option key={value}>{value}</option>)}</select></div>}
    <div className="project-layout">
      {mode !== "records" && <div className="project-library"><h3><FolderKanban/>我的项目</h3><div className="project-create"><input value={name} onChange={event => setName(event.target.value)} placeholder="项目名称（必填）"/><input value={code} onChange={event => setCode(event.target.value)} placeholder="简称 / 编码（可选）"/><details><summary>补充识别规则（可选）</summary><textarea value={keywords} onChange={event => setKeywords(event.target.value)} placeholder="识别关键词，可稍后由系统学习"/></details><button disabled={creating} onClick={() => void createProject()}><Plus/>{creating ? "创建中…" : "创建项目"}</button>{message && <p className="project-form-message">{message}</p>}</div>{projects.map(project => <article key={project.id} className={project.status === "ARCHIVED" ? "archived" : ""}><div><strong>{project.name}</strong><span>{project.code || "未设置编码"} · {project.matchKeywords.length ? `${project.matchKeywords.length} 条自动规则` : "系统将从确认记录中学习"}</span></div><button onClick={() => void setStatus(project)}><Archive/>{project.status === "ACTIVE" ? "归档" : "恢复"}</button></article>)}</div>}
    </div>
    {mode === "projects" && candidates.length > 0 && <div className="candidate-projects"><h3><Inbox/>发现的项目</h3><p>迹汇从工作窗口中发现了这些项目线索，确认后才会正式创建。</p>{candidates.map(candidate => <article key={candidate.code}><div><strong>{candidate.suggestedName}</strong><span>{candidate.occurrenceCount} 条相关记录 · 建议可信度 {Math.round(candidate.confidence * 100)}%</span><small>{candidate.examples[0]}</small></div><button onClick={() => void createProject(candidate)} disabled={creating}><Plus/>确认创建</button></article>)}</div>}
    {mode !== "projects" && <div className="activity-review"><h3><Clock3/>时间线</h3>{visible.length ? visible.map(item => <article key={item.id}><div><strong>{item.projectName}</strong><p>{item.applicationName} · {item.windowTitle}</p><span>{Math.max(1, Math.round(item.durationSeconds / 60))} 分钟 · {item.confidence >= .8 ? `高置信度 ${Math.round(item.confidence * 100)}%` : item.classification === "MANUAL" ? "已人工确认" : item.confidence >= .5 ? `建议 ${Math.round(item.confidence * 100)}%` : "需要确认"}</span></div><div><button title="修正时长" onClick={() => void editDuration(item)}><Pencil/></button><button title="删除记录" onClick={() => void deleteActivity(item)}><Trash2/></button></div></article>) : <div className="empty-pending"><Check/>没有符合条件的活动记录</div>}</div>}
    {mode === "records" && pending.length > 0 && <details className="optional-corrections"><summary><Inbox/>可选：修正 {pending.length} 条项目归属</summary><p>这些记录已经按工作主题进入日报，不处理也不影响生成。修正一次后，迹汇会记住同类窗口。</p><div className="pending-list">{pending.map(item => <article key={item.id}><div><strong>{item.applicationName}</strong><p>{item.windowTitle}</p></div><select aria-label={`归类 ${item.windowTitle}`} defaultValue="" onChange={event => { if (event.target.value) void classify(item, event.target.value); }}><option value="" disabled>修正到项目…</option>{projects.filter(project => project.status === "ACTIVE").map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></article>)}</div></details>}
  </section>;
}
