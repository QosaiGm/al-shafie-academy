@echo off
setlocal
set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
cd /d "%~dp0.."
"%~dp0..\node_modules\.bin\vite.cmd" --host 127.0.0.1 --configLoader runner
echo.
echo The local server stopped. If an error appeared above, take a screenshot.
pause
endlocal
