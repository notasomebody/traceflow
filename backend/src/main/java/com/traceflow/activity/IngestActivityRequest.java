package com.traceflow.activity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.time.OffsetDateTime;

public record IngestActivityRequest(
        @NotNull OffsetDateTime capturedAt,
        @NotBlank String applicationName,
        @NotBlank String windowTitle,
        @Positive int durationSeconds
) {
}
