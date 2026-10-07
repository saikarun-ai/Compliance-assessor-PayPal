<#
.SYNOPSIS
  Readiness probe: llama.cpp, PayPal Sandbox and the Agent Reach channels.
#>
[CmdletBinding()]
param()

Set-Location -LiteralPath $PSScriptRoot
npm run --silent health