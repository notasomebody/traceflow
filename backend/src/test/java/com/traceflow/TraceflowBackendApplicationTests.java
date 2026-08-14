package com.traceflow;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class TraceflowBackendApplicationTests {
    private static final String TEST_DB = System.getProperty("java.io.tmpdir") + "/traceflow-phase-one-" + java.util.UUID.randomUUID() + ".db";

    @DynamicPropertySource
    static void testDatabase(DynamicPropertyRegistry registry) {
        registry.add("traceflow.db-path", () -> TEST_DB);
        registry.add("traceflow.data-dir", () -> System.getProperty("java.io.tmpdir") + "/traceflow-keys-" + java.util.UUID.randomUUID());
        registry.add("traceflow.key-protection", () -> "test");
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private ObjectMapper json;

    @Test
    void contextLoads() {
    }

    @Test
    void installedDesktopOriginCanUseTheLocalApi() throws Exception {
        mvc.perform(options("/api/reports/daily/generate")
                        .header("Origin", "http://tauri.localhost")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "content-type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://tauri.localhost"))
                .andExpect(header().string("Access-Control-Allow-Methods", org.hamcrest.Matchers.containsString("POST")));
        mvc.perform(get("/api/dashboard")
                        .param("date", "2026-08-13")
                        .header("Origin", "http://tauri.localhost"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://tauri.localhost"));
    }

    @Test
    void phaseOneApiFlowWorks() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));

        mvc.perform(post("/api/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"occurredAt\":\"2026-08-10T10:00:00+08:00\",\"sourceType\":\"MANUAL\",\"sourceName\":\"手动补充\",\"projectName\":\"一期验收\",\"title\":\"完成接口测试\",\"summary\":\"验证核心流程\",\"durationMinutes\":120}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.projectName").value("一期验收"));

        mvc.perform(get("/api/dashboard").param("date", "2026-08-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allocatedMinutes").value(org.hamcrest.Matchers.greaterThanOrEqualTo(120)))
                .andExpect(jsonPath("$.events[*].projectName", org.hamcrest.Matchers.hasItem("一期验收")));

        mvc.perform(post("/api/reports/daily/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-08-10\",\"targetMinutes\":480}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary").value(org.hamcrest.Matchers.containsString("一期验收")))
                .andExpect(jsonPath("$.status").value("DRAFT"));

        mvc.perform(post("/api/reports/daily/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-08-10\",\"summary\":\"已完成一期验收。\",\"nextPlan\":\"继续回归测试。\",\"targetMinutes\":480}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"));

        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT title FROM work_event LIMIT 1").query(String.class).single())
                .startsWith("enc:v1:");
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT summary FROM report_draft LIMIT 1").query(String.class).single())
                .startsWith("enc:v1:");
    }

    @Test
    void activityIsClassifiedAgainstUserProjectsOrSentToInbox() throws Exception {
        mvc.perform(post("/api/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"数据中台\",\"code\":\"TDS\",\"matchKeywords\":[\"TDS\",\"数据建模\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("数据中台"));

        mvc.perform(post("/api/activity/ingest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"capturedAt\":\"2026-08-11T09:30:00+08:00\",\"applicationName\":\"Code.exe\",\"windowTitle\":\"TDS 数据建模 - Visual Studio Code\",\"durationSeconds\":300}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.classification").value("AUTO"))
                .andExpect(jsonPath("$.projectName").value("数据中台"));

        mvc.perform(post("/api/activity/ingest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"capturedAt\":\"2026-08-11T10:00:00+08:00\",\"applicationName\":\"unknown.exe\",\"windowTitle\":\"尚未配置的工作窗口\",\"durationSeconds\":120}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.classification").value("PENDING"))
                .andExpect(jsonPath("$.projectName").value("待归类"));

        mvc.perform(get("/api/activity").param("date", "2026-08-11"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[*].projectName", org.hamcrest.Matchers.hasItems("数据中台", "待归类")))
                .andExpect(jsonPath("$[*].windowTitle", org.hamcrest.Matchers.hasItem("尚未配置的工作窗口")));

        String storedTitle = jdbc.sql("""
                SELECT window_title FROM activity_observation
                WHERE application_name = 'unknown.exe'
                """).query(String.class).single();
        org.assertj.core.api.Assertions.assertThat(storedTitle).startsWith("enc:v1:");
        byte[] databaseBytes = java.nio.file.Files.readAllBytes(java.nio.file.Path.of(TEST_DB));
        byte[] plaintextBytes = "尚未配置的工作窗口".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        org.assertj.core.api.Assertions.assertThat(containsSequence(databaseBytes, plaintextBytes)).isFalse();

        String pendingId = jdbc.sql("SELECT id FROM activity_observation WHERE classification = 'PENDING'").query(String.class).single();
        String projectId = jdbc.sql("SELECT id FROM project_definition WHERE code = 'TDS'").query(String.class).single();
        mvc.perform(post("/api/activity/{id}/classify", pendingId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"projectId\":\"" + projectId + "\",\"rememberKeyword\":\"unknown.exe\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.classification").value("MANUAL"))
                .andExpect(jsonPath("$.confidence").value(1.0));
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM project_match_keyword WHERE keyword = 'unknown.exe'").query(Integer.class).single()).isOne();

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/activity"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedCount").value(2));
        mvc.perform(get("/api/activity").param("date", "2026-08-11"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void projectCanBeCreatedWithOnlyAName() throws Exception {
        String body = mvc.perform(post("/api/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"仅名称项目\",\"code\":\"\",\"matchKeywords\":[]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("仅名称项目"))
                .andExpect(jsonPath("$.matchKeywords.length()").value(0))
                .andReturn().getResponse().getContentAsString();
        String id = json.readTree(body).get("id").asText();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/projects/{id}", id))
                .andExpect(status().isNoContent());
    }

    @Test
    void adjacentActivityIsMergedAndCanBeEditedOrDeleted() throws Exception {
        String first = "{\"capturedAt\":\"2026-08-12T09:00:00+08:00\",\"applicationName\":\"Editor.exe\",\"windowTitle\":\"同一工作窗口\",\"durationSeconds\":60}";
        String second = "{\"capturedAt\":\"2026-08-12T09:01:00+08:00\",\"applicationName\":\"Editor.exe\",\"windowTitle\":\"同一工作窗口\",\"durationSeconds\":90}";
        mvc.perform(post("/api/activity/ingest").contentType(MediaType.APPLICATION_JSON).content(first))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.durationSeconds").value(60));
        String mergedBody = mvc.perform(post("/api/activity/ingest").contentType(MediaType.APPLICATION_JSON).content(second))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.durationSeconds").value(150))
                .andReturn().getResponse().getContentAsString();
        String id = json.readTree(mergedBody).get("id").asText();
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM activity_observation WHERE application_name = 'Editor.exe'").query(Integer.class).single()).isOne();

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/activity/{id}", id)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"durationSeconds\":300}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.durationSeconds").value(300));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/activity/{id}", id))
                .andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM activity_observation WHERE id = :id").param("id", id).query(Integer.class).single()).isZero();
    }

    @Test
    void weeklyAndMonthlyReportsAggregateDailyReportsAndKeepSnapshots() throws Exception {
        confirmDaily("2026-08-03", "完成数据建模。", "继续联调。");
        confirmDaily("2026-08-04", "完成接口联调。", "准备验收。");

        mvc.perform(post("/api/reports/weekly/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-08-04\",\"targetMinutes\":480}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.report.reportType").value("WEEKLY"))
                .andExpect(jsonPath("$.periodStart").value("2026-08-03"))
                .andExpect(jsonPath("$.periodEnd").value("2026-08-09"))
                .andExpect(jsonPath("$.sourceDailyCount").value(2))
                .andExpect(jsonPath("$.report.summary", org.hamcrest.Matchers.containsString("完成数据建模")));

        mvc.perform(post("/api/reports/WEEKLY/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-08-03\",\"summary\":\"已检查的周报\",\"nextPlan\":\"下周继续推进\",\"targetMinutes\":960}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.summary").value("已检查的周报"));

        mvc.perform(post("/api/reports/monthly/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-08-04\",\"targetMinutes\":480}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.report.reportType").value("MONTHLY"))
                .andExpect(jsonPath("$.periodStart").value("2026-08-01"))
                .andExpect(jsonPath("$.periodEnd").value("2026-08-31"))
                .andExpect(jsonPath("$.sourceDailyCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(2)))
                .andExpect(jsonPath("$.report.summary", org.hamcrest.Matchers.containsString("完成接口联调")));

        mvc.perform(get("/api/reports/history").param("type", "WEEKLY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].reportType").value("WEEKLY"));
        mvc.perform(get("/api/reports/snapshots").param("type", "WEEKLY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].summary").value("已检查的周报"))
                .andExpect(jsonPath("$[*].summary", org.hamcrest.Matchers.hasItem(org.hamcrest.Matchers.containsString("完成数据建模"))));
    }

    @Test
    void historicalDailyReportCanBeImportedAndReadBackEncrypted() throws Exception {
        mvc.perform(post("/api/reports/daily/import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-07-20\",\"summary\":\"企业微信历史日报正文\",\"nextPlan\":\"继续完成历史项目\",\"targetMinutes\":480}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.reportDate").value("2026-07-20"))
                .andExpect(jsonPath("$.status").value("IMPORTED"));

        mvc.perform(get("/api/reports/history").param("type", "DAILY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].summary", org.hamcrest.Matchers.hasItem("企业微信历史日报正文")));
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT summary FROM report_draft WHERE report_date = '2026-07-20'")
                        .query(String.class).single())
                .startsWith("enc:v1:");
    }

    @Test
    void ocrTextIsEncryptedAtRestAndReadableThroughTheLocalApi() throws Exception {
        mvc.perform(post("/api/ocr/ingest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"capturedAt\":\"2026-08-11T14:30:00+08:00\",\"applicationName\":\"ControlledTest.exe\",\"recognizedText\":\"受控窗口的本地OCR文本\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recognizedText").value("受控窗口的本地OCR文本"));
        mvc.perform(get("/api/ocr").param("date", "2026-08-11"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].recognizedText").value("受控窗口的本地OCR文本"));
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT recognized_text FROM ocr_observation LIMIT 1").query(String.class).single())
                .startsWith("enc:v1:");
    }

    @Test
    void privacyCleanupRemovesAllUserContent() throws Exception {
        confirmDaily("2026-08-12", "临时隐私清理测试。", "清理后不应保留。");
        mvc.perform(post("/api/ocr/ingest").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"capturedAt\":\"2026-08-12T10:00:00+08:00\",\"applicationName\":\"Test.exe\",\"recognizedText\":\"待清理\"}"))
                .andExpect(status().isCreated());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/privacy/all-data"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(2)));
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM report_draft").query(Integer.class).single()).isZero();
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM ocr_observation").query(Integer.class).single()).isZero();
    }

    @Test
    void encryptedBackupCanRestoreDataOnAnotherMachineKey() throws Exception {
        String projectName = "跨电脑恢复项目";
        mvc.perform(post("/api/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + projectName + "\",\"code\":\"BACKUP\",\"matchKeywords\":[\"restore-keyword\"]}"))
                .andExpect(status().isCreated());
        confirmDaily("2026-08-12", "备份中的日报正文", "备份中的明日计划");

        String responseBody = mvc.perform(post("/api/backups/export")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"safe-pass-2026\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.backup").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        JsonNode exported = json.readTree(responseBody);
        String backup = exported.get("backup").asText();
        org.assertj.core.api.Assertions.assertThat(backup)
                .doesNotContain(projectName)
                .doesNotContain("备份中的日报正文");

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/privacy/all-data"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/backups/import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of("backup", backup, "password", "safe-pass-2026"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restoredCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(3)));
        mvc.perform(get("/api/projects"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].name", org.hamcrest.Matchers.hasItem(projectName)));
        mvc.perform(get("/api/reports/history").param("type", "DAILY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].summary", org.hamcrest.Matchers.hasItem("备份中的日报正文")));

        mvc.perform(post("/api/backups/import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of("backup", backup, "password", "wrong-pass-2026"))))
                .andExpect(status().isBadRequest());
    }

    private void confirmDaily(String date, String summary, String nextPlan) throws Exception {
        mvc.perform(post("/api/reports/daily/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"" + date + "\",\"summary\":\"" + summary + "\",\"nextPlan\":\"" + nextPlan + "\",\"targetMinutes\":480}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"));
    }

    private static boolean containsSequence(byte[] source, byte[] target) {
        outer:
        for (int start = 0; start <= source.length - target.length; start++) {
            for (int offset = 0; offset < target.length; offset++) {
                if (source[start + offset] != target[offset]) {
                    continue outer;
                }
            }
            return true;
        }
        return false;
    }
}
