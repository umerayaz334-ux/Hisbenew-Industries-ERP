param(
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$logDir = Join-Path $projectRoot "tmp\startup"
$portableDir = Join-Path $projectRoot "tmp\portable"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Initialize-PortableEnvironment {
    $paths = @{
        Temp = Join-Path $portableDir "temp"
        NpmCache = Join-Path $portableDir "npm-cache"
        PipCache = Join-Path $portableDir "pip-cache"
        PythonCache = Join-Path $portableDir "python-cache"
        PowerShellCache = Join-Path $portableDir "powershell\ModuleAnalysisCache"
        MatplotlibCache = Join-Path $portableDir "matplotlib"
        XdgCache = Join-Path $portableDir "xdg-cache"
    }

    foreach ($path in $paths.Values) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
    }

    $dbPath = (Join-Path $backendDir "hisbenew_industries.db").Replace("\", "/")

    $env:APP_DATA_DIR = $backendDir
    $env:STATIC_DIR = Join-Path $backendDir "static"
    $env:FRONTEND_DIST_DIR = Join-Path $frontendDir "dist"
    $env:DATABASE_URL = "sqlite:///$dbPath"

    $env:TEMP = $paths.Temp
    $env:TMP = $paths.Temp
    $env:NPM_CONFIG_CACHE = $paths.NpmCache
    $env:PIP_CACHE_DIR = $paths.PipCache
    $env:PYTHONPYCACHEPREFIX = $paths.PythonCache
    $env:PSModuleAnalysisCachePath = $paths.PowerShellCache
    $env:MPLCONFIGDIR = $paths.MatplotlibCache
    $env:XDG_CACHE_HOME = $paths.XdgCache

    return $paths
}

$portablePaths = Initialize-PortableEnvironment

function Get-LanIPv4 {
    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.PrefixOrigin -ne "WellKnown"
            } |
            Sort-Object InterfaceMetric, InterfaceIndex

        $preferred = $addresses | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" } | Select-Object -First 1
        if ($preferred) {
            return $preferred.IPAddress
        }

        $fallback = $addresses | Select-Object -First 1
        if ($fallback) {
            return $fallback.IPAddress
        }
    } catch {
        try {
            $hostEntry = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName())
            $candidate = $hostEntry.AddressList |
                Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.IPAddressToString -notlike "127.*" } |
                Select-Object -First 1
            if ($candidate) {
                return $candidate.IPAddressToString
            }
        } catch {
            return $null
        }
    }

    return $null
}

function Initialize-MobileHttps {
    param([string]$LanIp)

    if (-not $LanIp) {
        return $null
    }

    $httpsDir = Join-Path $portableDir "mobile-https"
    $publicCertificatePath = Join-Path $backendDir "static\hisbenew-erp-mobile.cer"
    $certificateKey = $LanIp.Replace(".", "-")
    $pfxPath = Join-Path $httpsDir "hisbenew-erp-$certificateKey.pfx"
    $passwordPath = Join-Path $httpsDir "hisbenew-erp-$certificateKey.password"

    New-Item -ItemType Directory -Force -Path $httpsDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $publicCertificatePath) | Out-Null

    if (
        -not (Test-Path -LiteralPath $pfxPath) -or
        -not (Test-Path -LiteralPath $passwordPath) -or
        -not (Test-Path -LiteralPath $publicCertificatePath)
    ) {
        $computerName = [System.Net.Dns]::GetHostName()
        $friendlyName = "Hisbenew ERP Mobile HTTPS ($LanIp)"
        $textExtensions = @(
            "2.5.29.19={critical}{text}ca=true&pathlength=0",
            "2.5.29.17={text}ipaddress=$LanIp&dns=$computerName&dns=localhost",
            "2.5.29.37={text}1.3.6.1.5.5.7.3.1"
        )
        $certificate = New-SelfSignedCertificate `
            -Type Custom `
            -Subject "CN=Hisbenew ERP Local" `
            -FriendlyName $friendlyName `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -KeyExportPolicy Exportable `
            -KeyUsage DigitalSignature, KeyEncipherment, CertSign `
            -NotAfter (Get-Date).AddYears(5) `
            -TextExtension $textExtensions

        $passwordText = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
        $securePassword = ConvertTo-SecureString -String $passwordText -AsPlainText -Force
        Export-PfxCertificate `
            -Cert $certificate `
            -FilePath $pfxPath `
            -Password $securePassword `
            -Force | Out-Null
        Export-Certificate `
            -Cert $certificate `
            -FilePath $publicCertificatePath `
            -Type CERT `
            -Force | Out-Null
        Set-Content -LiteralPath $passwordPath -Value $passwordText -Encoding ASCII -NoNewline
    }

    return @{
        PfxPath = $pfxPath
        Password = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
        PublicCertificatePath = $publicCertificatePath
    }
}

function Get-ListenerProcessId {
    param([int]$Port)

    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($connection) {
            return [int]$connection.OwningProcess
        }
    } catch {
        # Fall back to netstat below.
    }

    $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    $line = (& netstat -ano) | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if ($line -and $line -match $pattern) {
        return [int]$Matches[1]
    }

    return $null
}

function Wait-Listener {
    param(
        [int]$Port,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $processId = Get-ListenerProcessId -Port $Port
        if ($processId) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Stop-ErpListener {
    param(
        [int]$Port,
        [string]$Pattern
    )

    $processId = Get-ListenerProcessId -Port $Port
    if (-not $processId) {
        return
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -match $Pattern) {
        Stop-Process -Id $processId -Force
        $deadline = (Get-Date).AddSeconds(10)
        do {
            Start-Sleep -Milliseconds 300
            $stillListening = Get-ListenerProcessId -Port $Port
            if (-not $stillListening) {
                return
            }
        } while ((Get-Date) -lt $deadline)

        throw "Port $Port is still in use after stopping process $processId."
    }
}

function Start-Backend {
    $existing = Get-ListenerProcessId -Port 8000
    if ($existing) {
        return
    }

    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
    $python = $venvPython
    if (Test-Path -LiteralPath $venvPython) {
        try {
            & $venvPython --version *> $null
        } catch {
            $python = $null
        }
    } else {
        $python = $null
    }

    if (-not $python) {
        $python = (Get-Command python -ErrorAction Stop).Source
    }

    Start-Process `
        -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000") `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "backend.out.log") `
        -RedirectStandardError (Join-Path $logDir "backend.err.log")
}

