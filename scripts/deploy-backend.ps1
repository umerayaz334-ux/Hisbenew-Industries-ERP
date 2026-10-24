$ErrorActionPreference='Stop'
Write-Output 'RECOVER CADDY'
& C:\Caddy\caddy.exe validate --config C:\Caddy\Caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy configuration validation failed' }
Restart-Service -Name Caddy -Force
Start-Sleep -Seconds 5
Get-Service Caddy | Select-Object Name,Status | ConvertTo-Json -Compress | Write-Output
foreach ($u in @('http://127.0.0.1:8000/health','https://api.hisbenew.com/health')) {
  $r=Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 20
  Write-Output "$u STATUS $($r.StatusCode) $($r.Content)"
}