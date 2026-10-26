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
        Write-Host "Skipping $Label health check."
        return
    }

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {

        try {

            $response = Invoke-WebRequest `
                -Uri $Url `
                -UseBasicParsing `
                -TimeoutSec 10

            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {

                Write-Host "$Label health check passed: $Url"
                return
            }

        }
        catch {

            Write-Host "$Label health check attempt $attempt failed: $($_.Exception.Message)"
        }


        if ($attempt -lt $Attempts) {
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    throw "$Label health check failed after $Attempts attempts: $Url"
}


function Restart-Backend {
    param(
        [string]$Name
    )

    # Only an explicitly named service/task may be restarted.
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue

    if ($service) {
        Write-Host "Restarting Windows Service: $($service.Name) ($($service.DisplayName))"
        Restart-Service -Name $service.Name -Force
        return
    }

    # 2. Check exact or wildcard scheduled task match
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue

    if ($task) {
        Write-Host "Restarting Scheduled Task: $($task.TaskName)"
        Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Start-ScheduledTask -TaskName $task.TaskName
        return
    }

    # Validate every listener before stopping anything; unrelated Python jobs stay running.
        $connections = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
        if ($connections) {
            $owningPids = $connections.OwningProcess | Select-Object -Unique
            foreach ($backendProcessId in $owningPids) {
                $process = Get-CimInstance Win32_Process -Filter "ProcessId=$backendProcessId"
                $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)"
                $expectedPython = [regex]::Escape($pythonPath)
                if ($backendProcessId -le 4 -or $process.CommandLine -notmatch 'uvicorn\s+app\.main:app' -or
                    ($process.CommandLine -notmatch $expectedPython -and $parent.CommandLine -notmatch $expectedPython)) {
                    throw "Port 8000 belongs to an unverified process; refusing to stop PID $backendProcessId."
                }
            }
            foreach ($backendProcessId in $owningPids) {
                    Write-Host "Stopping process PID $backendProcessId currently listening on port 8000..."
                    Stop-Process -Id $backendProcessId -Force
            }
            Start-Sleep -Seconds 2
        }

    # 4. Start Uvicorn process via WMI so it's a top-level process independent of runner tree
    Write-Host "Launching persistent Uvicorn backend process..."
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = "`"$pythonPath`" -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
        CurrentDirectory = $backendPath
        ProcessStartupInformation = $startup
    }
    if ($created.ReturnValue -ne 0) { throw "Backend launch failed: $($created.ReturnValue)" }
    Start-Sleep -Seconds 5
}



$repoRoot = Get-Setting `
    -Name "ERP_ROOT" `
    -Default "C:\HisbenewERP"


$backendPath = Join-Path `
    $repoRoot `
    "backend"


$serviceName = Get-Setting `
    -Name "ERP_BACKEND_SERVICE_NAME" `
    -Default "Hisbenew ERP Backend"


$localHealthUrl = Get-Setting `
    -Name "ERP_BACKEND_HEALTH_URL" `
    -Default "http://127.0.0.1:8000/health"


$publicHealthUrl = Get-Setting `
    -Name "ERP_PUBLIC_API_HEALTH_URL" `
    -Default "https://api.hisbenew.com/health"


$venvOverride = Get-Setting `
    -Name "ERP_BACKEND_VENV" `
    -Default ""


if ($venvOverride) {

    $venvPath = $venvOverride

}
elseif (Test-Path (Join-Path $backendPath "venv\Scripts\python.exe")) {

    $venvPath = Join-Path $backendPath "venv"

}
else {

    $venvPath = Join-Path $backendPath ".venv"
}


$pythonPath = Join-Path `
    $venvPath `
    "Scripts\python.exe"


$requirementsPath = Join-Path `
    $backendPath `
    "requirements.txt"


Write-Host "Repository path: $repoRoot"
Write-Host "Backend path: $backendPath"
Write-Host "Virtual environment: $venvPath"
Write-Host "Restart target: $serviceName"
Write-Host "Local health URL: $localHealthUrl"
Write-Host "Public health URL: $publicHealthUrl"

if ($env:ERP_INSPECT_ONLY -eq 'true' -or $env:GITHUB_REF_NAME -like 'codex/inspect-*') {
    Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$_"
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)"
            Write-Host "Backend PID: $($proc.ProcessId), executable: $($proc.ExecutablePath)"
            Write-Host "Backend launcher: $($parent.ExecutablePath)"
            Write-Host "Uvicorn command verified: $($proc.CommandLine -match 'uvicorn\s+app\.main:app')"
        }
    foreach ($setting in @('GOOGLE_APPLICATION_CREDENTIALS', 'INTERNAL_CALL_ICE_SERVERS', 'DATABASE_URL', 'APP_DATA_DIR')) {
        foreach ($scope in @('Process', 'Machine', 'User')) {
            $configured = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($setting, $scope))
            Write-Host "${setting} ${scope} configured: $configured"
        }
    }
    foreach ($folder in @($backendPath, (Join-Path $repoRoot 'mobile\android\app'))) {
        if (Test-Path -LiteralPath $folder) {
            Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match 'google-services|firebase|service.account' } |
                ForEach-Object { Write-Host "Push configuration file: $($_.FullName)" }
        }
    }
    Write-Host 'Inspection complete. No server files or services changed.'
    exit 0
}