function Start-Frontend {
    $existing = Get-ListenerProcessId -Port 5173
    if ($existing) {
        return
    }

    $node = (Get-Command node -ErrorAction Stop).Source
    $viteScript = Join-Path $frontendDir "node_modules\vite\bin\vite.js"
    if (-not (Test-Path -LiteralPath $viteScript)) {
        throw "Frontend dependencies are missing. Run scripts\Setup-Hisbenew-Erp-Portable.ps1 once, then start again."
    }

    Start-Process `
        -FilePath $node `
        -ArgumentList @("node_modules\vite\bin\vite.js", "--host", "0.0.0.0", "--port", "5173") `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "frontend.out.log") `
        -RedirectStandardError (Join-Path $logDir "frontend.err.log")
}

$lanIp = Get-LanIPv4
$mobileHttps = $null
$mobileHttpsError = $null
if ($lanIp) {
    try {
        $mobileHttps = Initialize-MobileHttps -LanIp $lanIp
        if ($mobileHttps) {
            $env:ERP_MOBILE_HTTPS_PFX = $mobileHttps.PfxPath
            $env:ERP_MOBILE_HTTPS_PFX_PASSWORD = $mobileHttps.Password
        }
    } catch {
        $mobileHttpsError = $_.Exception.Message
        Remove-Item Env:ERP_MOBILE_HTTPS_PFX -ErrorAction SilentlyContinue
        Remove-Item Env:ERP_MOBILE_HTTPS_PFX_PASSWORD -ErrorAction SilentlyContinue
    }
}

if ($Restart) {
    Stop-ErpListener -Port 5173 -Pattern "vite"
    Stop-ErpListener -Port 8000 -Pattern "uvicorn app\.main:app"
    Start-Sleep -Seconds 2
}

Start-Backend
Start-Frontend

$frontendReady = Wait-Listener -Port 5173
$backendReady = Wait-Listener -Port 8000

$statusLines = @(
    "Hisbenew ERP mobile server startup complete.",
    "Frontend listener: $(if ($frontendReady) { 'ready' } else { 'not ready' })",
    "Backend listener: $(if ($backendReady) { 'ready' } else { 'not ready' })",
    "PC ERP URL: http://127.0.0.1:8000/portal",
    "ERP database: $(Join-Path $backendDir 'hisbenew_industries.db')",
    "ERP temp/cache: $portableDir"
)

if ($lanIp) {
    $statusLines += "Mobile basic URL (messages work, microphone blocked): http://$lanIp`:8000/portal"
    if ($mobileHttps) {
        $statusLines += "Mobile voice-call URL: https://$lanIp`:5173/portal"
        $statusLines += "First-time phone certificate: http://$lanIp`:8000/static/hisbenew-erp-mobile.cer"
        $statusLines += "On Android, install the downloaded file as a CA certificate, close Chrome, then open the secure mobile URL."
    } else {
        $statusLines += "Mobile URL: http://$lanIp`:5173"
        $statusLines += "Voice-call HTTPS setup failed: $mobileHttpsError"
    }
}

$statusLines | Set-Content -LiteralPath (Join-Path $logDir "last-start.txt") -Encoding UTF8
$statusLines
