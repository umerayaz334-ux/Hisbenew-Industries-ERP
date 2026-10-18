param([Parameter(Mandatory=$true)][string]$BackendPath)
$ErrorActionPreference = 'Stop'
$relayRoot = Join-Path (Split-Path -Parent $BackendPath) 'call-relay'
$binary = Join-Path $relayRoot 'hisbenew-turn.exe'
$expectedHash = 'F7EE8114606EF838D40A82DD7D557209D254D043A6DA95E0A81F8F9CF4E7134C'
$releaseUrl = 'https://github.com/umerayaz334-ux/Hisbenew-Industries-ERP/releases/download/turn-v1-20261018/hisbenew-turn.exe'
$taskName = 'Hisbenew Call Relay'
$secretPath = Join-Path $BackendPath '.turn-secret'
$hostPath = Join-Path $BackendPath '.turn-host'
$publicIP = (Resolve-DnsName api.hisbenew.com -Type A | Where-Object Type -eq 'A' | Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $publicIP) { throw 'Unable to resolve the verified API host' }
New-Item -ItemType Directory -Force -Path $relayRoot | Out-Null
# Only the service and administrators may access its executable/configuration.
& icacls.exe $relayRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Relay directory permissions could not be applied' }
if (-not (Test-Path -LiteralPath $secretPath)) {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [IO.File]::WriteAllText($secretPath, [Convert]::ToBase64String($bytes))
}
& icacls.exe $secretPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-19:R' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Relay secret permissions could not be applied' }
$downloadRequired = -not (Test-Path -LiteralPath $binary)
if (-not $downloadRequired) { $downloadRequired = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -ne $expectedHash }
if ($downloadRequired) {
    $download = Join-Path $relayRoot 'hisbenew-turn.download'
    Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $download -TimeoutSec 60
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Relay download checksum mismatch' }
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) { Stop-ScheduledTask -TaskName $taskName; Start-Sleep -Seconds 2 }
    Copy-Item -LiteralPath $download -Destination $binary -Force
}
foreach ($rule in @(
    @{Name='Hisbenew TURN UDP';Protocol='UDP';Port='3478'},
    @{Name='Hisbenew TURN TCP';Protocol='TCP';Port='3478'},
    @{Name='Hisbenew TURN media';Protocol='UDP';Port='50000-50199'}
)) {
    if (-not (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Program $binary -Protocol $rule.Protocol -LocalPort $rule.Port | Out-Null
    }
}
$arguments = "-public-ip $publicIP -secret-file `"$secretPath`""
$action = New-ScheduledTaskAction -Execute $binary -Argument $arguments -WorkingDirectory $relayRoot
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
& $binary -public-ip $publicIP -secret-file $secretPath -check
if ($LASTEXITCODE -ne 0) { throw 'Relay verification failed; API configuration was not activated' }
[IO.File]::WriteAllText($hostPath, 'api.hisbenew.com')
Write-Host 'Dedicated relay verified over UDP and TCP; short-lived API credentials enabled.'
