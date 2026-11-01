param([switch]$Start)
$ErrorActionPreference = 'Stop'

# The protocol accepts no commands, paths or server URLs from the website.
$erpProtocolKey = 'HKCU:\Software\Classes\hisbenew-printer'
$erpSavedRoot = (Get-ItemProperty -LiteralPath $erpProtocolKey -ErrorAction SilentlyContinue).ErpRoot
$erpCandidates = @($erpSavedRoot, 'D:\Factory Software\Hisbenew Industries ERP', 'C:\HisbenewERP')
$erpRoot = $erpCandidates | Where-Object {
    $_ -and (Test-Path -LiteralPath (Join-Path $_ 'print-agent\printer_agent.py')) -and
    (Test-Path -LiteralPath (Join-Path $_ 'scripts\Start-Local-Printer-Bridge.ps1'))
} | Select-Object -First 1
if (-not $erpRoot) {
    Add-Type -AssemblyName System.Windows.Forms
    $erpPicker = New-Object System.Windows.Forms.FolderBrowserDialog
    $erpPicker.Description = 'Select your installed Hisbenew ERP folder (contains backend and print-agent).'
    if ($erpPicker.ShowDialog() -ne 'OK') { exit 0 }
    $erpRoot = $erpPicker.SelectedPath
}
$erpAgentScript = Join-Path $erpRoot 'print-agent\printer_agent.py'
$erpBridgeScript = Join-Path $erpRoot 'scripts\Start-Local-Printer-Bridge.ps1'
if (-not (Test-Path -LiteralPath $erpAgentScript) -or -not (Test-Path -LiteralPath $erpBridgeScript)) {
    throw 'This folder does not contain the installed Hisbenew printer tools.'
}
$erpPython = @('backend\venv\Scripts\python.exe', 'backend\.venv\Scripts\python.exe', 'print-agent\venv\Scripts\python.exe') |
    ForEach-Object { Join-Path $erpRoot $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $erpPython) { throw 'The installed Hisbenew Python environment is missing.' }

if (-not $Start) {
    $erpInstallDir = Join-Path $env:LOCALAPPDATA 'HisbenewERP'
    New-Item -ItemType Directory -Path $erpInstallDir -Force | Out-Null
    $erpInstalledScript = Join-Path $erpInstallDir 'Printer-Connection.ps1'
    if ($PSCommandPath -ne $erpInstalledScript) { Copy-Item -LiteralPath $PSCommandPath -Destination $erpInstalledScript -Force }
    New-Item -Path "$erpProtocolKey\shell\open\command" -Force | Out-Null
    Set-Item -LiteralPath $erpProtocolKey -Value 'URL:Hisbenew printer connection'
    New-ItemProperty -LiteralPath $erpProtocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $erpProtocolKey -Name 'ErpRoot' -Value $erpRoot -PropertyType String -Force | Out-Null
    Set-Item -LiteralPath "$erpProtocolKey\shell\open\command" -Value "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$erpInstalledScript`" -Start"
}

$erpLogs = Join-Path $erpRoot 'output\printer-connection'
New-Item -ItemType Directory -Path $erpLogs -Force | Out-Null
$erpMutex = New-Object System.Threading.Mutex($false, 'Local\HisbenewPrinterConnection')
if (-not $erpMutex.WaitOne(0)) { exit 0 }
try {
    $erpAgents = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^python(w)?\.exe$' -and $_.CommandLine -and
        $_.CommandLine.IndexOf($erpAgentScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($erpAgents.Count -eq 0) {
        $env:ERP_API = 'https://api.hisbenew.com'
        $erpAgent = Start-Process -FilePath $erpPython -ArgumentList @('-u', ('"' + $erpAgentScript + '"')) -WorkingDirectory (Join-Path $erpRoot 'print-agent') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $erpLogs 'agent.out.log') -RedirectStandardError (Join-Path $erpLogs 'agent.err.log') -PassThru
        Set-Content -LiteralPath (Join-Path $erpRoot 'print-agent\agent.pid') -Value $erpAgent.Id
    }
    $erpBridgeOnline = $false
    try {
        $erpResponse = Invoke-RestMethod 'http://127.0.0.1:8000/local-label-printers' -TimeoutSec 5
        $erpBridgeOnline = $erpResponse.connection_scope -eq 'this_laptop'
    } catch {}
    if (-not $erpBridgeOnline) {
        # Never stop or replace another process occupying the bridge port.
        $erpListeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
        if ($erpListeners.Count -gt 0) { throw 'Port 8000 is occupied by another service. See printer-connection logs.' }
        $env:SKIP_DATABASE_INITIALIZATION = '1'
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"' + $erpBridgeScript + '"')) -WorkingDirectory $erpRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $erpLogs 'bridge.out.log') -RedirectStandardError (Join-Path $erpLogs 'bridge.err.log') | Out-Null
    }
    Add-Content -LiteralPath (Join-Path $erpLogs 'connection.log') -Value "$([DateTime]::UtcNow.ToString('o')) Printer connection start requested."
} catch {
    Add-Content -LiteralPath (Join-Path $erpLogs 'connection.log') -Value "$([DateTime]::UtcNow.ToString('o')) $($_.Exception.Message)"
    throw
} finally {
    $erpMutex.ReleaseMutex()
    $erpMutex.Dispose()
}