Invoke-Step -Message 'Back up backend source and SQLite data before deployment' -Action {
    $backupScript = Join-Path $env:GITHUB_WORKSPACE 'scripts\backup_backend.py'
    Invoke-CheckedCommand -FilePath $pythonPath -Arguments @($backupScript, $backendPath)
}



Invoke-Step `
    -Message "Sync backend code from runner workspace" `
    -Action {

        # Ensure destination directory exists and permissions allow access
        if (-not (Test-Path $backendPath)) {
            New-Item -ItemType Directory -Force -Path $backendPath | Out-Null
        }


        $runnerBackend = Join-Path $env:GITHUB_WORKSPACE "backend"

        Write-Host "Runner workspace: $runnerBackend"
        Write-Host "Production backend: $backendPath"

        # Robocopy exit codes: 0-7 are success variants, 8+ are errors.
        # Use /E instead of /MIR to avoid deletion locks on destination root
        robocopy `
            $runnerBackend `
            $backendPath `
            /E `
            /XD ".venv" "venv" "__pycache__" ".git" "static" "uploads" "optimized" `
            /XF "*.pyc" "*.db*" "*.sqlite*" ".env*" ".secret_key" ".turn-*" "email_settings*.json" "*service-account*.json" "*firebase-adminsdk*.json" `
            /R:1 /W:2 /NFL /NDL /NJH /NJS

        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed with exit code $LASTEXITCODE"
        }

        Write-Host "Backend code synced successfully."
    }


Invoke-Step `
    -Message "Ensure backend virtual environment exists" `
    -Action {

        if (-not (Test-Path $pythonPath)) {

            $venvParent = Split-Path -Parent $venvPath

            if (-not (Test-Path $venvParent)) {
                New-Item `
                    -ItemType Directory `
                    -Force `
                    -Path $venvParent | Out-Null
            }

            # Detect a working Python executable
            $systemPy = $null
            
            # Check python directly first
            $pythonCmd = Get-Command "python" -ErrorAction SilentlyContinue
            if ($pythonCmd) {
                & python -c "import sys" 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $systemPy = "python"
                }
            }

            # Check py launcher
            if (-not $systemPy) {
                $pyCmd = Get-Command "py" -ErrorAction SilentlyContinue
                if ($pyCmd) {
                    & py -c "import sys" 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) {
                        $systemPy = "py"
                    }
                }
            }

            # Check standard Python install locations on Windows
            if (-not $systemPy) {
                $candidatePaths = @(
                    "C:\Python312\python.exe",
                    "C:\Python311\python.exe",
                    "C:\Program Files\Python312\python.exe",
                    "C:\Program Files\Python311\python.exe",
                    "$env:LocalAppData\Programs\Python\Python312\python.exe",
                    "$env:LocalAppData\Programs\Python\Python311\python.exe"
                )
                foreach ($candidate in $candidatePaths) {
                    if (Test-Path $candidate) {
                        $systemPy = $candidate
                        break
                    }
                }
            }

            if (-not $systemPy) {
                throw "No working Python executable found on the system to create virtual environment."
            }

            Write-Host "Using Python executable: $systemPy"

            Invoke-CheckedCommand `
                -FilePath $systemPy `
                -Arguments @(
                    "-m",
                    "venv",
                    $venvPath
                )
        }
    }



Invoke-Step `
    -Message "Install backend dependencies" `
    -Action {

        Invoke-CheckedCommand `
            -FilePath $pythonPath `
            -Arguments @(
                "-m",
                "pip",
                "install",
                "-r",
                $requirementsPath
            )
    }



Invoke-Step `
    -Message "Apply database migrations and tenant seeds" `
    -Action {

        Push-Location $backendPath

        try {

            $seedCommand = @"
from app.database import Base, engine, migrate_database, ensure_scaling_indexes
from app.main import ensure_default_admin, ensure_default_modules

Base.metadata.create_all(bind=engine)
migrate_database()
ensure_scaling_indexes()
ensure_default_admin()
ensure_default_modules()

print('Database migrations and tenant seeds applied.')
"@


            Invoke-CheckedCommand `
                -FilePath $pythonPath `
                -Arguments @(
                    "-c",
                    $seedCommand
                )

        }
        finally {

            Pop-Location
        }
    }



Invoke-Step `
    -Message "Restart backend" `
    -Action {

        $relayInstaller = Join-Path $env:GITHUB_WORKSPACE 'scripts\install-call-relay.ps1'
        if (Test-Path -LiteralPath $relayInstaller) {
            $relayDirectory = Join-Path $repoRoot 'call-relay'
            New-Item -ItemType Directory -Force -Path $relayDirectory | Out-Null
            Copy-Item -LiteralPath $relayInstaller -Destination (Join-Path $relayDirectory 'install.ps1') -Force
            & $relayInstaller -BackendPath $backendPath
        }

        Restart-Backend `
            -Name $serviceName
    }



Invoke-Step `
    -Message "Verify local backend health" `
    -Action {

        Wait-ForHttpOk `
            -Url $localHealthUrl `
            -Label "Local backend"
    }



Invoke-Step `
    -Message "Verify public API health" `
    -Action {

        Wait-ForHttpOk `
            -Url $publicHealthUrl `
            -Label "Public API"
    }



Write-Host ""
Write-Host "Backend deployment completed successfully."
