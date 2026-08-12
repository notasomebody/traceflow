package com.traceflow.activity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record CreateProjectRequest(
        @NotBlank String name,
        String code,
        @NotEmpty List<@NotBlank String> matchKeywords
) {
}
