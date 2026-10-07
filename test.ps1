<#
.SYNOPSIS
  Full verification: RBI rules, PayPal invoice path, then the live end-to-end
  suite. Expect a few minutes - the last stage loads the model.
#>
[CmdletBinding()]
param()

Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host ' Compliance Assessor - test suite'
Write-Host ' =============================='
Write-Host ''

$suites = @(
  @{ Name = 'RBI classification rules';    Script = 'verify' },
  @{ Name = 'PayPal invoice path (mock Sandbox)'; Script = 'verify:invoice' },
  @{ Name = 'end-to-end with the live model';     Script = 'e2e' }
)

$step = 0
foreach ($suite in $suites) {
  $step += 1
  Write-Host "[$step/$($suites.Count)] $($suite.Name)"
  npm run --silent $suite.Script
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[fail] $($suite.Script) failed"
    exit $LASTEXITCODE
  }
}

Write-Host ''
Write-Host '[done] all suites passed'