[CmdletBinding()]
param(
    [string]$Repository = "notasomebody/traceflow",
    [switch]$KeepInstaller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
    Write-Host "[TraceFlow] $Message" -ForegroundColor Cyan
}

if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw "Invalid GitHub repository: $Repository"
}

$headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "TraceFlow-Installer"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$releaseUrl = "https://api.github.com/repos/$Repository/releases/latest"
Write-Step "Reading the latest stable GitHub release"
try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers -Method Get
} catch {
    throw "Unable to read the latest stable GitHub release. Check the network and release page: $releaseUrl"
}

if ($release.draft -or $release.prerelease) {
    throw "The GitHub release is a draft or prerelease. Installation stopped."
}

$installerAsset = @($release.assets) | Where-Object {
    $_.name -match '(?i)_x64-setup\.exe$'
} | Select-Object -First 1
$checksumAsset = @($release.assets) | Where-Object {
    $_.name -eq 'SHA256SUMS.txt'
} | Select-Object -First 1
if ($null -eq $installerAsset -or $null -eq $checksumAsset) {
    throw "Release $($release.tag_name) does not contain a Windows installer and SHA256SUMS.txt."
}

$downloadRoot = Join-Path ([IO.Path]::GetTempPath()) "TraceFlowInstall-$($release.tag_name)"
[IO.Directory]::CreateDirectory($downloadRoot) | Out-Null
$installerPath = Join-Path $downloadRoot $installerAsset.name
$checksumPath = Join-Path $downloadRoot $checksumAsset.name

Write-Step "Downloading the $($release.tag_name) installer"
Invoke-WebRequest -Uri $installerAsset.browser_download_url -Headers $headers -OutFile $installerPath
Invoke-WebRequest -Uri $checksumAsset.browser_download_url -Headers $headers -OutFile $checksumPath

$checksumLine = Get-Content -LiteralPath $checksumPath -Encoding utf8 | Where-Object {
    $_ -match [regex]::Escape($installerAsset.name) + '$'
} | Select-Object -First 1
if (-not $checksumLine -or $checksumLine -notmatch '^([A-Fa-f0-9]{64})\s+') {
    throw "The installer checksum was not found in SHA256SUMS.txt."
}
$expectedHash = $Matches[1].ToUpperInvariant()
$actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) {
    throw "Installer SHA-256 verification failed. The file may be incomplete or modified."
}
Write-Step "SHA-256 verified: $actualHash"

$running = Get-Process -Name "traceflow-desktop" -ErrorAction SilentlyContinue
if ($running) {
    throw "TraceFlow is running. Exit it from the tray and retry. The installer will not force-close unsaved work."
}

Write-Step "Installing TraceFlow. The user must personally review any Windows security prompt."
$installation = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
if ($installation.ExitCode -ne 0) {
    throw "Installation failed with exit code $($installation.ExitCode)."
}

$installFolder = "$([char]0x8FF9)$([char]0x6C47) TraceFlow"
$applicationPath = Join-Path $env:LOCALAPPDATA "$installFolder\traceflow-desktop.exe"
if (-not [IO.File]::Exists($applicationPath)) {
    throw "Installation completed but the TraceFlow executable was not found: $applicationPath"
}

Write-Step "Starting TraceFlow"
Start-Process -FilePath $applicationPath | Out-Null
$health = $null
for ($attempt = 1; $attempt -le 15; $attempt++) {
    Start-Sleep -Seconds 2
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:17890/actuator/health" -TimeoutSec 2
        if ($health.status -eq "UP") { break }
    } catch {
        $health = $null
    }
}
if ($null -eq $health -or $health.status -ne "UP") {
    throw "TraceFlow was installed, but its local service did not become healthy within 30 seconds."
}

if (-not $KeepInstaller) {
    [IO.File]::Delete($installerPath)
    [IO.File]::Delete($checksumPath)
    [IO.Directory]::Delete($downloadRoot, $false)
}

[pscustomobject]@{
    Product = "$([char]0x8FF9)$([char]0x6C47) TraceFlow"
    Version = $release.tag_name
    Installed = $true
    Health = $health.status
    ApplicationPath = $applicationPath
    Sha256 = $actualHash
}
