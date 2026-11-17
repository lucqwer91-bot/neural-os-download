@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Installiere Abhaengigkeiten, das dauert beim ersten Mal ein paar Minuten...
  call npm install
)
call npm run dev
pause
