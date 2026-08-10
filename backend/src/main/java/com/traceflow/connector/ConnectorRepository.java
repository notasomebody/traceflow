package com.traceflow.connector;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;

@Repository
public class ConnectorRepository {
    private final JdbcClient jdbc;

    public ConnectorRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<ConnectorConfig> findAll() {
        return jdbc.sql("""
                SELECT id, name, connector_type, enabled, privacy_level, sync_status, last_synced_at
                FROM connector_config ORDER BY rowid
                """)
                .query((rs, rowNum) -> new ConnectorConfig(
                        rs.getString("id"), rs.getString("name"), rs.getString("connector_type"),
                        rs.getInt("enabled") == 1, rs.getString("privacy_level"), rs.getString("sync_status"),
                        rs.getString("last_synced_at") == null ? null : OffsetDateTime.parse(rs.getString("last_synced_at"))
                )).list();
    }
}
