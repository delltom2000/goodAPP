"""Reproducible local APK build using the pinned toolchain, without Gradle downloads."""
from pathlib import Path
import hashlib
import os
import shutil
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'apps/quiet-qr'
TOOLS=ROOT/'.toolchain'
JDK=TOOLS/'jdk17/bin'
SDK=TOOLS/'android'
BT=SDK/'build-tools/35.0.0'
ANDROID=SDK/'platforms/android-36/android.jar'
ZXING=TOOLS/'libraries/zxing-core-3.5.3.jar'
BUILD=APP/'build/local'


def run(*args):
    subprocess.run([str(a) for a in args],check=True,env={**os.environ,'JAVA_HOME':str(JDK.parent)},cwd=APP)


def main():
    if not all(p.exists() for p in [JDK/'javac.exe',BT/'aapt2.exe',ANDROID,ZXING]):
        raise SystemExit('Missing toolchain: run python tools/setup_toolchain.py first')
    BUILD.mkdir(parents=True,exist_ok=True)
    classes=BUILD/'classes'; generated=BUILD/'generated'; dex=BUILD/'dex'
    for directory in (classes,generated,dex):directory.mkdir(exist_ok=True)
    resources=APP/'app/src/main/res'
    run(BT/'aapt2.exe','compile','--dir',resources,'-o',BUILD/'resources.zip')
    run(BT/'aapt2.exe','link','-o',BUILD/'base.apk','-I',ANDROID,'--manifest',APP/'app/src/main/AndroidManifest.xml',
        '--java',generated,'--auto-add-overlay',BUILD/'resources.zip')
    sources=sorted((APP/'app/src/main/java').rglob('*.java'))+sorted(generated.rglob('*.java'))
    run(JDK/'javac.exe','-encoding','UTF-8','--release','8','-classpath',str(ANDROID)+os.pathsep+str(ZXING),'-d',classes,*sources)
    run(JDK/'jar.exe','cf',BUILD/'classes.jar','-C',classes,'.')
    run(JDK/'java.exe','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',ANDROID,
        '--output',dex,BUILD/'classes.jar',ZXING)
    unsigned=BUILD/'unsigned.apk'
    shutil.copyfile(BUILD/'base.apk',unsigned)
    with zipfile.ZipFile(unsigned,'a',zipfile.ZIP_DEFLATED) as archive:
        for item in sorted(dex.glob('*.dex')):archive.write(item,item.name)
    run(BT/'zipalign.exe','-f','4',unsigned,BUILD/'aligned.apk')
    key=TOOLS/'quiet-qr-development.keystore'
    if not key.exists():
        run(JDK/'keytool.exe','-genkeypair','-keystore',key,'-storepass','android','-keypass','android',
            '-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000',
            '-dname','CN=Quiet QR Development, O=Daily Free Apps, C=US')
    output=ROOT/'dist';output.mkdir(exist_ok=True)
    apk=output/'quiet-qr-0.1.0-preview.apk'
    run(JDK/'java.exe','-jar',BT/'lib/apksigner.jar','sign','--ks',key,'--ks-pass','pass:android',
        '--key-pass','pass:android','--out',apk,BUILD/'aligned.apk')
    run(JDK/'java.exe','-jar',BT/'lib/apksigner.jar','verify','--verbose',apk)
    checksum=hashlib.sha256(apk.read_bytes()).hexdigest()
    (output/(apk.name+'.sha256')).write_text(checksum+'  '+apk.name+'\n',encoding='utf-8')
    print('APK:',apk)
    print('SHA256:',checksum)
    print('Development-signed preview. Not a production Play Store release.')


if __name__=='__main__':main()
