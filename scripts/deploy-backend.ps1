$ErrorActionPreference='Continue'
Write-Output 'PROXY DIAGNOSTICS'
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 80,443,8000 } | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress | Write-Output
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'caddy|nginx|python|uvicorn' } | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress | Write-Output
Get-Service | Where-Object { $_.Name -match 'caddy|hisbenew|nginx' -or $_.DisplayName -match 'caddy|hisbenew|nginx' } | Select-Object Name,Status | ConvertTo-Json -Compress | Write-Output
Get-ScheduledTask | Where-Object { $_.TaskName -match 'hisbenew|caddy|backend' } | Select-Object TaskName,State | ConvertTo-Json -Compress | Write-Output
Get-ChildItem C:\ -Directory | Where-Object { $_.Name -match 'caddy|hisbenew|nginx' } | Select-Object FullName | ConvertTo-Json -Compress | Write-Output
Get-ChildItem C:\caddy -File -ErrorAction SilentlyContinue | Select-Object Name,Length,LastWriteTime | ConvertTo-Json -Compress | Write-Output