package com.traceflow.report;

import com.traceflow.work.WorkEvent;
import com.traceflow.work.WorkEventRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ReportService {
    private final WorkEventRepository events;
    private final JdbcClient jdbc;

    public ReportService(WorkEventRepository events, JdbcClient jdbc) {
        this.events = events;
        this.jdbc = jdbc;
    }

    @Transactional
    public ReportDraft generateDaily(LocalDate date, int targetMinutes) {
        List<WorkEvent> included = events.findByDate(date).stream().filter(WorkEvent::includedInReport).toList();
        String summary = buildSummary(included);
        String nextPlan = included.isEmpty()
                ? "请补充明日计划。"
                : "继续推进重点事项的验证与交付，及时同步风险和依赖，完成阶段性结果确认。";
        String id = find(date).map(ReportDraft::id).orElseGet(() -> UUID.randomUUID().toString());
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.sql("""
                INSERT INTO report_draft(id, report_date, report_type, summary, next_plan, target_minutes, status, updated_at)
                VALUES(:id, :date, 'DAILY', :summary, :nextPlan, :targetMinutes, 'DRAFT', :updatedAt)
                ON CONFLICT(report_date, report_type) DO UPDATE SET
                    summary = excluded.summary,
                    next_plan = excluded.next_plan,
                    target_minutes = excluded.target_minutes,
                    status = 'DRAFT',
                    confirmed_at = NULL,
                    updated_at = excluded.updated_at
                """)
                .param("id", id).param("date", date.toString()).param("summary", summary)
                .param("nextPlan", nextPlan).param("targetMinutes", targetMinutes)
                .param("updatedAt", now.toString()).update();
        return find(date).orElseThrow();
    }

    @Transactional
    public ReportDraft confirm(LocalDate date, String summary, String nextPlan, int targetMinutes) {
        ReportDraft existing = find(date).orElseGet(() -> generateDaily(date, targetMinutes));
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.sql("""
                UPDATE report_draft SET summary = :summary, next_plan = :nextPlan,
                    target_minutes = :targetMinutes, status = 'CONFIRMED', confirmed_at = :now, updated_at = :now
                WHERE id = :id
                """)
                .param("summary", summary).param("nextPlan", nextPlan).param("targetMinutes", targetMinutes)
                .param("now", now.toString()).param("id", existing.id()).update();
        return find(date).orElseThrow();
    }

    public java.util.Optional<ReportDraft> find(LocalDate date) {
        return jdbc.sql("""
                SELECT id, report_date, report_type, summary, next_plan, target_minutes,
                       status, confirmed_at, updated_at
                FROM report_draft WHERE report_date = :date AND report_type = 'DAILY'
                """).param("date", date.toString()).query((rs, rowNum) -> new ReportDraft(
                rs.getString("id"), LocalDate.parse(rs.getString("report_date")), rs.getString("report_type"),
                rs.getString("summary"), rs.getString("next_plan"), rs.getInt("target_minutes"),
                rs.getString("status"), parseTime(rs.getString("confirmed_at")), OffsetDateTime.parse(rs.getString("updated_at"))
        )).optional();
    }

    private String buildSummary(List<WorkEvent> workEvents) {
        if (workEvents.isEmpty()) return "尚未采集到有效工作记录，请同步数据源或手动补充。";
        Map<String, List<WorkEvent>> grouped = workEvents.stream().collect(Collectors.groupingBy(
                WorkEvent::projectName, LinkedHashMap::new, Collectors.toList()));
        return grouped.entrySet().stream().map(entry -> {
            String items = entry.getValue().stream().map(WorkEvent::title).distinct().collect(Collectors.joining("；"));
            return "【" + entry.getKey() + "】" + items + "。";
        }).collect(Collectors.joining("\n"));
    }

    private OffsetDateTime parseTime(String value) {
        return value == null ? null : OffsetDateTime.parse(value);
    }
}
