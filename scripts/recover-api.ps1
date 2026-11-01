$ErrorActionPreference = 'Stop'
$erpBackend = 'C:\HisbenewERP\backend'
$erpPython = Join-Path $erpBackend '.venv\Scripts\python.exe'
$erpOperations = 'C:\HisbenewERP\operations'
New-Item -ItemType Directory -Path $erpOperations -Force | Out-Null
foreach ($erpLogName in @('api.err.log', 'recovery.log')) {
    $erpLogPath = Join-Path $erpOperations $erpLogName
    if (Test-Path -LiteralPath $erpLogPath) {
        Write-Output "Recent ${erpLogName}:"
        Get-Content -LiteralPath $erpLogPath -Tail 40
    }
}
Write-Output ('Server boot: ' + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime)
Get-Service | Where-Object { $_.Name -match 'Hisbenew|uvicorn|nginx|caddy' } | Select-Object Name,Status,StartType | Format-Table
Get-ScheduledTask | Where-Object { $_.TaskName -match 'Hisbenew|ERP|backend' } | Select-Object TaskName,State | Format-Table
$erpListeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
Write-Output "API listener count: $($erpListeners.Count)"
foreach ($erpListener in $erpListeners) {
    $erpProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($erpListener.OwningProcess)"
    Write-Output "API process: $($erpProcess.ProcessId); executable: $($erpProcess.ExecutablePath); started: $($erpProcess.CreationDate)"
}
$erpHealthy = $false
try { $erpHealth = Invoke-WebRequest 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 8; $erpHealthy = $erpHealth.StatusCode -eq 200 } catch { Write-Output 'Local API health failed.' }
if (-not $erpHealthy -and $erpListeners.Count -gt 0) {
    # Confirm the failure twice before replacing only the verified ERP listener.
    try { $erpHealth = Invoke-WebRequest 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 12; $erpHealthy = $erpHealth.StatusCode -eq 200 } catch { Write-Output 'Second local API health check failed.' }
    if (-not $erpHealthy) {
        $erpOwningPids = @($erpListeners.OwningProcess | Select-Object -Unique)
        foreach ($erpApiPid in $erpOwningPids) {
            $erpProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$erpApiPid"
            $erpParent = Get-CimInstance Win32_Process -Filter "ProcessId=$($erpProcess.ParentProcessId)"
            $erpExpectedPython = [regex]::Escape($erpPython)
            if ($erpApiPid -le 4 -or $erpProcess.CommandLine -notmatch 'uvicorn\s+app\.main:app' -or
                ($erpProcess.CommandLine -notmatch $erpExpectedPython -and $erpParent.CommandLine -notmatch $erpExpectedPython)) {
                throw "Unhealthy listener PID $erpApiPid is not a verified ERP API; refusing to stop it."
            }
        }
        foreach ($erpApiPid in $erpOwningPids) {
            Write-Output "Stopping verified unresponsive ERP API PID $erpApiPid."
            Stop-Process -Id $erpApiPid -Force
        }
        Start-Sleep -Seconds 2
        $erpListeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
        if ($erpListeners.Count -gt 0) { throw 'Port 8000 is still occupied; refusing a duplicate API launch.' }
    }
}
if (-not $erpHealthy -and $erpListeners.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $erpPython)) { throw 'Expected live Python executable missing.' }
    # A persistent API must not inherit the Actions job's orphan-process marker.
    $erpTrackingId = $env:RUNNER_TRACKING_ID
    try {
        $env:RUNNER_TRACKING_ID = ''
        $erpCreated = Start-Process -FilePath $erpPython -ArgumentList @('-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8000') -WorkingDirectory $erpBackend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $erpOperations 'api.out.log') -RedirectStandardError (Join-Path $erpOperations 'api.err.log') -PassThru
    } finally {
        $env:RUNNER_TRACKING_ID = $erpTrackingId
    }
    Write-Output "Restored missing API process: $($erpCreated.Id)"
}
for ($erpAttempt = 0; $erpAttempt -lt 12; $erpAttempt++) {
    try {
        $erpHealth = Invoke-WebRequest 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 3
        if ($erpHealth.StatusCode -eq 200) { Write-Output 'Local API recovered: HTTP 200'; break }
    } catch { if ($erpAttempt -eq 11) { throw 'Local API remains unavailable.' }; Start-Sleep -Seconds 2 }
}
$erpPublic = Invoke-WebRequest 'https://api.hisbenew.com/health' -UseBasicParsing -TimeoutSec 15
Write-Output "Public API health: HTTP $($erpPublic.StatusCode)"
