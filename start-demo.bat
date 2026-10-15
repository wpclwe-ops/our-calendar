@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.12 or later from python.org, then run this file again.
  pause
  exit /b 1
)
if not exist .venv py -3 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt
if errorlevel 1 (
  pause
  exit /b 1
)
set DEMO_MODE=true
set DATABASE_PATH=data\demo.sqlite3
set ARCHIVE_KEY_FILE=data\demo-key.pem
set ARCHIVE_PUBLIC_KEYS=data\demo-public-keys.json
python -m scripts.demo_seed
start http://127.0.0.1:8000
python -m app
pause
