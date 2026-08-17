package com.traceflow.activity;

import java.util.List;

public record ProjectCandidate(
        String suggestedName,
        String code,
        int occurrenceCount,
        double confidence,
        List<String> examples
) {
}
