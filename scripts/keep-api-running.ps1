# Invoked by the dedicated API recovery task. Never stop an existing listener.
$ErrorActionPreference = 'Stop'
$erpBackend = 'C:\HisbenewERP\backend'
$erpPython = Join-Path $erpBackend '.venv\Scripts\python.exe'
$erpLogs = 'C:\HisbenewERP\operations'
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
if (-not (Test-Path -LiteralPath $erpPython)) { throw 'Verified backend Python executable is missing.' }
$erpStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
foreach ($erpLogName in @('api.out.log','api.err.log')) {
    $erpExistingLog = Join-Path $erpLogs $erpLogName
    if (Test-Path -LiteralPath $erpExistingLog) {
        Copy-Item -LiteralPath $erpExistingLog -Destination (Join-Path $erpLogs "$erpStamp-$erpLogName")
    }
}
Add-Content -LiteralPath (Join-Path $erpLogs 'recovery.log') -Value "$([DateTime]::UtcNow.ToString('o')) Starting missing API process."
$erpChild = Start-Process -FilePath $erpPython -ArgumentList @('-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8000') -WorkingDirectory $erpBackend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $erpLogs 'api.out.log') -RedirectStandardError (Join-Path $erpLogs 'api.err.log') -Wait -PassThru
Add-Content -LiteralPath (Join-Path $erpLogs 'recovery.log') -Value "$([DateTime]::UtcNow.ToString('o')) API exited with code $($erpChild.ExitCode)."
exit $erpChild.ExitCode
