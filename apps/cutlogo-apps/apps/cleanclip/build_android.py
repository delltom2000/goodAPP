from pathlib import Path
import os,subprocess,zipfile,shutil,hashlib
ROOT=Path(__file__).resolve().parent
TOOLS=ROOT.parents[1]/'.toolchain';JDK=TOOLS/'jdk17/bin';SDK=TOOLS/'android';BT=SDK/'build-tools/35.0.0';PLATFORM=SDK/'platforms/android-36/android.jar'
BUILD=ROOT/'build/android';BUILD.mkdir(parents=True,exist_ok=True)
def run(*args):subprocess.run([str(a) for a in args],check=True,env={**os.environ,'JAVA_HOME':str(JDK.parent)})
for name in ['classes','generated','dex']:(BUILD/name).mkdir(exist_ok=True)
run(BT/'aapt2.exe','compile','--dir',ROOT/'android/res','-o',BUILD/'resources.zip')
run(BT/'aapt2.exe','link','-o',BUILD/'base.apk','-I',PLATFORM,'--manifest',ROOT/'android/AndroidManifest.xml','--java',BUILD/'generated',BUILD/'resources.zip')
run(JDK/'javac.exe','-encoding','UTF-8','--release','8','-classpath',PLATFORM,'-d',BUILD/'classes',ROOT/'android/MainActivity.java',*list((BUILD/'generated').rglob('*.java')))
run(JDK/'jar.exe','cf',BUILD/'classes.jar','-C',BUILD/'classes','.')
run(JDK/'java.exe','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',PLATFORM,'--output',BUILD/'dex',BUILD/'classes.jar')
shutil.copyfile(BUILD/'base.apk',BUILD/'unsigned.apk')
with zipfile.ZipFile(BUILD/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
    for p in (BUILD/'dex').glob('*.dex'):z.write(p,p.name)
run(BT/'zipalign.exe','-f','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
out=ROOT.parents[1]/'dist/cleanclip-0.2.0-preview.apk'
run(JDK/'java.exe','-jar',BT/'lib/apksigner.jar','sign','--ks',TOOLS/'quiet-qr-development.keystore','--ks-pass','pass:android','--key-pass','pass:android','--out',out,BUILD/'aligned.apk')
run(JDK/'java.exe','-jar',BT/'lib/apksigner.jar','verify','--verbose',out)
out.with_suffix('.apk.sha256').write_text(hashlib.sha256(out.read_bytes()).hexdigest()+'  '+out.name+'\n')
print(out)
