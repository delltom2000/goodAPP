param(
    [string]$ToolchainRoot = 'F:/workbuddy/toolchain',
    [string]$SigningKeystore = $env:CRYPTO_SIGNING_KEYSTORE
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $PSScriptRoot 'app/src/main'
[xml]$manifest = Get-Content -LiteralPath (Join-Path $source 'AndroidManifest.xml') -Raw
$ns = 'http://schemas.android.com/apk/res/android'
$version = $manifest.manifest.GetAttribute('versionName', $ns)
$out = Join-Path $PSScriptRoot "build-$version"
$dist = Join-Path $projectRoot 'dist'
$jdk = Join-Path $ToolchainRoot 'jdk-17.0.20.1+1/bin'
$sdk = Join-Path $ToolchainRoot 'android-sdk'
$bt = Join-Path $sdk 'build-tools/34.0.0'
$platform = Join-Path $sdk 'platforms/android-34/android.jar'
if (!$SigningKeystore) { $SigningKeystore = Join-Path $PSScriptRoot 'release.jks' }
foreach ($path in @($SigningKeystore, $platform, "$jdk/java.exe", "$bt/aapt2.exe")) {
    if (!(Test-Path -LiteralPath $path)) { throw "Required file missing: $path" }
}
if (!$env:CRYPTO_STORE_PASSWORD -or !$env:CRYPTO_KEY_PASSWORD) {
    throw 'Set CRYPTO_STORE_PASSWORD and CRYPTO_KEY_PASSWORD before signing.'
}
function Run-Native([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Native tool failed ($LASTEXITCODE): $File" }
}
foreach ($name in @('gen', 'classes', 'dex', 'jvmtest')) {
    New-Item -ItemType Directory -Path (Join-Path $out $name) -Force | Out-Null
}
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$www = Join-Path $source 'assets/www'
New-Item -ItemType Directory -Path $www -Force | Out-Null
Write-Output '1/8 Sync web assets and generate embedded bundle'
foreach ($name in @('index.html', 'newcoins.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $www -Recurse -Force
}
Run-Native 'python' @((Join-Path $PSScriptRoot 'tools/gen_bundle.py'))
Write-Output '2/8 Verify embedded bundle on JVM'
$javaSource = Join-Path $source 'java/com/niulai/crypto'
$testSources = @(
    (Join-Path $javaSource 'WebBundle.java'), (Join-Path $javaSource 'AssetMap.java'),
    (Join-Path $PSScriptRoot 'jvmtest/stub/android/util/Base64.java'),
    (Join-Path $PSScriptRoot 'jvmtest/stub/android/util/Log.java'),
    (Join-Path $PSScriptRoot 'jvmtest/src/com/niulai/crypto/BundleTest.java')
)
Run-Native "$jdk/javac.exe" (@('-encoding', 'UTF-8', '-d', "$out/jvmtest") + $testSources)
Run-Native "$jdk/java.exe" @('-cp', "$out/jvmtest", 'com.niulai.crypto.BundleTest', $www)
Write-Output '3/8 Compile and link resources'
Run-Native "$bt/aapt2.exe" @('compile', '--dir', "$source/res", '-o', "$out/res.zip")
Run-Native "$bt/aapt2.exe" @('link', '-o', "$out/base.apk", '-I', $platform, '--manifest', "$source/AndroidManifest.xml", '-A', "$source/assets", '--java', "$out/gen", '--min-sdk-version', '26', '--target-sdk-version', '34', "$out/res.zip")
Write-Output '4/8 Compile Java'
$sources = @(Get-ChildItem -LiteralPath "$out/gen", "$source/java" -Filter '*.java' -Recurse | ForEach-Object FullName)
Run-Native "$jdk/javac.exe" (@('-nowarn', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-classpath', $platform, '-d', "$out/classes") + $sources)
Write-Output '5/8 Compile DEX'
$classes = @(Get-ChildItem -LiteralPath "$out/classes" -Filter '*.class' -Recurse | ForEach-Object FullName)
Run-Native "$jdk/java.exe" (@('-cp', "$bt/lib/d8.jar", 'com.android.tools.r8.D8', '--release', '--lib', $platform, '--min-api', '26', '--output', "$out/dex") + $classes)
Write-Output '6/8 Assemble and align APK'
Copy-Item -LiteralPath "$out/base.apk" -Destination "$out/unsigned.apk" -Force
Run-Native "$jdk/jar.exe" @('ufM', "$out/unsigned.apk", '-C', "$out/dex", 'classes.dex')
Run-Native "$bt/zipalign.exe" @('-f', '-p', '4', "$out/unsigned.apk", "$out/aligned.apk")
Write-Output '7/8 Sign and verify APK'
$apk = Join-Path $dist "CryptoPulse-$version.apk"
Run-Native "$jdk/java.exe" @('-jar', "$bt/lib/apksigner.jar", 'sign', '--ks', $SigningKeystore, '--ks-key-alias', 'niulai', '--ks-pass', 'env:CRYPTO_STORE_PASSWORD', '--key-pass', 'env:CRYPTO_KEY_PASSWORD', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--out', $apk, "$out/aligned.apk")
Run-Native "$jdk/java.exe" @('-jar', "$bt/lib/apksigner.jar", 'verify', '--verbose', '--print-certs', $apk)
Run-Native "$bt/zipalign.exe" @('-c', '-p', '4', $apk)
Write-Output '8/8 Package metadata'
Run-Native "$bt/aapt2.exe" @('dump', 'badging', $apk)
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  CryptoPulse-$version.apk" | Set-Content -LiteralPath (Join-Path $dist "CryptoPulse-$version.sha256") -Encoding ascii
Write-Output "APK: $apk"
Write-Output "SHA256: $hash"
