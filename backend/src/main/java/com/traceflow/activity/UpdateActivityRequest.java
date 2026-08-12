package com.traceflow.activity;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public record UpdateActivityRequest(
        @Min(1) @Max(86400) int durationSeconds
) {
}
