param(
    [Parameter(Mandatory)][string]$JavaHome,
    [Parameter(Mandatory)][string]$BuildTools,
    [Parameter(Mandatory)][string]$AndroidJar,
    [Parameter(Mandatory)][string]$ZxingJar,
    [Parameter(Mandatory)][string]$Keystore,
    [Parameter(Mandatory)][string]$OutputApk
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Required([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE." }
}

if (-not $env:QRCAMERA_KEYSTORE_PASSWORD) {
    throw 'Set QRCAMERA_KEYSTORE_PASSWORD before running the build.'
}

$java = Join-Path $JavaHome 'bin/java.exe'
$javac = Join-Path $JavaHome 'bin/javac.exe'
$jar = Join-Path $JavaHome 'bin/jar.exe'
$aapt = Join-Path $BuildTools 'aapt2.exe'
$zipalign = Join-Path $BuildTools 'zipalign.exe'
$dexCompiler = Join-Path $BuildTools 'lib/d8.jar'
$signer = Join-Path $BuildTools 'lib/apksigner.jar'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('qr-apk-' + [Guid]::NewGuid())
$classes = Join-Path $scratch 'classes'
$dex = Join-Path $scratch 'dex'
$resources = Join-Path $scratch 'resources.zip'
$classJar = Join-Path $scratch 'app.jar'
$unsigned = Join-Path $scratch 'unsigned.apk'
$aligned = Join-Path $scratch 'aligned.apk'
$null = New-Item -ItemType Directory -Path $classes,$dex -Force

try {
    $sources = @(Get-ChildItem (Join-Path $PSScriptRoot 'src') -Recurse -Filter '*.java' |
        ForEach-Object FullName)
    $classpath = $AndroidJar + [IO.Path]::PathSeparator + $ZxingJar
    Invoke-Required $javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8',
        '-Xlint:-options', '-classpath', $classpath, '-d', $classes) + $sources)
    Invoke-Required $jar @('cf', $classJar, '-C', $classes, '.')
    Invoke-Required $java @('-cp', $dexCompiler, 'com.android.tools.r8.D8', '--release',
        '--min-api', '23', '--lib', $AndroidJar, '--output', $dex, $classJar, $ZxingJar)
    Invoke-Required $aapt @('compile', '--dir', (Join-Path $PSScriptRoot 'res'), '-o', $resources)
    Invoke-Required $aapt @('link', '-o', $unsigned, '-I', $AndroidJar,
        '--manifest', (Join-Path $PSScriptRoot 'AndroidManifest.xml'),
        '-A', (Join-Path $PSScriptRoot 'assets'), $resources)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $apk = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $apk, (Join-Path $dex 'classes.dex'), 'classes.dex',
            [IO.Compression.CompressionLevel]::Optimal)
    } finally {
        $apk.Dispose()
    }
    Invoke-Required $zipalign @('-f', '4', $unsigned, $aligned)
    Invoke-Required $java @('-jar', $signer, 'sign', '--ks', $Keystore, '--ks-key-alias',
        'qr-camera', '--ks-pass', 'env:QRCAMERA_KEYSTORE_PASSWORD', '--v4-signing-enabled',
        'false', '--out', $OutputApk, $aligned)
    Invoke-Required $java @('-jar', $signer, 'verify', '--verbose', $OutputApk)
} finally {
    $resolvedScratch = (Resolve-Path -LiteralPath $scratch).ProviderPath
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char[]]@('\', '/')) +
        [IO.Path]::DirectorySeparatorChar + 'qr-apk-'
    if ($resolvedScratch.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
