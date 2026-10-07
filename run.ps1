<#
.SYNOPSIS
  Compliance Assessor - one-command start (Windows PowerShell).

.EXAMPLE
  .\run.ps1                      start llama.cpp + the web app
  .\run.ps1 -RulesOnly           skip the model, classify with the RBI rules alone
  .\run.ps1 -NoBrowser           do not open a browser
#>
[CmdletBinding()]
param(
  [switch]$RulesOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host ' Compliance Assessor'
Write-Host ' ==================='
Write-Host ''

if (-not (Test-Path -LiteralPath 'node_modules\express')) {
  Write-Host '[setup] dependencies missing - running npm install'
  npm install --silent
}

$port = node --env-file-if-exists=.env -p "process.env.PORT||3000"
$llamaUrl = node --env-file-if-exists=.env -p "process.env.LLAMA_SERVER_URL||'http://127.0.0.1:8081'"

function Stop-Llama {
  Write-Host ''
  Write-Host '[stop] shutting down'
  Get-Process -Name 'llama', 'llama-server' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host '[stop] done'
}
trap { Stop-Llama; break }

if (-not $RulesOnly) {
  Write-Host "[1/3] starting local inference - llama.cpp on $llamaUrl"
  npm run --silent llama -- --detach
  if ($LASTEXITCODE -ne 0) { Write-Host '[warn] llama.cpp did not launch - continuing rules-only' }
  Write-Host '[2/3] loading the model'
  node scripts/wait-for.js "$llamaUrl/health" 180 'llama.cpp'
} else {
  Write-Host '[1/3] rules-only mode - skipping the model'
}

Write-Host "[3/3] starting the web app on http://localhost:$port"
Write-Host ''
if (-not $NoBrowser) { Start-Process "http://localhost:$port" }

npm start
Stop-Llama