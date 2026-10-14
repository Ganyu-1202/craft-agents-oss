@echo off
if not defined TOKENBIRD_SCRIPTS set "TOKENBIRD_SCRIPTS=%~dp0..\scripts"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%TOKENBIRD_SCRIPTS%\desktop-control.ps1" %*
