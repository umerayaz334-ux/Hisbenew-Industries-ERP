@echo off
title Uninstall Hisbenew Print Agent Service
color 0C
echo =========================================================
echo   Uninstalling Hisbenew ERP Print Agent Service
echo =========================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Administrator privileges required!
    echo Please right-click uninstall_service.bat and select 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

set SERVICE_NAME=HisbenewPrintAgent

echo Stopping and removing %SERVICE_NAME%...
schtasks /end /tn "%SERVICE_NAME%" 2>nul
schtasks /delete /tn "%SERVICE_NAME%" /f 2>nul

echo.
echo Service successfully uninstalled.
pause
