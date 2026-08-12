package com.traceflow.activity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.OffsetDateTime;

public record IngestOcrRequest(
        @NotNull OffsetDateTime capturedAt,
        @NotBlank String applicationName,
        @NotBlank String recognizedText
) {}
