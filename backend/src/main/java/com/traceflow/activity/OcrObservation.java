package com.traceflow.activity;

import java.time.OffsetDateTime;

public record OcrObservation(
        String id,
        OffsetDateTime capturedAt,
        String applicationName,
        String recognizedText
) {}
