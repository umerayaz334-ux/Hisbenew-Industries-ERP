@echo off
title Hisbenew ERP Backend Server (Port 8000)
cd /d "D:\Factory Software\Hisbenew Industries ERP\backend"
echo Starting Hisbenew ERP FastAPI Backend Server on port 8000...
echo Keep this window open or minimized to keep the backend active.
"D:\softwares installation\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
