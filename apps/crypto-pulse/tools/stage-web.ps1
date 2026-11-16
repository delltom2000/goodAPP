$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path (Split-Path $projectRoot -Parent) -Parent
$outputPath = Join-Path $repoRoot 'web-dist'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
foreach ($name in @('index.html', 'newcoins.html', 'manifest.webmanifest', 'sw.js', 'LICENSE', 'README.md', 'HISTORY-UPGRADE.md', 'start.bat', 'css', 'js', 'icons')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $outputPath -Recurse -Force
}
$archivePath = Join-Path $repoRoot 'CryptoPulse-web-local.zip'
Compress-Archive -Path (Join-Path $outputPath '*') -DestinationPath $archivePath -Force
Write-Output "Web directory: $outputPath"
Write-Output "Web archive: $archivePath"
