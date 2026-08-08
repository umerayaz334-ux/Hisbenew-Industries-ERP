param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"

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