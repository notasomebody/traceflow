package com.traceflow.security;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/backups")
public class BackupController {
    private final BackupService backups;
    public BackupController(BackupService backups) { this.backups = backups; }

    @PostMapping("/export")
    public BackupResponse exportBackup(@Valid @RequestBody PasswordRequest request) { return new BackupResponse(backups.exportBackup(request.password()), 0); }
    @PostMapping("/import")
    public BackupResponse importBackup(@Valid @RequestBody ImportRequest request) {
        try {
            return new BackupResponse(null, backups.importBackup(request.backup(), request.password()));
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
        }
    }

    public record PasswordRequest(@NotBlank @Size(min = 8) String password) {}
    public record ImportRequest(@NotBlank String backup, @NotBlank @Size(min = 8) String password) {}
    public record BackupResponse(String backup, int restoredCount) {}
}
