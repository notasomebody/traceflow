package com.traceflow.activity;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.RequestParam;

@RestController
@RequestMapping("/api")
public class ActivityController {
    private final ActivityModule activities;

    public ActivityController(ActivityModule activities) {
        this.activities = activities;
    }

    @PostMapping("/projects")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectDefinition createProject(@Valid @RequestBody CreateProjectRequest request) {
        return activities.createProject(request);
    }

    @GetMapping("/projects")
    public List<ProjectDefinition> projects() {
        return activities.projects();
    }

    @PostMapping("/activity/ingest")
    @ResponseStatus(HttpStatus.CREATED)
    public ActivityObservation ingest(@Valid @RequestBody IngestActivityRequest request) {
        return activities.ingest(request);
    }

    @GetMapping("/activity")
    public List<ActivityObservation> observations(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return activities.observations(date);
    }

    @DeleteMapping("/activity")
    public ClearResult clearObservations() {
        return new ClearResult(activities.clearObservations());
    }

    @PatchMapping("/activity/{id}")
    public ActivityObservation updateObservation(@PathVariable String id, @Valid @RequestBody UpdateActivityRequest request) {
        return activities.updateObservation(id, request);
    }

    @DeleteMapping("/activity/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteObservation(@PathVariable String id) {
        activities.deleteObservation(id);
    }

    @PostMapping("/ocr/ingest")
    @ResponseStatus(HttpStatus.CREATED)
    public OcrObservation ingestOcr(@Valid @RequestBody IngestOcrRequest request) {
        return activities.ingestOcr(request);
    }

    @GetMapping("/ocr")
    public List<OcrObservation> ocr(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return activities.ocrObservations(date);
    }

    @PostMapping("/activity/{id}/classify")
    public ActivityObservation classify(@PathVariable String id, @Valid @RequestBody ClassifyActivityRequest request) {
        return activities.classifyObservation(id, request);
    }

    @PostMapping("/projects/{id}/status")
    public ProjectDefinition setProjectStatus(@PathVariable String id, @RequestParam String status) {
        return activities.setProjectStatus(id, status);
    }

    @DeleteMapping("/privacy/all-data")
    public ClearResult clearAllPrivateData() {
        int deleted = activities.clearAllPrivateData();
        activities.compactDatabase();
        return new ClearResult(deleted);
    }

    public record ClearResult(int deletedCount) {
    }
}
