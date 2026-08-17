package com.traceflow.activity;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import com.traceflow.security.SensitiveTextCipher;

import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class ActivityModule {
    private static final Pattern ISSUE_KEY = Pattern.compile("(?i)(?<![A-Z0-9])([A-Z][A-Z0-9]{1,11})-\\d+");
    private final JdbcClient jdbc;
    private final SensitiveTextCipher sensitiveText;

    public ActivityModule(JdbcClient jdbc, SensitiveTextCipher sensitiveText) {
        this.jdbc = jdbc;
        this.sensitiveText = sensitiveText;
    }

    @Transactional
    public ProjectDefinition createProject(CreateProjectRequest request) {
        String id = UUID.randomUUID().toString();
        OffsetDateTime now = OffsetDateTime.now();
        try {
            jdbc.sql("""
                    INSERT INTO project_definition(id, name, code, status, created_at, updated_at)
                    VALUES(:id, :name, :code, 'ACTIVE', :createdAt, :updatedAt)
                    """)
                    .param("id", id)
                    .param("name", request.name().strip())
                    .param("code", request.code() == null ? "" : request.code().strip())
                    .param("createdAt", now.toString())
                    .param("updatedAt", now.toString())
                    .update();
            request.matchKeywords().stream().map(String::strip).filter(keyword -> !keyword.isEmpty()).distinct()
                    .forEach(keyword -> jdbc.sql("""
                            INSERT INTO project_match_keyword(project_id, keyword) VALUES(:projectId, :keyword)
                            """).param("projectId", id).param("keyword", keyword).update());
        } catch (org.springframework.dao.DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目名称已存在");
        }
        return findProject(id);
    }

    @Transactional
    public ActivityObservation ingest(IngestActivityRequest request) {
        Match match = classify(request.applicationName() + "\n" + request.windowTitle());
        ActivityObservation mergeTarget = latestMergeTarget(request, match);
        if (mergeTarget != null) {
            jdbc.sql("""
                    UPDATE activity_observation
                    SET captured_at = :capturedAt, duration_seconds = duration_seconds + :durationSeconds
                    WHERE id = :id
                    """).param("capturedAt", request.capturedAt().toString())
                    .param("durationSeconds", request.durationSeconds()).param("id", mergeTarget.id()).update();
            return observation(mergeTarget.id());
        }
        String id = UUID.randomUUID().toString();
        jdbc.sql("""
                INSERT INTO activity_observation(
                    id, captured_at, application_name, window_title, duration_seconds,
                    project_id, project_name, classification, confidence, created_at
                ) VALUES(
                    :id, :capturedAt, :applicationName, :windowTitle, :durationSeconds,
                    :projectId, :projectName, :classification, :confidence, :createdAt
                )
                """)
                .param("id", id)
                .param("capturedAt", request.capturedAt().toString())
                .param("applicationName", request.applicationName())
                .param("windowTitle", sensitiveText.encrypt(request.windowTitle()))
                .param("durationSeconds", request.durationSeconds())
                .param("projectId", match.projectId())
                .param("projectName", match.projectName())
                .param("classification", match.classification())
                .param("confidence", match.confidence())
                .param("createdAt", OffsetDateTime.now().toString())
                .update();
        autoCreateRepeatedProject(request.windowTitle());
        return observation(id);
    }

    public List<ProjectDefinition> projects() {
        return jdbc.sql("SELECT id FROM project_definition ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, name")
                .query(String.class).list().stream().map(this::findProject).toList();
    }

    public List<ProjectCandidate> projectCandidates(LocalDate date) {
        Map<String, List<String>> examplesByCode = new LinkedHashMap<>();
        observations(date).stream()
                .filter(item -> "PENDING".equals(item.classification()))
                .forEach(item -> {
                    var matcher = ISSUE_KEY.matcher(item.windowTitle());
                    while (matcher.find()) {
                        String code = matcher.group(1).toUpperCase(Locale.ROOT);
                        examplesByCode.computeIfAbsent(code, ignored -> new java.util.ArrayList<>()).add(item.windowTitle());
                    }
                });
        var existingCodes = projects().stream().map(ProjectDefinition::code)
                .map(value -> value.toUpperCase(Locale.ROOT)).collect(java.util.stream.Collectors.toSet());
        return examplesByCode.entrySet().stream()
                .filter(entry -> !existingCodes.contains(entry.getKey()))
                .map(entry -> new ProjectCandidate(entry.getKey(), entry.getKey(), entry.getValue().size(),
                        entry.getValue().size() >= 3 ? 0.85 : 0.70,
                        entry.getValue().stream().distinct().limit(3).toList()))
                .sorted(java.util.Comparator.comparingInt(ProjectCandidate::occurrenceCount).reversed())
                .toList();
    }

    @Transactional
    public ProjectDefinition setProjectStatus(String id, String status) {
        String normalized = status == null ? "" : status.toUpperCase(Locale.ROOT);
        if (!List.of("ACTIVE", "ARCHIVED").contains(normalized)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "项目状态只能是 ACTIVE 或 ARCHIVED");
        }
        int updated = jdbc.sql("UPDATE project_definition SET status = :status, updated_at = :updatedAt WHERE id = :id")
                .param("status", normalized).param("updatedAt", OffsetDateTime.now().toString()).param("id", id).update();
        if (updated == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目不存在");
        return findProject(id);
    }

    @Transactional
    public void deleteProject(String id) {
        int references = jdbc.sql("SELECT COUNT(*) FROM activity_observation WHERE project_id = :id")
                .param("id", id).query(Integer.class).single();
        if (references > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目已有活动记录，请改为归档");
        }
        int deleted = jdbc.sql("DELETE FROM project_definition WHERE id = :id").param("id", id).update();
        if (deleted == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目不存在");
    }

    public List<ActivityObservation> observations(LocalDate date) {
        return jdbc.sql("""
                SELECT id, captured_at, application_name, window_title, duration_seconds,
                       project_id, project_name, classification, confidence
                FROM activity_observation
                WHERE substr(captured_at, 1, 10) = :date
                ORDER BY captured_at
                """).param("date", date.toString()).query((rs, rowNum) -> new ActivityObservation(
                rs.getString("id"), OffsetDateTime.parse(rs.getString("captured_at")),
                rs.getString("application_name"), sensitiveText.decrypt(rs.getString("window_title")), rs.getInt("duration_seconds"),
                rs.getString("project_id"), rs.getString("project_name"), rs.getString("classification"),
                rs.getDouble("confidence")
        )).list();
    }

    @Transactional
    public int clearObservations() {
        return jdbc.sql("DELETE FROM activity_observation").update();
    }

    @Transactional
    public ActivityObservation updateObservation(String id, UpdateActivityRequest request) {
        int updated = jdbc.sql("UPDATE activity_observation SET duration_seconds = :duration WHERE id = :id")
                .param("duration", request.durationSeconds()).param("id", id).update();
        if (updated == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "活动记录不存在");
        return observation(id);
    }

    @Transactional
    public void deleteObservation(String id) {
        int deleted = jdbc.sql("DELETE FROM activity_observation WHERE id = :id").param("id", id).update();
        if (deleted == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "活动记录不存在");
    }

    @Transactional
    public int clearAllPrivateData() {
        int deleted = 0;
        deleted += jdbc.sql("DELETE FROM report_snapshot").update();
        deleted += jdbc.sql("DELETE FROM report_draft").update();
        deleted += jdbc.sql("DELETE FROM work_event").update();
        deleted += jdbc.sql("DELETE FROM ocr_observation").update();
        deleted += jdbc.sql("DELETE FROM activity_observation").update();
        deleted += jdbc.sql("DELETE FROM project_match_keyword").update();
        deleted += jdbc.sql("DELETE FROM project_definition").update();
        deleted += jdbc.sql("DELETE FROM audit_log").update();
        return deleted;
    }

    public void compactDatabase() {
        jdbc.sql("VACUUM").update();
    }

    @Transactional
    public OcrObservation ingestOcr(IngestOcrRequest request) {
        String id = UUID.randomUUID().toString();
        jdbc.sql("""
                INSERT INTO ocr_observation(id, captured_at, application_name, recognized_text, created_at)
                VALUES(:id, :capturedAt, :applicationName, :recognizedText, :createdAt)
                """).param("id", id).param("capturedAt", request.capturedAt().toString())
                .param("applicationName", sensitiveText.encrypt(request.applicationName()))
                .param("recognizedText", sensitiveText.encrypt(request.recognizedText()))
                .param("createdAt", OffsetDateTime.now().toString()).update();
        return new OcrObservation(id, request.capturedAt(), request.applicationName(), request.recognizedText());
    }

    public List<OcrObservation> ocrObservations(LocalDate date) {
        return jdbc.sql("""
                SELECT id, captured_at, application_name, recognized_text
                FROM ocr_observation
                WHERE substr(captured_at, 1, 10) = :date
                ORDER BY captured_at
                """).param("date", date.toString()).query((rs, rowNum) -> new OcrObservation(
                rs.getString("id"), OffsetDateTime.parse(rs.getString("captured_at")),
                sensitiveText.decrypt(rs.getString("application_name")),
                sensitiveText.decrypt(rs.getString("recognized_text"))
        )).list();
    }

    @Transactional
    public ActivityObservation classifyObservation(String observationId, ClassifyActivityRequest request) {
        ProjectDefinition project = findProject(request.projectId());
        int updated = jdbc.sql("""
                UPDATE activity_observation
                SET project_id = :projectId, project_name = :projectName,
                    classification = 'MANUAL', confidence = 1.0
                WHERE id = :observationId
                """).param("projectId", project.id()).param("projectName", project.name())
                .param("observationId", observationId).update();
        if (updated == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "待归类记录不存在");
        if (request.rememberKeyword() != null && !request.rememberKeyword().isBlank()) {
            jdbc.sql("INSERT OR IGNORE INTO project_match_keyword(project_id, keyword) VALUES(:projectId, :keyword)")
                    .param("projectId", project.id()).param("keyword", request.rememberKeyword().strip()).update();
        }
        return observation(observationId);
    }

    private ActivityObservation observation(String id) {
        return jdbc.sql("""
                SELECT id, captured_at, application_name, window_title, duration_seconds,
                       project_id, project_name, classification, confidence
                FROM activity_observation WHERE id = :id
                """).param("id", id).query((rs, rowNum) -> new ActivityObservation(
                rs.getString("id"), OffsetDateTime.parse(rs.getString("captured_at")),
                rs.getString("application_name"), sensitiveText.decrypt(rs.getString("window_title")),
                rs.getInt("duration_seconds"), rs.getString("project_id"), rs.getString("project_name"),
                rs.getString("classification"), rs.getDouble("confidence")
        )).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "待归类记录不存在"));
    }

    private ActivityObservation latestMergeTarget(IngestActivityRequest request, Match match) {
        return jdbc.sql("""
                SELECT id, captured_at, application_name, window_title, duration_seconds,
                       project_id, project_name, classification, confidence
                FROM activity_observation
                WHERE application_name = :applicationName
                ORDER BY captured_at DESC LIMIT 10
                """).param("applicationName", request.applicationName()).query((rs, rowNum) -> new ActivityObservation(
                rs.getString("id"), OffsetDateTime.parse(rs.getString("captured_at")),
                rs.getString("application_name"), sensitiveText.decrypt(rs.getString("window_title")),
                rs.getInt("duration_seconds"), rs.getString("project_id"), rs.getString("project_name"),
                rs.getString("classification"), rs.getDouble("confidence")
        )).list().stream().filter(existing -> existing.windowTitle().equals(request.windowTitle()))
                .filter(existing -> java.time.Duration.between(existing.capturedAt(), request.capturedAt()).abs().toMinutes() <= 10)
                .filter(existing -> java.util.Objects.equals(existing.projectId(), match.projectId()))
                .findFirst().orElse(null);
    }

    private ProjectDefinition findProject(String id) {
        ProjectDefinition base = jdbc.sql("""
                SELECT id, name, code, status FROM project_definition WHERE id = :id
                """).param("id", id).query((rs, rowNum) -> new ProjectDefinition(
                rs.getString("id"), rs.getString("name"), rs.getString("code"), rs.getString("status"), List.of()
        )).optional().orElseThrow();
        List<String> keywords = jdbc.sql("""
                SELECT keyword FROM project_match_keyword WHERE project_id = :projectId ORDER BY keyword
                """).param("projectId", id).query(String.class).list();
        return new ProjectDefinition(base.id(), base.name(), base.code(), base.status(), keywords);
    }

    private Match classify(String searchableText) {
        String normalized = canonical(searchableText);
        List<Match> matches = projects().stream()
                .filter(item -> "ACTIVE".equals(item.status()))
                .map(project -> score(project, normalized))
                .filter(java.util.Objects::nonNull)
                .sorted(java.util.Comparator.comparingDouble(Match::confidence).reversed())
                .toList();
        if (!matches.isEmpty()) {
            Match best = matches.getFirst();
            boolean conflict = matches.size() > 1 && matches.get(1).confidence() == best.confidence();
            if (!conflict) return best;
        }
        var issue = ISSUE_KEY.matcher(searchableText);
        if (issue.find()) {
            String suggestedCode = issue.group(1).toUpperCase(Locale.ROOT);
            return new Match(null, "建议：" + suggestedCode, "PENDING", 0.70);
        }
        return new Match(null, "待归类", "PENDING", 0.0);
    }

    private Match score(ProjectDefinition project, String searchableText) {
        String code = canonical(project.code());
        String name = canonical(project.name());
        if (isUseful(code) && searchableText.contains(code)) {
            return new Match(project.id(), project.name(), "AUTO", 1.0);
        }
        if (isUseful(name) && searchableText.contains(name)) {
            return new Match(project.id(), project.name(), "AUTO", 1.0);
        }
        boolean keywordMatched = project.matchKeywords().stream()
                .map(ActivityModule::canonical)
                .filter(ActivityModule::isUseful)
                .anyMatch(searchableText::contains);
        return keywordMatched ? new Match(project.id(), project.name(), "AUTO", 0.95) : null;
    }

    private void autoCreateRepeatedProject(String latestTitle) {
        var latestMatcher = ISSUE_KEY.matcher(latestTitle);
        if (!latestMatcher.find()) return;
        String code = latestMatcher.group(1).toUpperCase(Locale.ROOT);
        if (projects().stream().anyMatch(project -> project.code().equalsIgnoreCase(code))) return;

        List<PendingTitle> matching = jdbc.sql("""
                SELECT id, window_title FROM activity_observation
                WHERE classification = 'PENDING'
                ORDER BY captured_at DESC
                """).query((rs, rowNum) -> new PendingTitle(
                        rs.getString("id"), sensitiveText.decrypt(rs.getString("window_title"))
                )).list().stream().filter(item -> {
                    var matcher = ISSUE_KEY.matcher(item.title());
                    return matcher.find() && matcher.group(1).equalsIgnoreCase(code);
                }).toList();
        if (matching.size() < 3) return;

        ProjectDefinition project = createProject(new CreateProjectRequest(code, code, List.of(code)));
        matching.forEach(item -> jdbc.sql("""
                UPDATE activity_observation
                SET project_id = :projectId, project_name = :projectName,
                    classification = 'AUTO', confidence = 0.90
                WHERE id = :id
                """).param("projectId", project.id()).param("projectName", project.name())
                .param("id", item.id()).update());
    }

    private static String canonical(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private static boolean isUseful(String value) {
        return value.codePointCount(0, value.length()) >= 2;
    }

    private record Match(String projectId, String projectName, String classification, double confidence) {
    }

    private record PendingTitle(String id, String title) {
    }
}
