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

    $service = Get-Service `
        -Name $Name `
        -ErrorAction SilentlyContinue


    if (-not $service) {

        $service = Get-Service |
            Where-Object {
                $_.DisplayName -eq $Name
            } |
            Select-Object -First 1
    }


    if ($service) {

        Restart-Service `
            -Name $service.Name `
            -Force

        return
    }


    $task = Get-ScheduledTask `
        -TaskName $Name `
        -ErrorAction SilentlyContinue


    if ($task) {

        Stop-ScheduledTask `
            -TaskName $Name `
            -ErrorAction SilentlyContinue

        Start-Sleep -Seconds 2

        Start-ScheduledTask `
            -TaskName $Name

        return
    }


    throw "Could not find service or scheduled task named '$Name'."
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

        # The GitHub Actions runner already has a clean, up-to-date checkout
        # of the repository in GITHUB_WORKSPACE. We use robocopy to mirror
        # the backend directory to the production path, which avoids all git
        # permission issues (ORIG_HEAD, ref locks, etc.) on C:\HisbenewERP.

        $runnerBackend = Join-Path $env:GITHUB_WORKSPACE "backend"

        Write-Host "Runner workspace: $runnerBackend"
        Write-Host "Production backend: $backendPath"

        # Robocopy exit codes: 0-7 are success variants, 8+ are errors.
        robocopy `
            $runnerBackend `
            $backendPath `
            /MIR `
            /XD ".venv" "venv" "__pycache__" ".git" `
            /XF "*.pyc" "*.db" "*.sqlite" `
            /R:3 /W:5 /NFL /NDL /NJH /NJS

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


            $pyLauncher = Get-Command `
                "py" `
                -ErrorAction SilentlyContinue


            if ($pyLauncher) {

                # Try Python 3.12 specifically first, then fall back to
                # whatever version the py launcher has available.
                & py -3.12 --version 2>&1 | Out-Null

                if ($LASTEXITCODE -eq 0) {

                    Invoke-CheckedCommand `
                        -FilePath "py" `
                        -Arguments @("-3.12", "-m", "venv", $venvPath)

                }
                else {

                    Write-Host "Python 3.12 not found via py launcher, using default py version."

                    Invoke-CheckedCommand `
                        -FilePath "py" `
                        -Arguments @("-m", "venv", $venvPath)
                }

            }
            else {

                Invoke-CheckedCommand `
                    -FilePath "python" `
                    -Arguments @(
                        "-m",
                        "venv",
                        $venvPath
                    )
            }
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