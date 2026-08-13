package com.traceflow.activity;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record CreateProjectRequest(
        @NotBlank String name,
        String code,
        List<@NotBlank String> matchKeywords
) {
    public CreateProjectRequest {
        matchKeywords = matchKeywords == null ? List.of() : matchKeywords;
    }
}
