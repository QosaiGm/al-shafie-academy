$ErrorActionPreference = 'Stop'
$env:SUPABASE_HOME = Join-Path $PSScriptRoot '..\work\.supabase-home'
pnpm exec supabase @args
exit $LASTEXITCODE
