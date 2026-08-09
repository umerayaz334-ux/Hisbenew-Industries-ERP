param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-Setting {
  param(
    [string]$Name,
    [string]$Default
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }

  return $value
}

function Invoke-Step {
  param(
    [string]$Message,
    [scriptblock]$Action
  )

  Write-Host ""
  Write-Host "==> $Message"
  if ($DryRun) {
    Write-Host "DRY RUN: skipped"
    return
  }

  & $Action
}

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Host "$FilePath $($Arguments -join ' ')"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Wait-ForHttpOk {
  param(
    [string]$Url,
    [string]$Label,
    [int]$Attempts = 12,
    [int]$DelaySeconds = 5
  )

  if ([string]::IsNullOrWhiteSpace($Url)) {
    Write-Host "Skipping $Label health check because no URL is configured."
    return
  }

  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        Write-Host "$Label health check passed: $Url"
        return
      }
    } catch {
      Write-Host "$Label health check attempt $attempt failed: $($_.Exception.Message)"
    }

    if ($attempt -lt $Attempts) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  throw "$Label health check failed after $Attempts attempts: $Url"
}

function Restart-Backend {
  param([string]$Name)

  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service) {
    $service = Get-Service | Where-Object { $_.DisplayName -eq $Name } | Select-Object -First 1
  }
  if ($service) {
    Restart-Service -Name $service.Name -Force
    return
  }

  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $Name
    return
  }

  throw "Could not find a Windows service or scheduled task named '$Name'."
}

$repoRoot = Get-Setting -Name "ERP_ROOT" -Default "C:\HisbenewERP"
$backendPath = Join-Path $repoRoot "backend"
$serviceName = Get-Setting -Name "ERP_BACKEND_SERVICE_NAME" -Default "Hisbenew ERP Backend"
$localHealthUrl = Get-Setting -Name "ERP_BACKEND_HEALTH_URL" -Default "http://127.0.0.1:8000/health"
$publicHealthUrl = Get-Setting -Name "ERP_PUBLIC_API_HEALTH_URL" -Default "https://api.hisbenew.com/health"

$venvOverride = Get-Setting -Name "ERP_BACKEND_VENV" -Default ""
if ($venvOverride) {
  $venvPath = $venvOverride
} elseif (Test-Path (Join-Path $backendPath "venv\Scripts\python.exe")) {
  $venvPath = Join-Path $backendPath "venv"
} else {
  $venvPath = Join-Path $backendPath ".venv"
}

$pythonPath = Join-Path $venvPath "Scripts\python.exe"
$requirementsPath = Join-Path $backendPath "requirements.txt"

Write-Host "Repository path: $repoRoot"
Write-Host "Backend path: $backendPath"
Write-Host "Virtual environment: $venvPath"
Write-Host "Restart target: $serviceName"
Write-Host "Local health URL: $localHealthUrl"
Write-Host "Public health URL: $publicHealthUrl"

if ($DryRun) {
  Write-Host "Dry run enabled; commands will be described but not executed."
} else {
  if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
    throw "ERP_ROOT must point to a Git clone. Missing .git at $repoRoot"
  }
  if (-not (Test-Path $requirementsPath)) {
    throw "Missing backend requirements file at $requirementsPath"
  }
}

Invoke-Step -Message "Pull latest main branch" -Action {
  Push-Location $repoRoot
  try {
    $dirtyTrackedFiles = git status --porcelain --untracked-files=no
    if ($dirtyTrackedFiles) {
      Write-Host $dirtyTrackedFiles
      throw "Production checkout has tracked local changes. Commit, stash, or remove them before deploying."
    }

    Invoke-CheckedCommand -FilePath "git" -Arguments @("fetch", "origin", "main", "--prune")
    $branch = git branch --show-current
    if ($branch -ne "main") {
      Invoke-CheckedCommand -FilePath "git" -Arguments @("checkout", "main")
    }
    Invoke-CheckedCommand -FilePath "git" -Arguments @("pull", "--ff-only", "origin", "main")
  } finally {
    Pop-Location
  }
}

Invoke-Step -Message "Ensure backend virtual environment exists" -Action {
  if (-not (Test-Path $pythonPath)) {
    $venvParent = Split-Path -Parent $venvPath
    if (-not (Test-Path $venvParent)) {
      New-Item -ItemType Directory -Force -Path $venvParent | Out-Null
    }

    $pyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($pyLauncher) {
      Invoke-CheckedCommand -FilePath "py" -Arguments @("-3.12", "-m", "venv", $venvPath)
    } else {
      Invoke-CheckedCommand -FilePath "python" -Arguments @("-m", "venv", $venvPath)
    }
  }
}

Invoke-Step -Message "Install backend dependencies" -Action {
  Invoke-CheckedCommand -FilePath $pythonPath -Arguments @("-m", "pip", "install", "-r", $requirementsPath)
}

Invoke-Step -Message "Apply database migrations and tenant seeds" -Action {
  Push-Location $backendPath
  try {
    $seedCommand = "from app.database import Base, engine, migrate_database, ensure_scaling_indexes; from app.main import ensure_default_admin, ensure_default_modules; Base.metadata.create_all(bind=engine); migrate_database(); ensure_scaling_indexes(); ensure_default_admin(); ensure_default_modules(); print('Database migrations and tenant seeds applied.')"
    Invoke-CheckedCommand -FilePath $pythonPath -Arguments @("-c", $seedCommand)
  } finally {
    Pop-Location
  }
}

Invoke-Step -Message "Restart backend" -Action {
  Restart-Backend -Name $serviceName
}

Invoke-Step -Message "Verify local backend health" -Action {
  Wait-ForHttpOk -Url $localHealthUrl -Label "Local backend"
}

Invoke-Step -Message "Verify public API health" -Action {
  Wait-ForHttpOk -Url $publicHealthUrl -Label "Public API"
}

Write-Host ""
Write-Host "Backend deployment completed successfully."
