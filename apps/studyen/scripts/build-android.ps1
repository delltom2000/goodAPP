param([switch]$AcceptAndroidSdkLicense)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$toolRoot=Join-Path $projectRoot '.toolchain'
$jdkRoot=(Get-ChildItem (Join-Path $toolRoot 'java') -Directory | Select-Object -First 1).FullName
if (-not $jdkRoot) { throw 'Run scripts/setup-android.py first.' }
$env:JAVA_HOME=$jdkRoot
$env:PATH=(Join-Path $jdkRoot 'bin')+';'+$env:PATH
$env:ANDROID_HOME=Join-Path $toolRoot 'sdk'
$env:ANDROID_USER_HOME=Join-Path $toolRoot 'android-user'
$androidCli=Join-Path $toolRoot 'sdk-cli/cmdline-tools/bin/android.exe'
$consentFile=Join-Path $toolRoot 'sdk-consent.txt'
if ($AcceptAndroidSdkLicense) {
    # Invoke only after the user explicitly accepts the SDK licence.
    [IO.File]::WriteAllText($consentFile,('Android SDK terms accepted via explicit build flag at '+[DateTime]::UtcNow.ToString('o')+'. No Google account login required.'))
}
if (-not (Test-Path $consentFile)) {
    throw 'Android SDK licence not accepted. Read .toolchain/ANDROID-SDK-LICENSE.txt and rerun with -AcceptAndroidSdkLicense only with user authorisation.'
}
& $androidCli --no-metrics "--sdk=$env:ANDROID_HOME" sdk install 'platforms/android-35' 'build-tools/35.0.0' 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'SDK installation failed.' }
$keyStore=Join-Path $toolRoot 'debug.keystore'
if (-not (Test-Path $keyStore)) {
    & (Join-Path $jdkRoot 'bin/keytool.exe') -genkeypair -keystore $keyStore -storepass android -alias androiddebugkey -keypass android -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
    if ($LASTEXITCODE -ne 0) { throw 'Debug key generation failed.' }
}
$sdkPath=$env:ANDROID_HOME.Replace('\','/')
[IO.File]::WriteAllText((Join-Path $projectRoot 'android/local.properties'),"sdk.dir=$sdkPath`n")
$gradle=Join-Path $toolRoot 'gradle/gradle-8.9/bin/gradle.bat'
Push-Location (Join-Path $projectRoot 'android')
try {
    & $gradle --gradle-user-home (Join-Path $toolRoot 'gradle-cache') --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
} finally { Pop-Location }
$apk=Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
& (Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat') verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$downloads=Join-Path $projectRoot 'dist/downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
Copy-Item -LiteralPath $apk -Destination (Join-Path $downloads 'jianjin-ielts-debug.apk') -Force
[IO.File]::WriteAllText((Join-Path $downloads 'status.json'),'{"ready":true,"version":"0.2.1","kind":"debug"}')
Get-FileHash -LiteralPath (Join-Path $downloads 'jianjin-ielts-debug.apk') -Algorithm SHA256
