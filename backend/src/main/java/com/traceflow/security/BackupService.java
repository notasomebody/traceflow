package com.traceflow.security;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class BackupService {
    private static final byte[] MAGIC = "TFBACKUP1".getBytes(StandardCharsets.US_ASCII);
    private final JdbcClient jdbc;
    private final SensitiveTextCipher sensitiveText;
    private final ObjectMapper json;
    private final SecureRandom random = new SecureRandom();

    public BackupService(JdbcClient jdbc, SensitiveTextCipher sensitiveText, ObjectMapper json) {
        this.jdbc = jdbc;
        this.sensitiveText = sensitiveText;
        this.json = json;
    }

    public String exportBackup(String password) {
        requirePassword(password);
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("formatVersion", 1);
            payload.put("exportedAt", OffsetDateTime.now().toString());
            payload.put("projects", rows("SELECT id,name,code,status,created_at,updated_at FROM project_definition", List.of()));
            payload.put("keywords", rows("SELECT project_id,keyword FROM project_match_keyword", List.of()));
            payload.put("events", rows("SELECT * FROM work_event", List.of("source_name", "project_name", "title", "summary")));
            payload.put("activities", rows("SELECT * FROM activity_observation", List.of("window_title")));
            payload.put("ocr", rows("SELECT * FROM ocr_observation", List.of("application_name", "recognized_text")));
            payload.put("reports", rows("SELECT * FROM report_draft", List.of("summary", "next_plan")));
            payload.put("snapshots", rows("SELECT * FROM report_snapshot", List.of("summary", "next_plan")));
            return encrypt(json.writeValueAsBytes(payload), password);
        } catch (Exception exception) {
            throw new IllegalStateException("无法生成加密备份", exception);
        }
    }

    @Transactional
    public int importBackup(String backup, String password) {
        requirePassword(password);
        try {
            Map<String, Object> payload = json.readValue(decrypt(backup, password), new TypeReference<>() {});
            if (!Integer.valueOf(1).equals(payload.get("formatVersion"))) throw new IllegalArgumentException("备份版本不受支持");
            clearForRestore();
            int restored = 0;
            restored += insertProjects(list(payload, "projects"));
            restored += insertKeywords(list(payload, "keywords"));
            restored += insertEvents(list(payload, "events"));
            restored += insertActivities(list(payload, "activities"));
            restored += insertOcr(list(payload, "ocr"));
            restored += insertReports(list(payload, "reports"));
            restored += insertSnapshots(list(payload, "snapshots"));
            return restored;
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("备份密码错误、文件损坏或版本不受支持", exception);
        }
    }

    private List<Map<String, Object>> rows(String sql, List<String> sensitiveColumns) {
        return jdbc.sql(sql).query((rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            var metadata = rs.getMetaData();
            for (int index = 1; index <= metadata.getColumnCount(); index++) {
                String column = metadata.getColumnLabel(index).toLowerCase();
                Object value = rs.getObject(index);
                if (value instanceof String text && sensitiveColumns.contains(column)) value = sensitiveText.decrypt(text);
                row.put(column, value);
            }
            return row;
        }).list();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> list(Map<String, Object> payload, String name) {
        Object value = payload.get(name);
        if (!(value instanceof List<?> values)) throw new IllegalArgumentException("备份结构不完整：" + name);
        return values.stream().map(item -> (Map<String, Object>) item).toList();
    }

    private int insertProjects(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO project_definition(id,name,code,status,created_at,updated_at) VALUES(:id,:name,:code,:status,:created,:updated)").param("id", s(row,"id")).param("name",s(row,"name")).param("code",s(row,"code")).param("status",s(row,"status")).param("created",s(row,"created_at")).param("updated",s(row,"updated_at")).update()).sum(); }
    private int insertKeywords(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO project_match_keyword(project_id,keyword) VALUES(:project,:keyword)").param("project",s(row,"project_id")).param("keyword",s(row,"keyword")).update()).sum(); }
    private int insertEvents(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO work_event(id,occurred_at,source_type,source_name,project_name,title,summary,evidence_level,duration_minutes,included_in_report,created_at) VALUES(:id,:occurred,:sourceType,:sourceName,:projectName,:title,:summary,:evidence,:duration,:included,:created)").param("id",s(row,"id")).param("occurred",s(row,"occurred_at")).param("sourceType",s(row,"source_type")).param("sourceName",enc(row,"source_name")).param("projectName",enc(row,"project_name")).param("title",enc(row,"title")).param("summary",enc(row,"summary")).param("evidence",s(row,"evidence_level")).param("duration",n(row,"duration_minutes")).param("included",n(row,"included_in_report")).param("created",s(row,"created_at")).update()).sum(); }
    private int insertActivities(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO activity_observation(id,captured_at,application_name,window_title,duration_seconds,project_id,project_name,classification,confidence,created_at) VALUES(:id,:captured,:app,:title,:duration,:projectId,:projectName,:classification,:confidence,:created)").param("id",s(row,"id")).param("captured",s(row,"captured_at")).param("app",s(row,"application_name")).param("title",enc(row,"window_title")).param("duration",n(row,"duration_seconds")).param("projectId",nullable(row,"project_id")).param("projectName",s(row,"project_name")).param("classification",s(row,"classification")).param("confidence",number(row,"confidence")).param("created",s(row,"created_at")).update()).sum(); }
    private int insertOcr(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO ocr_observation(id,captured_at,application_name,recognized_text,created_at) VALUES(:id,:captured,:app,:text,:created)").param("id",s(row,"id")).param("captured",s(row,"captured_at")).param("app",enc(row,"application_name")).param("text",enc(row,"recognized_text")).param("created",s(row,"created_at")).update()).sum(); }
    private int insertReports(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO report_draft(id,report_date,report_type,summary,next_plan,target_minutes,status,confirmed_at,submitted_at,updated_at) VALUES(:id,:date,:type,:summary,:nextPlan,:target,:status,:confirmed,:submitted,:updated)").param("id",s(row,"id")).param("date",s(row,"report_date")).param("type",s(row,"report_type")).param("summary",enc(row,"summary")).param("nextPlan",enc(row,"next_plan")).param("target",n(row,"target_minutes")).param("status",s(row,"status")).param("confirmed",nullable(row,"confirmed_at")).param("submitted",nullable(row,"submitted_at")).param("updated",s(row,"updated_at")).update()).sum(); }
    private int insertSnapshots(List<Map<String, Object>> rows) { return rows.stream().mapToInt(row -> jdbc.sql("INSERT INTO report_snapshot(id,report_id,version,report_date,report_type,summary,next_plan,target_minutes,status,created_at) VALUES(:id,:reportId,:version,:date,:type,:summary,:nextPlan,:target,:status,:created)").param("id",s(row,"id")).param("reportId",s(row,"report_id")).param("version",n(row,"version")).param("date",s(row,"report_date")).param("type",s(row,"report_type")).param("summary",enc(row,"summary")).param("nextPlan",enc(row,"next_plan")).param("target",n(row,"target_minutes")).param("status",s(row,"status")).param("created",s(row,"created_at")).update()).sum(); }

    private void clearForRestore() {
        for (String table : List.of("report_snapshot","report_draft","work_event","ocr_observation","activity_observation","project_match_keyword","project_definition")) jdbc.sql("DELETE FROM " + table).update();
    }
    private String s(Map<String,Object> row,String key){ return String.valueOf(row.get(key)); }
    private Object nullable(Map<String,Object> row,String key){ return row.get(key); }
    private int n(Map<String,Object> row,String key){ return ((Number)row.get(key)).intValue(); }
    private Number number(Map<String,Object> row,String key){ return (Number)row.get(key); }
    private String enc(Map<String,Object> row,String key){ return sensitiveText.encrypt(s(row,key)); }

    private String encrypt(byte[] plaintext, String password) throws Exception {
        byte[] salt = random.generateSeed(16), iv = random.generateSeed(12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, derive(password, salt), new GCMParameterSpec(128, iv));
        byte[] encrypted = cipher.doFinal(plaintext);
        ByteBuffer output = ByteBuffer.allocate(MAGIC.length + salt.length + iv.length + encrypted.length);
        output.put(MAGIC).put(salt).put(iv).put(encrypted);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(output.array());
    }
    private byte[] decrypt(String backup, String password) throws Exception {
        ByteBuffer input = ByteBuffer.wrap(Base64.getUrlDecoder().decode(backup));
        byte[] magic = new byte[MAGIC.length], salt = new byte[16], iv = new byte[12], encrypted = new byte[input.remaining() - MAGIC.length - 28];
        input.get(magic).get(salt).get(iv).get(encrypted);
        if (!java.util.Arrays.equals(magic, MAGIC)) throw new IllegalArgumentException("不是 TraceFlow 备份");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, derive(password, salt), new GCMParameterSpec(128, iv));
        return cipher.doFinal(encrypted);
    }
    private SecretKeySpec derive(String password, byte[] salt) throws Exception {
        var spec = new PBEKeySpec(password.toCharArray(), salt, 310_000, 256);
        return new SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(), "AES");
    }
    private void requirePassword(String password) {
        if (password == null || password.length() < 8) {
            throw new IllegalArgumentException("备份密码至少 8 位");
        }
    }
}
