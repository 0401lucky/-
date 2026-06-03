@echo off
cd /d "%~dp0.."

if not exist ".wrangler-config" mkdir ".wrangler-config"
if not exist ".tmp" mkdir ".tmp"

set "XDG_CONFIG_HOME=%CD%\.wrangler-config"
set "WRANGLER_HOME=%CD%\.wrangler-config"
set "TEMP=%CD%\.tmp"
set "TMP=%CD%\.tmp"

npm run dev
