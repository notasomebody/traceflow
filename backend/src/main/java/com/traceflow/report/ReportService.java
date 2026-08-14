package com.traceflow.report;

import com.traceflow.security.SensitiveTextCipher;
import com.traceflow.work.WorkEvent;
import com.traceflow.work.WorkEventRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ReportService {
    private final WorkEventRepository events;
    private final JdbcClient jdbc;
    private final SensitiveTextCipher sensitiveText;

    public ReportService(WorkEventRepository events, JdbcClient jdbc, SensitiveTextCipher sensitiveText) {
        this.events = events;
        this.jdbc = jdbc;
        this.sensitiveText = sensitiveText;
    }

    @Transactional
    public ReportDraft generateDaily(LocalDate date, int targetMinutes) {
        List<WorkEvent> included = events.findByDate(date).stream().filter(WorkEvent::includedInReport).toList();
        String summary = buildSummary(included);
        String nextPlan = included.isEmpty()
                ? "请补充明日计划。"
                : "继续推进重点事项的验证与交付，及时同步风险和依赖，完成阶段性结果确认。";
        ReportDraft report = saveDraft(date, "DAILY", summary, nextPlan, targetMinutes, "DRAFT", null);
        saveSnapshot(report);
        return report;
    }

    @Transactional
    public ReportDraft confirm(LocalDate date, String summary, String nextPlan, int targetMinutes) {
        find(date, "DAILY").orElseGet(() -> generateDaily(date, targetMinutes));
        return confirm(date, "DAILY", summary, nextPlan, targetMinutes);
    }

    @Transactional
    public ReportDraft importDaily(LocalDate date, String summary, String nextPlan, int targetMinutes) {
        ReportDraft report = saveDraft(date, "DAILY", summary, nextPlan, targetMinutes, "IMPORTED", null);
        saveSnapshot(report);
        return report;
    }

    @Transactional
    public ReportDraft confirm(LocalDate date, String reportType, String summary, String nextPlan, int targetMinutes) {
        String normalizedType = normalizeType(reportType);
        if (find(date, normalizedType).isEmpty()) {
            throw new IllegalArgumentException("请先生成报告草稿再确认");
        }
        ReportDraft report = saveDraft(date, normalizedType, summary, nextPlan, targetMinutes, "CONFIRMED", OffsetDateTime.now());
        saveSnapshot(report);
        return report;
    }

    @Transactional
    public PeriodReport generateWeekly(LocalDate date, int fallbackDailyTargetMinutes) {
        LocalDate start = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        return generatePeriod("WEEKLY", start, start.plusDays(6), fallbackDailyTargetMinutes);
    }

    @Transactional
    public PeriodReport generateMonthly(LocalDate date, int fallbackDailyTargetMinutes) {
        LocalDate start = date.withDayOfMonth(1);
        return generatePeriod("MONTHLY", start, date.with(TemporalAdjusters.lastDayOfMonth()), fallbackDailyTargetMinutes);
    }

    public java.util.Optional<ReportDraft> find(LocalDate date) {
        return find(date, "DAILY");
    }

    public List<ReportDraft> history(String reportType) {
        return jdbc.sql("""
                SELECT id, report_date, report_type, summary, next_plan, target_minutes,
                       status, confirmed_at, updated_at
                FROM report_draft
                WHERE report_type = :reportType
                ORDER BY report_date DESC, updated_at DESC
                """).param("reportType", normalizeType(reportType)).query(this::mapReport).list();
    }

    public List<ReportSnapshot> snapshots(String reportType) {
        return jdbc.sql("""
                SELECT id, report_id, version, report_date, report_type, summary, next_plan,
                       target_minutes, status, created_at
                FROM report_snapshot
                WHERE report_type = :reportType
                ORDER BY report_date DESC, version DESC
                """).param("reportType", normalizeType(reportType)).query((rs, rowNum) -> new ReportSnapshot(
                rs.getString("id"), rs.getString("report_id"), rs.getInt("version"),
                LocalDate.parse(rs.getString("report_date")), rs.getString("report_type"),
                sensitiveText.decrypt(rs.getString("summary")), sensitiveText.decrypt(rs.getString("next_plan")),
                rs.getInt("target_minutes"), rs.getString("status"), OffsetDateTime.parse(rs.getString("created_at"))
        )).list();
    }

    private PeriodReport generatePeriod(String reportType, LocalDate start, LocalDate end, int fallbackDailyTargetMinutes) {
        List<ReportDraft> dailyReports = jdbc.sql("""
                SELECT id, report_date, report_type, summary, next_plan, target_minutes,
                       status, confirmed_at, updated_at
                FROM report_draft
                WHERE report_type = 'DAILY' AND report_date BETWEEN :start AND :end
                ORDER BY report_date
                """).param("start", start.toString()).param("end", end.toString()).query(this::mapReport).list();
        String summary = dailyReports.isEmpty()
                ? "当前周期暂无日报，请先生成或补充日报。"
                : dailyReports.stream().map(report -> report.reportDate() + "\n" + report.summary()).collect(Collectors.joining("\n\n"));
        String nextPlan = dailyReports.isEmpty()
                ? "请补充下一周期计划。"
                : "延续本周期已确认事项，优先完成未闭环任务并同步风险与依赖。";
        int targetMinutes = dailyReports.stream().mapToInt(ReportDraft::targetMinutes).sum();
        if (targetMinutes == 0) targetMinutes = fallbackDailyTargetMinutes;
        ReportDraft report = saveDraft(start, reportType, summary, nextPlan, targetMinutes, "DRAFT", null);
        saveSnapshot(report);
        return new PeriodReport(report, start, end, dailyReports.size());
    }

    private ReportDraft saveDraft(LocalDate date, String reportType, String summary, String nextPlan,
                                  int targetMinutes, String status, OffsetDateTime confirmedAt) {
        String normalizedType = normalizeType(reportType);
        String id = find(date, normalizedType).map(ReportDraft::id).orElseGet(() -> UUID.randomUUID().toString());
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.sql("""
                INSERT INTO report_draft(id, report_date, report_type, summary, next_plan, target_minutes,
                                         status, confirmed_at, updated_at)
                VALUES(:id, :date, :reportType, :summary, :nextPlan, :targetMinutes,
                       :status, :confirmedAt, :updatedAt)
                ON CONFLICT(report_date, report_type) DO UPDATE SET
                    summary = excluded.summary,
                    next_plan = excluded.next_plan,
                    target_minutes = excluded.target_minutes,
                    status = excluded.status,
                    confirmed_at = excluded.confirmed_at,
                    updated_at = excluded.updated_at
                """)
                .param("id", id).param("date", date.toString()).param("reportType", normalizedType)
                .param("summary", sensitiveText.encrypt(summary)).param("nextPlan", sensitiveText.encrypt(nextPlan))
                .param("targetMinutes", targetMinutes).param("status", status)
                .param("confirmedAt", confirmedAt == null ? null : confirmedAt.toString())
                .param("updatedAt", now.toString()).update();
        return find(date, normalizedType).orElseThrow();
    }

    private java.util.Optional<ReportDraft> find(LocalDate date, String reportType) {
        return jdbc.sql("""
                SELECT id, report_date, report_type, summary, next_plan, target_minutes,
                       status, confirmed_at, updated_at
                FROM report_draft WHERE report_date = :date AND report_type = :reportType
                """).param("date", date.toString()).param("reportType", normalizeType(reportType))
                .query(this::mapReport).optional();
    }

    private ReportDraft mapReport(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        return new ReportDraft(
                rs.getString("id"), LocalDate.parse(rs.getString("report_date")), rs.getString("report_type"),
                sensitiveText.decrypt(rs.getString("summary")), sensitiveText.decrypt(rs.getString("next_plan")),
                rs.getInt("target_minutes"), rs.getString("status"), parseTime(rs.getString("confirmed_at")),
                OffsetDateTime.parse(rs.getString("updated_at"))
        );
    }

    private void saveSnapshot(ReportDraft report) {
        Integer nextVersion = jdbc.sql("""
                SELECT COALESCE(MAX(version), 0) + 1 FROM report_snapshot WHERE report_id = :reportId
                """).param("reportId", report.id()).query(Integer.class).single();
        jdbc.sql("""
                INSERT INTO report_snapshot(id, report_id, version, report_date, report_type, summary,
                                            next_plan, target_minutes, status, created_at)
                VALUES(:id, :reportId, :version, :reportDate, :reportType, :summary,
                       :nextPlan, :targetMinutes, :status, :createdAt)
                """).param("id", UUID.randomUUID().toString()).param("reportId", report.id())
                .param("version", nextVersion).param("reportDate", report.reportDate().toString())
                .param("reportType", report.reportType()).param("summary", sensitiveText.encrypt(report.summary()))
                .param("nextPlan", sensitiveText.encrypt(report.nextPlan())).param("targetMinutes", report.targetMinutes())
                .param("status", report.status()).param("createdAt", OffsetDateTime.now().toString()).update();
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

    private String normalizeType(String reportType) {
        String normalized = reportType == null ? "DAILY" : reportType.toUpperCase(java.util.Locale.ROOT);
        if (!List.of("DAILY", "WEEKLY", "MONTHLY").contains(normalized)) {
            throw new IllegalArgumentException("不支持的报告类型: " + reportType);
        }
        return normalized;
    }

    private OffsetDateTime parseTime(String value) {
        return value == null ? null : OffsetDateTime.parse(value);
    }
}
