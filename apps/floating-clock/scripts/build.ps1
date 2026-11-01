param([string]$JavaHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
Set-Location $project
if (-not $JavaHome) {
    $candidate = Get-ChildItem "$project/.tools/jdk" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { $JavaHome = $candidate.FullName }
}
if (-not (Test-Path "$JavaHome/bin/javac.exe")) { throw 'Specify -JavaHome with the path to JDK 17 or newer.' }
$sdk = "$project/.tools/sdk"
$aapt = Get-ChildItem "$project/.tools" -Filter aapt2.exe -Recurse | Select-Object -First 1
$platform = Get-ChildItem $sdk -Filter android.jar -Recurse | Select-Object -First 1
if (-not $aapt -or -not $platform) { throw 'Run python scripts/download_sdk.py first.' }
$bt = $aapt.Directory.FullName
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome/bin;$env:PATH"
function Run([string]$Exe, [string[]]$Arguments) { & $Exe @Arguments; if ($LASTEXITCODE -ne 0) { throw "$Exe failed ($LASTEXITCODE)" } }
New-Item -ItemType Directory -Force build,build/classes,build/generated,build/dex,dist | Out-Null
Run "$bt/aapt2.exe" @('compile','--dir','app/src/main/res','-o','build/resources.zip')
Run "$bt/aapt2.exe" @('link','-o','build/base.apk','-I',$platform.FullName,'--manifest','app/src/main/AndroidManifest.xml','--java','build/generated','build/resources.zip')
$sources = @(Get-ChildItem app/src/main/java,build/generated -Filter *.java -Recurse | ForEach-Object { $_.FullName })
Run "$JavaHome/bin/javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$platform.FullName,'-d','build/classes') + $sources)
Run "$JavaHome/bin/jar.exe" @('cf','build/classes.jar','-C','build/classes','.')
Run "$JavaHome/bin/java.exe" @('-cp',"$bt/lib/d8.jar",'com.android.tools.r8.D8','--lib',$platform.FullName,'--min-api','26','--output','build/dex','build/classes.jar')
Copy-Item build/base.apk build/unsigned.apk -Force
Run "$JavaHome/bin/jar.exe" @('uf','build/unsigned.apk','-C','build/dex','classes.dex')
Run "$bt/zipalign.exe" @('-f','4','build/unsigned.apk','build/aligned.apk')
if (-not (Test-Path '.tools/debug.jks')) {
    Run "$JavaHome/bin/keytool.exe" @('-genkeypair','-keystore','.tools/debug.jks','-storepass','android','-keypass','android','-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Floating Clock Debug')
}
Run "$JavaHome/bin/java.exe" @('-jar',"$bt/lib/apksigner.jar",'sign','--ks','.tools/debug.jks','--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out','dist/FloatingClock.apk','build/aligned.apk')
Run "$JavaHome/bin/java.exe" @('-jar',"$bt/lib/apksigner.jar",'verify','--verbose','dist/FloatingClock.apk')
Write-Host 'Built dist/FloatingClock.apk'
