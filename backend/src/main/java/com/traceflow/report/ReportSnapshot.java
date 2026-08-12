package com.traceflow.report;

import java.time.LocalDate;
import java.time.OffsetDateTime;

public record ReportSnapshot(
        String id,
        String reportId,
        int version,
        LocalDate reportDate,
        String reportType,
        String summary,
        String nextPlan,
        int targetMinutes,
        String status,
        OffsetDateTime createdAt
) {}
