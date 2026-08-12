import { Archive, Check, Clock3, FolderKanban, Inbox, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Project = { id: string; name: string; code: string; status: "ACTIVE" | "ARCHIVED"; matchKeywords: string[] };
type Observation = { id: string; capturedAt: string; applicationName: string; windowTitle: string; durationSeconds: number; projectId?: string; projectName: string; classification: "AUTO" | "PENDING" | "MANUAL"; confidence: number };

export default function ProjectInbox({ api, date }: { api: string; date: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [keywords, setKeywords] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [projectResponse, activityResponse] = await Promise.all([fetch(`${api}/projects`), fetch(`${api}/activity?date=${date}`)]);
      if (!projectResponse.ok || !activityResponse.ok) throw new Error();
      setProjects(await projectResponse.json()); setObservations(await activityResponse.json());
    } catch { setMessage("无法读取项目库或活动记录"); }
  }, [api, date]);
  useEffect(() => { void load(); }, [load]);

  const createProject = async () => {
    const matchKeywords = keywords.split(/,|，|\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!name.trim() || !matchKeywords.length) { setMessage("项目名称和至少一个识别关键词必填"); return; }
    const response = await fetch(`${api}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, code, matchKeywords }) });
    if (!response.ok) { setMessage("项目创建失败，请检查名称是否重复"); return; }
    setName(""); setCode(""); setKeywords(""); setMessage("项目已创建，新活动将按关键词自动归类"); await load();
  };
  const setStatus = async (project: Project) => {
    await fetch(`${api}/projects/${project.id}/status?status=${project.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"}`, { method: "POST" }); await load();
  };
  const classify = async (observation: Observation, projectId: string) => {
    const rememberKeyword = window.prompt("可选：记住一个关键词，后续自动归类", observation.applicationName) ?? "";
    const response = await fetch(`${api}/activity/${observation.id}/classify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, rememberKeyword }) });
    if (!response.ok) { setMessage("归类失败"); return; }
    setMessage("已人工归类，可选关键词已沉淀为本机规则"); await load();
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
  const pending = observations.filter(item => item.classification === "PENDING");

  return <section className="panel project-inbox">
    <div className="panel-heading"><div><p className="eyebrow">PROJECT CLASSIFICATION</p><h2>项目库与待归类</h2></div><span className="pending-count"><Inbox/>{pending.length} 条待确认</span></div>
    <div className="project-layout">
      <div className="project-library"><h3><FolderKanban/>我的项目</h3><div className="project-create"><input value={name} onChange={event => setName(event.target.value)} placeholder="项目名称"/><input value={code} onChange={event => setCode(event.target.value)} placeholder="简称 / 编码"/><textarea value={keywords} onChange={event => setKeywords(event.target.value)} placeholder="关键词，每行一个或逗号分隔"/><button onClick={() => void createProject()}><Plus/>创建项目</button></div>{projects.map(project => <article key={project.id} className={project.status === "ARCHIVED" ? "archived" : ""}><div><strong>{project.name}</strong><span>{project.code || "无编码"} · {project.matchKeywords.join(" / ")}</span></div><button onClick={() => void setStatus(project)}><Archive/>{project.status === "ACTIVE" ? "归档" : "恢复"}</button></article>)}</div>
      <div className="pending-list"><h3><Inbox/>低置信度集中确认</h3>{pending.length ? pending.map(item => <article key={item.id}><div><strong>{item.applicationName}</strong><p>{item.windowTitle}</p><span>{Math.max(1, Math.round(item.durationSeconds / 60))} 分钟 · 置信度 {Math.round(item.confidence * 100)}%</span></div><select defaultValue="" onChange={event => { if (event.target.value) void classify(item, event.target.value); }}><option value="" disabled>选择项目…</option>{projects.filter(project => project.status === "ACTIVE").map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></article>) : <div className="empty-pending"><Check/>今日没有待归类记录</div>}</div>
    </div>
    <div className="activity-review"><h3><Clock3/>今日活动（相同窗口 10 分钟内自动合并）</h3>{observations.length ? observations.map(item => <article key={item.id}><div><strong>{item.projectName}</strong><p>{item.applicationName} · {item.windowTitle}</p><span>{Math.max(1, Math.round(item.durationSeconds / 60))} 分钟 · {item.classification === "PENDING" ? "待归类" : item.classification === "AUTO" ? "自动归类" : "人工归类"}</span></div><div><button title="修正时长" onClick={() => void editDuration(item)}><Pencil/></button><button title="删除记录" onClick={() => void deleteActivity(item)}><Trash2/></button></div></article>) : <div className="empty-pending"><Check/>今日暂无活动记录</div>}</div>
    {message && <p className="settings-message">{message}</p>}
  </section>;
}
