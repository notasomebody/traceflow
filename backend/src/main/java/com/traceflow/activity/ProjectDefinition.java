package com.traceflow.activity;

import java.util.List;

public record ProjectDefinition(String id, String name, String code, String status, List<String> matchKeywords) {
}
