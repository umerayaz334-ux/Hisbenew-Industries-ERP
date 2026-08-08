param(
    [int]$Port = 8000,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"

function Get-ListenerProcessIds {
    param([int]$ListenPort)

    try {
        $connections = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction Stop
        return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        $lines = netstat -ano | Select-String ":$ListenPort\s"
        $ids = foreach ($line in $lines) {
            if ($line.Line -match "LISTENING\s+(\d+)$") {
                [int]$Matches[1]
            }
        }
        return @($ids | Select-Object -Unique)
    }
}

function Get-ProcessRecord {
    param([int]$ProcessId)
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-IsHisbenewBackendProcess {
    param([int]$ProcessId)

    $process = Get-ProcessRecord -ProcessId $ProcessId
    if (-not $process) {
        return $false
    }

    $parent = Get-ProcessRecord -ProcessId ([int]$process.ParentProcessId)
    $context = "$($process.CommandLine) $($parent.CommandLine)"
    return (
        $context -match "uvicorn" -and
        $context -match "app\.main:app" -and
        $context.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    )
}

function Stop-ExistingBridgeListeners {
    param([int[]]$ProcessIds)

    $stopIds = New-Object System.Collections.Generic.HashSet[int]
    foreach ($processId in $ProcessIds) {
        if (-not (Test-IsHisbenewBackendProcess -ProcessId $processId)) {
            throw "Port $Port is already in use by process $processId, but it does not look like the Hisbenew backend. Stop that process or choose another port."
        }

        [void]$stopIds.Add($processId)
        $process = Get-ProcessRecord -ProcessId $processId
        if ($process -and (Test-IsHisbenewBackendProcess -ProcessId ([int]$process.ParentProcessId))) {
            [void]$stopIds.Add([int]$process.ParentProcessId)
        }
    }

    foreach ($processId in $stopIds) {
        Write-Host "Stopping existing Hisbenew backend process $processId on port $Port"
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

$listenerProcessIds = Get-ListenerProcessIds -ListenPort $Port
if ($listenerProcessIds.Count -gt 0) {
    if (-not $Restart) {
        Write-Host "Port $Port is already in use by process id(s): $($listenerProcessIds -join ', ')"
        Write-Host "Close the old local ERP backend window, or run this script with -Restart."
        exit 1
    }

    Stop-ExistingBridgeListeners -ProcessIds $listenerProcessIds
}

$pythonCandidates = @(
    (Join-Path $backendDir "venv\Scripts\python.exe"),
    (Join-Path $backendDir ".venv\Scripts\python.exe"),
    (Join-Path $projectRoot "venv\Scripts\python.exe"),
    (Join-Path $projectRoot ".venv\Scripts\python.exe")
)

$pythonPath = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pythonPath) {
    $pythonPath = "python"
}

$dbPath = (Join-Path $backendDir "hisbenew_industries.db").Replace("\", "/")
$env:APP_DATA_DIR = $backendDir
$env:STATIC_DIR = Join-Path $backendDir "static"
$env:FRONTEND_DIST_DIR = Join-Path $frontendDir "dist"
$env:DATABASE_URL = "sqlite:///$dbPath"

if ([string]::IsNullOrWhiteSpace($env:CORS_ALLOW_ORIGINS)) {
    $env:CORS_ALLOW_ORIGINS = "https://hisbenew.com,https://www.hisbenew.com,http://127.0.0.1:5173,http://localhost:5173"
}

Write-Host "Starting Hisbenew local printer bridge at http://127.0.0.1:$Port"
Write-Host "Keep this window open while printing from hisbenew.com."
Write-Host "Press Ctrl+C to stop the bridge."

Push-Location $backendDir
try {
    & $pythonPath -m uvicorn app.main:app --host 127.0.0.1 --port $Port
} finally {
    Pop-Location
}