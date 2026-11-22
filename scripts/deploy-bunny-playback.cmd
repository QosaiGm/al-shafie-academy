@echo off
setlocal
set "SUPABASE_HOME=%~dp0..\work\.supabase-home"
set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
cd /d "%~dp0.."
echo Deploying Bunny playback with monthly-expiry checks and free previews...
"%~dp0..\node_modules\.bin\supabase.cmd" functions deploy bunny-playback --project-ref prcasfkowelbbtfclexc
if errorlevel 1 (
  echo.
  echo Deployment did not finish. Check that Supabase CLI is logged in.
  echo If not logged in, run scripts\supabase-login.cmd first, then this file again.
) else (
  echo.
  echo Updated Bunny playback function deployed.
)
echo.
pause
endlocal
