@echo off
title Install Hisbenew Print Agent Windows Service
color 0A
echo =========================================================
echo    Installing Hisbenew ERP Print Agent Windows Service
echo =========================================================
echo.

:: Ensure administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Administrator privileges required!
    echo Please right-click install_service.bat and select 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"
set SERVICE_NAME=HisbenewPrintAgent
set AGENT_DIR=%~dp0
set VENV_PYTHON=%AGENT_DIR%venv\Scripts\python.exe
set SCRIPT_PATH=%AGENT_DIR%printer_agent.py

if not exist "%VENV_PYTHON%" (
    echo Virtual environment not found at %VENV_PYTHON%.
    echo Creating virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
)

echo Registering Windows Task Scheduler Daemon for Auto-Start...
schtasks /create /tn "%SERVICE_NAME%" /tr "\"%VENV_PYTHON%\" \"%SCRIPT_PATH%\"" /sc ONSTART /ru "SYSTEM" /f
schtasks /run /tn "%SERVICE_NAME%"

echo.
echo =========================================================
echo  Hisbenew Print Agent Service successfully installed!
echo =========================================================
echo Service Name: %SERVICE_NAME%
echo Executable  : %VENV_PYTHON% %SCRIPT_PATH%
echo Status      : Started
echo.
pause
