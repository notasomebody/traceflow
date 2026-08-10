package com.traceflow.report;

import java.time.LocalDate;
import java.time.OffsetDateTime;

public record ReportDraft(
        String id,
        LocalDate reportDate,
        String reportType,
        String summary,
        String nextPlan,
        int targetMinutes,
        String status,
        OffsetDateTime confirmedAt,
        OffsetDateTime updatedAt
) {}
