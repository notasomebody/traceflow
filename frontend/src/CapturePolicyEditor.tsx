import { useEffect, useMemo, useState } from "react";
import { getCapturePolicy, saveCapturePolicy, weekdayPolicy, type CapturePolicy } from "./desktopMonitor";

const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default function CapturePolicyEditor() {
  const [policy, setPolicy] = useState<CapturePolicy | null>();
  const [points, setPoints] = useState([540, 720, 810, 1080]);
  const [excluded, setExcluded] = useState("");
  const [excludedDates, setExcludedDates] = useState("");
  const [additionalWorkDates, setAdditionalWorkDates] = useState("");
  const [idleMinutes, setIdleMinutes] = useState(5);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getCapturePolicy().then(value => {
      setPolicy(value);
      if (!value) return;
      const monday = value.work_intervals.filter(interval => interval.weekday === 1);
      if (monday.length >= 2) setPoints([monday[0].start_minute, monday[0].end_minute, monday[1].start_minute, monday[1].end_minute]);
      setExcluded(value.excluded_applications.join("\n"));
      setExcludedDates(value.excluded_dates.join(", "));
      setAdditionalWorkDates((value.additional_work_dates ?? []).join(", "));
      setIdleMinutes(value.idle_threshold_seconds / 60);
    }).catch(() => setPolicy(null));
  }, []);

  const valid = points[0] < points[1] && points[1] <= points[2] && points[2] < points[3];
  const gradient = useMemo(() => {
    const percent = (value: number) => `${value / 1440 * 100}%`;
    return `linear-gradient(to right,#252b38 0 ${percent(points[0])},#625cf3 ${percent(points[0])} ${percent(points[1])},#252b38 ${percent(points[1])} ${percent(points[2])},#625cf3 ${percent(points[2])} ${percent(points[3])},#252b38 ${percent(points[3])} 100%)`;
  }, [points]);

  const updatePoint = (index: number, value: number) => setPoints(current => current.map((point, pointIndex) => pointIndex === index ? value : point));
  const save = async () => {
    if (!valid) { setMessage("时段不能重叠，开始时间必须早于结束时间"); return; }
    try {
      const next = weekdayPolicy(
        points[0], points[1], points[2], points[3],
        excluded.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean),
        excludedDates.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean),
        additionalWorkDates.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean),
        idleMinutes * 60,
      );
      setPolicy(await saveCapturePolicy(next));
      setMessage("采集时段和排除应用已保存到本机");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  };

  if (policy === undefined) return <div className="policy-editor"><span>正在读取桌面采集策略…</span></div>;
  if (policy === null) return <div className="policy-editor unavailable"><strong>桌面采集策略</strong><span>请在 TraceFlow 桌面程序中调整，浏览器预览不会启动监控。</span></div>;

  return <section className="policy-editor">
    <div className="policy-heading"><div><strong>工作时段</strong><span>周一至周五，灰色时段不采集</span></div><b>{minutesToTime(points[0])}–{minutesToTime(points[1])} · {minutesToTime(points[2])}–{minutesToTime(points[3])}</b></div>
    <div className="schedule-slider" style={{ background: gradient }}>
      {points.map((point, index) => <input key={index} aria-label={`时段节点 ${index + 1}`} type="range" min="0" max="1440" step="15" value={point} onChange={event => updatePoint(index, Number(event.target.value))}/>)}
    </div>
    <div className="schedule-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    <label className="idle-slider">空闲 {idleMinutes} 分钟后暂停<input type="range" min="1" max="30" step="1" value={idleMinutes} onChange={event => setIdleMinutes(Number(event.target.value))}/></label>
    <label>休息日期（英文逗号分隔）<input value={excludedDates} onChange={event => setExcludedDates(event.target.value)} placeholder="2026-10-01, 2026-10-02"/></label>
    <label>调休补班日期（英文逗号分隔）<input value={additionalWorkDates} onChange={event => setAdditionalWorkDates(event.target.value)} placeholder="2026-10-10"/></label>
    <label>排除应用（每行一个进程名）<textarea value={excluded} onChange={event => setExcluded(event.target.value)} placeholder="PasswordManager.exe"/></label>
    <button className="secondary-action" onClick={() => void save()} disabled={!valid}>保存采集策略</button>
    {message && <p className="settings-message">{message}</p>}
  </section>;
}
