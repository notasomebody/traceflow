--liquibase formatted sql

--changeset traceflow:001
CREATE TABLE IF NOT EXISTS work_event (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    evidence_level TEXT NOT NULL DEFAULT 'METADATA',
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    included_in_report INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_event_occurred_at ON work_event(occurred_at);
CREATE INDEX IF NOT EXISTS idx_work_event_project ON work_event(project_name);

CREATE TABLE IF NOT EXISTS report_draft (
    id TEXT PRIMARY KEY,
    report_date TEXT NOT NULL,
    report_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    next_plan TEXT NOT NULL,
    target_minutes INTEGER NOT NULL DEFAULT 480,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    confirmed_at TEXT,
    submitted_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(report_date, report_type)
);

CREATE TABLE IF NOT EXISTS connector_config (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    connector_type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    privacy_level TEXT NOT NULL DEFAULT 'METADATA',
    sync_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    last_synced_at TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

--changeset traceflow:002
INSERT OR IGNORE INTO connector_config(id, name, connector_type, enabled, privacy_level, sync_status, settings_json)
VALUES
  ('git-local', 'Git / 内部代码平台', 'GIT', 1, 'METADATA', 'NOT_CONFIGURED', '{}'),
  ('tds-web', '星环 TDS 数据中台', 'BROWSER', 1, 'METADATA', 'NOT_CONFIGURED', '{}'),
  ('jira-web', 'Jira Workspace', 'JIRA', 1, 'METADATA', 'NOT_CONFIGURED', '{}'),
  ('local-files', '本地文件', 'FILESYSTEM', 0, 'METADATA', 'NOT_CONFIGURED', '{}');

--changeset traceflow:003
UPDATE connector_config
SET name = 'Git / 代码平台'
WHERE id = 'git-local'
  AND name = 'Git / 内部代码平台';

UPDATE connector_config
SET id = 'browser-work',
    name = '通用业务平台'
WHERE id = 'tds-web'
  AND name = '星环 TDS 数据中台';

--changeset traceflow:004
CREATE TABLE IF NOT EXISTS project_definition (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_match_keyword (
    project_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    PRIMARY KEY (project_id, keyword),
    FOREIGN KEY (project_id) REFERENCES project_definition(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_observation (
    id TEXT PRIMARY KEY,
    captured_at TEXT NOT NULL,
    application_name TEXT NOT NULL,
    window_title TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    project_id TEXT,
    project_name TEXT NOT NULL DEFAULT '待归类',
    classification TEXT NOT NULL DEFAULT 'PENDING',
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES project_definition(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_captured_at ON activity_observation(captured_at);
CREATE INDEX IF NOT EXISTS idx_activity_project_id ON activity_observation(project_id);

--changeset traceflow:005
CREATE TABLE IF NOT EXISTS report_snapshot (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    report_date TEXT NOT NULL,
    report_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    next_plan TEXT NOT NULL,
    target_minutes INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(report_id, version),
    FOREIGN KEY (report_id) REFERENCES report_draft(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_snapshot_type_date ON report_snapshot(report_type, report_date);

--changeset traceflow:006
CREATE TABLE IF NOT EXISTS ocr_observation (
    id TEXT PRIMARY KEY,
    captured_at TEXT NOT NULL,
    application_name TEXT NOT NULL,
    recognized_text TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ocr_observation_captured_at ON ocr_observation(captured_at);
