$ErrorActionPreference='Continue'
Write-Output 'CADDY REPORT'
Get-Content C:\Caddy\Caddyfile
Get-Content C:\Caddy\caddy-service.log -Tail 35
Get-CimInstance Win32_Service -Filter "Name='Caddy'" | Select-Object Name,State,StartName,PathName | ConvertTo-Json -Compress | Write-Output
curl.exe -vk --max-time 10 --resolve api.hisbenew.com:443:127.0.0.1 https://api.hisbenew.com/health 2>&1 | ForEach-Object { "$_" }