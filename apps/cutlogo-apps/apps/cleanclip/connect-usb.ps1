Set-Location -LiteralPath $PSScriptRoot
$cleanclipAdb = Join-Path $PSScriptRoot '..\..\.toolchain\android\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $cleanclipAdb)) { $cleanclipAdb = 'adb' }
& $cleanclipAdb devices
& $cleanclipAdb reverse tcp:8765 tcp:8765
if ($LASTEXITCODE -eq 0) {
    Write-Host 'USB ready. App address: http://127.0.0.1:8765'
    Write-Host 'Open CleanClip on your phone. No connection code is required.'
}
