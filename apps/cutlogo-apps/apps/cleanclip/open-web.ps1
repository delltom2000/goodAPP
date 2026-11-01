Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'connection.json')) { Write-Host 'Please start start-local.ps1 first.'; exit 1 }
$cleanclipConnection = Get-Content -LiteralPath 'connection.json' -Raw | ConvertFrom-Json
Start-Process $cleanclipConnection.local
