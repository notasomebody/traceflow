package com.traceflow.report;

import java.time.LocalDate;

public record PeriodReport(
        ReportDraft report,
        LocalDate periodStart,
        LocalDate periodEnd,
        int sourceDailyCount
) {}
