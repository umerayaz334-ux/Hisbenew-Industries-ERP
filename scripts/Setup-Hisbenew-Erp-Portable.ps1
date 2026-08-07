param(
    [switch]$SkipFrontend,
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$portableDir = Join-Path $projectRoot "tmp\portable"

$tempDir = Join-Path $portableDir "temp"
$npmCache = Join-Path $portableDir "npm-cache"
$pipCache = Join-Path $portableDir "pip-cache"
$pythonCache = Join-Path $portableDir "python-cache"

foreach ($path in @($tempDir, $npmCache, $pipCache, $pythonCache)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

$env:TEMP = $tempDir
$env:TMP = $tempDir
$env:NPM_CONFIG_CACHE = $npmCache
$env:PIP_CACHE_DIR = $pipCache
$env:PYTHONPYCACHEPREFIX = $pythonCache
$env:APP_DATA_DIR = $backendDir
$env:STATIC_DIR = Join-Path $backendDir "static"
$env:FRONTEND_DIST_DIR = Join-Path $frontendDir "dist"
$env:DATABASE_URL = "sqlite:///$(($backendDir + '\hisbenew_industries.db').Replace('\', '/'))"

if (-not $SkipBackend) {
    $python = (Get-Command python -ErrorAction Stop).Source
    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $venvPython)) {
        & $python -m venv (Join-Path $backendDir "venv")
    }
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
}

if (-not $SkipFrontend) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) {
        $npm = (Get-Command npm -ErrorAction Stop).Source
    }
    & $npm install --prefix $frontendDir
}

"Portable setup complete. Start ERP with Start-Hisbenew-Erp-Mobile.cmd."
