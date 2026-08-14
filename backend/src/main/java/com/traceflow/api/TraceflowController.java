package com.traceflow.api;

import com.traceflow.connector.ConnectorConfig;
import com.traceflow.connector.ConnectorRepository;
import com.traceflow.report.ReportDraft;
import com.traceflow.report.ReportService;
import com.traceflow.report.PeriodReport;
import com.traceflow.report.ReportSnapshot;
import com.traceflow.work.CreateWorkEventRequest;
import com.traceflow.work.WorkEvent;
import com.traceflow.work.WorkEventRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api")
public class TraceflowController {
    private final WorkEventRepository events;
    private final ConnectorRepository connectors;
    private final ReportService reports;

    public TraceflowController(WorkEventRepository events, ConnectorRepository connectors, ReportService reports) {
        this.events = events;
        this.connectors = connectors;
        this.reports = reports;
    }

    @GetMapping("/dashboard")
    public Dashboard dashboard(@RequestParam(defaultValue = "#{T(java.time.LocalDate).now()}")
                               @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        List<WorkEvent> dayEvents = events.findByDate(date);
        int allocatedMinutes = dayEvents.stream().filter(WorkEvent::includedInReport).mapToInt(WorkEvent::durationMinutes).sum();
        return new Dashboard(date, dayEvents, connectors.findAll(), reports.find(date).orElse(null), allocatedMinutes, 480);
    }

    @PostMapping("/events")
    @ResponseStatus(HttpStatus.CREATED)
    public WorkEvent createEvent(@Valid @RequestBody CreateWorkEventRequest request) {
        return events.create(request);
    }

    @GetMapping("/connectors")
    public List<ConnectorConfig> connectors() {
        return connectors.findAll();
    }

    @PostMapping("/reports/daily/generate")
    public ReportDraft generate(@Valid @RequestBody GenerateReportRequest request) {
        return reports.generateDaily(request.date(), request.targetMinutes());
    }

    @PostMapping("/reports/daily/confirm")
    public ReportDraft confirm(@Valid @RequestBody ConfirmReportRequest request) {
        return reports.confirm(request.date(), request.summary(), request.nextPlan(), request.targetMinutes());
    }

    @PostMapping("/reports/daily/import")
    @ResponseStatus(HttpStatus.CREATED)
    public ReportDraft importDaily(@Valid @RequestBody ConfirmReportRequest request) {
        return reports.importDaily(request.date(), request.summary(), request.nextPlan(), request.targetMinutes());
    }

    @PostMapping("/reports/weekly/generate")
    public PeriodReport generateWeekly(@Valid @RequestBody GenerateReportRequest request) {
        return reports.generateWeekly(request.date(), request.targetMinutes());
    }

    @PostMapping("/reports/monthly/generate")
    public PeriodReport generateMonthly(@Valid @RequestBody GenerateReportRequest request) {
        return reports.generateMonthly(request.date(), request.targetMinutes());
    }

    @PostMapping("/reports/{type}/confirm")
    public ReportDraft confirmPeriod(@PathVariable String type, @Valid @RequestBody ConfirmReportRequest request) {
        return reports.confirm(request.date(), type, request.summary(), request.nextPlan(), request.targetMinutes());
    }

    @GetMapping("/reports/history")
    public List<ReportDraft> reportHistory(@RequestParam(defaultValue = "DAILY") String type) {
        return reports.history(type);
    }

    @GetMapping("/reports/snapshots")
    public List<ReportSnapshot> reportSnapshots(@RequestParam(defaultValue = "DAILY") String type) {
        return reports.snapshots(type);
    }

    public record Dashboard(LocalDate date, List<WorkEvent> events, List<ConnectorConfig> connectors,
                            ReportDraft report, int allocatedMinutes, int targetMinutes) {}

    public record GenerateReportRequest(LocalDate date, @Min(0) @Max(1440) int targetMinutes) {}

    public record ConfirmReportRequest(LocalDate date, @NotBlank String summary, @NotBlank String nextPlan,
                                       @Min(0) @Max(1440) int targetMinutes) {}
}
