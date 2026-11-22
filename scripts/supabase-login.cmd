@echo off
setlocal
set "SUPABASE_HOME=%~dp0..\work\.supabase-home"
set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
cd /d "%~dp0.."
"%~dp0..\node_modules\.bin\supabase.cmd" login
if errorlevel 1 (
  echo Supabase login did not finish. Please check the message above.
  echo.
  pause
  exit /b 1
)
echo.
echo Deploying the updated lesson playback function...
"%~dp0..\node_modules\.bin\supabase.cmd" functions deploy bunny-playback --project-ref prcasfkowelbbtfclexc
if errorlevel 1 (
  echo.
  echo Deployment did not finish. Please send a screenshot of the error with any token hidden.
) else (
  echo.
echo The updated bunny-playback function supports public previews and checks monthly expiry.
)
pause
endlocal
