package com.traceflow.activity;

import java.time.OffsetDateTime;

public record ActivityObservation(
        String id,
        OffsetDateTime capturedAt,
        String applicationName,
        String windowTitle,
        int durationSeconds,
        String projectId,
        String projectName,
        String classification,
        double confidence
) {
}
