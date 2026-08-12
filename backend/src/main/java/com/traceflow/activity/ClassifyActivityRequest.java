package com.traceflow.activity;

import jakarta.validation.constraints.NotBlank;

public record ClassifyActivityRequest(
        @NotBlank String projectId,
        String rememberKeyword
) {}
