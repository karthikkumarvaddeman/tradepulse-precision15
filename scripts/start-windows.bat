@echo off
cd /d "%~dp0"
if not exist .env (
  echo Missing .env. Run: copy .env.example .env
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run dev
