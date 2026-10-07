<#
.SYNOPSIS
  Stop every Compliance Assessor process: the web app and llama.cpp.
#>
[CmdletBinding()]
param()

Set-Location -LiteralPath $PSScriptRoot
$port = node --env-file-if-exists=.env -p "process.env.PORT||3000"

Write-Host "[stop] stopping the web app on port $port"
Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

Write-Host '[stop] stopping llama.cpp'
Get-Process -Name 'llama', 'llama-server' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host '[stop] done'