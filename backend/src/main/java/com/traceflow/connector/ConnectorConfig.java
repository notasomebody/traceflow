package com.traceflow.connector;

import java.time.OffsetDateTime;

public record ConnectorConfig(
        String id,
        String name,
        String connectorType,
        boolean enabled,
        String privacyLevel,
        String syncStatus,
        OffsetDateTime lastSyncedAt
) {}
