$ErrorActionPreference = 'Stop'
$erpOperations = 'C:\HisbenewERP\operations'
$erpTaskName = 'Hisbenew ERP API Recovery'
$erpIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (Get-ScheduledTask -TaskName $erpTaskName -ErrorAction SilentlyContinue) { throw 'Recovery task already exists; inspect before replacing.' }
New-Item -ItemType Directory -Path $erpOperations -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'keep-api-running.ps1') -Destination (Join-Path $erpOperations 'keep-api-running.ps1') -Force
$erpAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -File "C:\HisbenewERP\operations\keep-api-running.ps1"' -WorkingDirectory 'C:\HisbenewERP\backend'
$erpTriggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$erpSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
if ($erpIdentity -in @('NT AUTHORITY\SYSTEM','NT AUTHORITY\LOCAL SERVICE','NT AUTHORITY\NETWORK SERVICE')) {
    $erpPrincipal = New-ScheduledTaskPrincipal -UserId $erpIdentity -LogonType ServiceAccount -RunLevel Highest
} else {
    $erpPrincipal = New-ScheduledTaskPrincipal -UserId $erpIdentity -LogonType S4U -RunLevel Highest
}
Register-ScheduledTask -TaskName $erpTaskName -Action $erpAction -Trigger $erpTriggers -Settings $erpSettings -Principal $erpPrincipal -Description 'Recover only a missing Hisbenew ERP API process; retain backend startup and exit logs.' | Out-Null
Write-Output 'Installed API recovery: startup trigger, one-minute checks, existing server account, no stored password.'
Get-ScheduledTask -TaskName $erpTaskName | Select-Object TaskName,State | Format-Table
