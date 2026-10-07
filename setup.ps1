<#
.SYNOPSIS
  First-time setup: Node check, dependencies, .env, model and llama binaries.
  Read-only apart from Install-Module/npm install - it never edits your .env.
#>
[CmdletBinding()]
param()

Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host ' Compliance Assessor - setup'
Write-Host ' ========================'
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[fail] Node.js not found. Install Node 20.6 or newer: https://nodejs.org'
  exit 1
}
Write-Host "[ok]   node $(node -v)"
Write-Host "[ok]   npm  $(npm -v)"

if (-not (Test-Path -LiteralPath 'node_modules\express')) {
  Write-Host '[run]  npm install'
  npm install
} else {
  Write-Host '[ok]   dependencies already installed'
}

if (Test-Path -LiteralPath '.env') {
  Write-Host '[ok]   .env present'
} else {
  Write-Host '[warn] .env missing - copying .env.example'
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}

Write-Host '[info] configuration'
node scripts/setup-check.js
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '[warn] some optional pieces are missing - the app still runs, degraded.'
  Write-Host '[info] see README.md for what each missing piece disables.'
}

Write-Host ''
Write-Host '[done] start the app with:  .\run.ps1'