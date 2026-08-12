package com.traceflow.work;

import com.traceflow.security.SensitiveTextCipher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

@Repository
public class WorkEventRepository {
    private final JdbcClient jdbc;
    private final SensitiveTextCipher sensitiveText;

    public WorkEventRepository(JdbcClient jdbc, SensitiveTextCipher sensitiveText) {
        this.jdbc = jdbc;
        this.sensitiveText = sensitiveText;
    }

    public List<WorkEvent> findByDate(LocalDate date) {
        return jdbc.sql("""
                SELECT id, occurred_at, source_type, source_name, project_name, title, summary,
                       evidence_level, duration_minutes, included_in_report
                FROM work_event
                WHERE substr(occurred_at, 1, 10) = :date
                ORDER BY occurred_at DESC
                """)
                .param("date", date.toString())
                .query((rs, rowNum) -> new WorkEvent(
                        rs.getString("id"),
                        OffsetDateTime.parse(rs.getString("occurred_at")),
                        rs.getString("source_type"),
                        sensitiveText.decrypt(rs.getString("source_name")),
                        sensitiveText.decrypt(rs.getString("project_name")),
                        sensitiveText.decrypt(rs.getString("title")),
                        sensitiveText.decrypt(rs.getString("summary")),
                        rs.getString("evidence_level"),
                        rs.getInt("duration_minutes"),
                        rs.getInt("included_in_report") == 1
                )).list();
    }

    public WorkEvent create(CreateWorkEventRequest request) {
        String id = UUID.randomUUID().toString();
        OffsetDateTime occurredAt = request.occurredAt() == null
                ? OffsetDateTime.now(ZoneId.systemDefault())
                : request.occurredAt();
        String evidenceLevel = request.evidenceLevel() == null || request.evidenceLevel().isBlank()
                ? "MANUAL" : request.evidenceLevel();
        boolean included = request.includedInReport() == null || request.includedInReport();
        jdbc.sql("""
                INSERT INTO work_event(
                    id, occurred_at, source_type, source_name, project_name, title, summary,
                    evidence_level, duration_minutes, included_in_report, created_at
                ) VALUES (
                    :id, :occurredAt, :sourceType, :sourceName, :projectName, :title, :summary,
                    :evidenceLevel, :durationMinutes, :included, :createdAt
                )
                """)
                .param("id", id)
                .param("occurredAt", occurredAt.toString())
                .param("sourceType", request.sourceType())
                .param("sourceName", sensitiveText.encrypt(request.sourceName()))
                .param("projectName", sensitiveText.encrypt(request.projectName()))
                .param("title", sensitiveText.encrypt(request.title()))
                .param("summary", sensitiveText.encrypt(request.summary() == null ? "" : request.summary()))
                .param("evidenceLevel", evidenceLevel)
                .param("durationMinutes", request.durationMinutes())
                .param("included", included ? 1 : 0)
                .param("createdAt", OffsetDateTime.now().toString())
                .update();
        return new WorkEvent(id, occurredAt, request.sourceType(), request.sourceName(), request.projectName(),
                request.title(), request.summary() == null ? "" : request.summary(), evidenceLevel,
                request.durationMinutes(), included);
    }

    public long count() {
        return jdbc.sql("SELECT COUNT(*) FROM work_event").query(Long.class).single();
    }
}
