$ErrorActionPreference='Continue'
Write-Output 'DIAGNOSTIC ONLY'
Get-CimInstance Win32_OperatingSystem | Select-Object LastBootUpTime,FreePhysicalMemory
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 80,443,8000 } | Select-Object LocalAddress,LocalPort,OwningProcess
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'caddy|nginx|python|uvicorn' } | Select-Object ProcessId,Name,ExecutablePath
Get-Service | Where-Object { $_.Name -match 'caddy|hisbenew|nginx' -or $_.DisplayName -match 'caddy|hisbenew|nginx' } | Select-Object Name,Status
Get-ScheduledTask | Where-Object { $_.TaskName -match 'hisbenew|caddy|backend' } | Select-Object TaskName,State
foreach($u in @('http://127.0.0.1:8000/health','https://api.hisbenew.com/health')) { try { $r=Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 10; Write-Output "$u STATUS $($r.StatusCode) $($r.Content)" } catch { Write-Output "$u ERROR $($_.Exception.Message)" } }
Get-ChildItem C:\ -Directory | Where-Object { $_.Name -match 'caddy|hisbenew|nginx' } | Select-Object FullName