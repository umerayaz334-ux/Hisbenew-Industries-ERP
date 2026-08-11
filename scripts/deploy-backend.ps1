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

    # 1. Check exact or wildcard service match (exclude runner service itself!)
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
        $service = Get-Service | Where-Object { 
            $_.Name -notlike "*actions.runner*" -and
            $_.DisplayName -notlike "*Actions Runner*" -and
            ($_.DisplayName -eq $Name -or 
             $_.Name -like "*hisbenew*" -or 
             $_.DisplayName -like "*hisbenew*" -or
             $_.Name -like "*backend*" -or
             $_.DisplayName -like "*backend*")
        } | Select-Object -First 1
    }

    if ($service) {
        Write-Host "Restarting Windows Service: $($service.Name) ($($service.DisplayName))"
        Restart-Service -Name $service.Name -Force
        return
    }

    # 2. Check exact or wildcard scheduled task match
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $task) {
        $task = Get-ScheduledTask | Where-Object { 
            $_.TaskName -notlike "*actions.runner*" -and
            ($_.TaskName -like "*hisbenew*" -or $_.TaskName -like "*erp*" -or $_.TaskName -like "*backend*")
        } | Select-Object -First 1
    }

    if ($task) {
        Write-Host "Restarting Scheduled Task: $($task.TaskName)"
        Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Start-ScheduledTask -TaskName $task.TaskName
        return
    }

    # 3. Check for running python uvicorn backend processes and restart if needed
    $pyProcesses = Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { 
        $_.CommandLine -like "*main:app*" -or $_.CommandLine -like "*uvicorn*" 
    }

    if ($pyProcesses) {
        Write-Host "Stopping existing Python backend process(es)..."
        $pyProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    # 4. Start Uvicorn process directly in background
    Write-Host "Launching Uvicorn backend process directly..."
    Start-Process -FilePath $pythonPath -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port 8000" -WorkingDirectory $backendPath -WindowStyle Hidden
    Start-Sleep -Seconds 3
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



Invoke-Step `
    -Message "Sync backend code from runner workspace" `
    -Action {

        # Ensure destination directory exists and permissions allow access
        if (-not (Test-Path $backendPath)) {
            New-Item -ItemType Directory -Force -Path $backendPath | Out-Null
        }

        # Grant access to destination if needed (ignore errors if runner lacks privilege)
        try {
            cmd /c "icacls `"$repoRoot`" /grant Users:(OI)(CI)F /T /C /Q 2>&1" | Out-Null
        } catch {}

        $runnerBackend = Join-Path $env:GITHUB_WORKSPACE "backend"

        Write-Host "Runner workspace: $runnerBackend"
        Write-Host "Production backend: $backendPath"

        # Robocopy exit codes: 0-7 are success variants, 8+ are errors.
        # Use /E instead of /MIR to avoid deletion locks on destination root
        robocopy `
            $runnerBackend `
            $backendPath `
            /E `
            /XD ".venv" "venv" "__pycache__" ".git" `
            /XF "*.pyc" "*.db" "*.sqlite" `
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