package com.traceflow.work;

import java.time.OffsetDateTime;

public record WorkEvent(
        String id,
        OffsetDateTime occurredAt,
        String sourceType,
        String sourceName,
        String projectName,
        String title,
        String summary,
        String evidenceLevel,
        int durationMinutes,
        boolean includedInReport
) {}
