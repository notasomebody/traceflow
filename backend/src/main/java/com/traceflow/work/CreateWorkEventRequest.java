package com.traceflow.work;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.OffsetDateTime;

public record CreateWorkEventRequest(
        OffsetDateTime occurredAt,
        @NotBlank String sourceType,
        @NotBlank String sourceName,
        @NotBlank String projectName,
        @NotBlank String title,
        String summary,
        String evidenceLevel,
        @PositiveOrZero int durationMinutes,
        Boolean includedInReport
) {}
