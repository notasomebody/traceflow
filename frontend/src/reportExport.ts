export type ExportableReport = {
  date: string;
  summary: string;
  nextPlan: string;
  targetMinutes: number;
};

export function buildReportText(report: ExportableReport) {
  return `今日工作总结\n${report.summary.trim()}\n\n明日工作计划\n${report.nextPlan.trim()}\n\n工时：${formatHours(report.targetMinutes)} 小时`;
}

export function buildAiPrompt(report: ExportableReport) {
  return `请在不虚构工作内容的前提下，润色下面的日报。保持项目结构，语言简洁、专业、结果导向；不要增加原文没有的成果、数字或进度。仅输出润色后的“今日工作总结”和“明日工作计划”。\n\n日期：${report.date}\n目标工时：${formatHours(report.targetMinutes)} 小时\n\n今日工作总结：\n${report.summary.trim()}\n\n明日工作计划：\n${report.nextPlan.trim()}`;
}

function formatHours(minutes: number) {
  return (minutes / 60).toFixed(minutes % 60 ? 1 : 0);
}
