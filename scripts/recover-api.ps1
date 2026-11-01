$ErrorActionPreference = 'Stop'
$erpBackend = 'C:\HisbenewERP\backend'
$erpPython = Join-Path $erpBackend '.venv\Scripts\python.exe'
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
if (-not $erpHealthy -and $erpListeners.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $erpPython)) { throw 'Expected live Python executable missing.' }
    $erpStartup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $erpCreated = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = "`"$erpPython`" -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
        CurrentDirectory = $erpBackend
        ProcessStartupInformation = $erpStartup
    }
    if ($erpCreated.ReturnValue -ne 0) { throw "API launch failed: $($erpCreated.ReturnValue)" }
    Write-Output "Restored missing API process: $($erpCreated.ProcessId)"
}
for ($erpAttempt = 0; $erpAttempt -lt 12; $erpAttempt++) {
    try {
        $erpHealth = Invoke-WebRequest 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 3
        if ($erpHealth.StatusCode -eq 200) { Write-Output 'Local API recovered: HTTP 200'; break }
    } catch { if ($erpAttempt -eq 11) { throw 'Local API remains unavailable.' }; Start-Sleep -Seconds 2 }
}
$erpPublic = Invoke-WebRequest 'https://api.hisbenew.com/health' -UseBasicParsing -TimeoutSec 15
Write-Output "Public API health: HTTP $($erpPublic.StatusCode)"
