@echo off
cd /d "%~dp0"
if not exist "dist\BlueArchiveCursor.exe" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 exit /b 1
start "" "%~dp0dist\BlueArchiveCursor.exe"
