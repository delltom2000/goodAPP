from pathlib import Path
import os,subprocess,zipfile,shutil,hashlib,sys
ROOT=Path(__file__).resolve().parent
TOOLS=ROOT.parents[1]/'.toolchain';JDK=TOOLS/'jdk17/bin';SDK=TOOLS/'android';BT=SDK/'build-tools/35.0.0';PLATFORM=SDK/'platforms/android-36/android.jar'
TEST='--test' in sys.argv
BUILD=ROOT/('build/offline-test' if TEST else 'build/offline');BUILD.mkdir(parents=True,exist_ok=True)
manifest=ROOT/'mobile/AndroidManifest.xml'
sources=list((ROOT/'mobile').glob('*.java'))
if TEST:
    contents=manifest.read_text(encoding='utf8').replace('<application ','<application android:debuggable="true" ').replace('</manifest>','<instrumentation android:name=".SelfTest" android:targetPackage="org.dailyfree.cleanclip"/></manifest>')
    manifest=BUILD/'AndroidManifest.xml';manifest.write_text(contents,encoding='utf8')
    sources+=list((ROOT/'mobile-tests').glob('*.java'))
def run(*args):subprocess.run([str(a) for a in args],check=True,env={**os.environ,'JAVA_HOME':str(JDK.parent)})
for name in ['classes','generated','dex']:(BUILD/name).mkdir(exist_ok=True)
run(BT/'aapt2.exe','compile','--dir',ROOT/'android/res','-o',BUILD/'resources.zip')
run(BT/'aapt2.exe','link','-o',BUILD/'base.apk','-I',PLATFORM,'--manifest',manifest,'--java',BUILD/'generated',BUILD/'resources.zip')
run(JDK/'javac.exe','-encoding','UTF-8','--release','8','-classpath',str(PLATFORM)+os.pathsep+str(TOOLS/'libraries/opencv-4.12.0/classes.jar'),'-d',BUILD/'classes',*sources,*list((BUILD/'generated').rglob('*.java')))
run(JDK/'jar.exe','cf',BUILD/'classes.jar','-C',BUILD/'classes','.')
run(JDK/'java.exe','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',PLATFORM,'--output',BUILD/'dex',BUILD/'classes.jar',TOOLS/'libraries/opencv-4.12.0/classes.jar')
shutil.copyfile(BUILD/'base.apk',BUILD/'unsigned.apk')
with zipfile.ZipFile(BUILD/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
    for p in (BUILD/'dex').glob('*.dex'):z.write(p,p.name)
    for lib in (TOOLS/'libraries/opencv-4.12.0/jni').rglob('*.so'):
        z.write(lib,'lib/'+lib.relative_to(TOOLS/'libraries/opencv-4.12.0/jni').as_posix())
    z.writestr('assets/OPENCV-LICENSE.txt',(ROOT/'licenses/OpenCV-LICENSE').read_text(encoding='utf8'))
run(BT/'zipalign.exe','-P','16','-f','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
out=BUILD/'cleanclip-test.apk' if TEST else ROOT.parents[1]/'dist/cleanclip-0.4.0-auto.apk'
run(JDK/'java.exe','-jar',BT/'lib/apksigner.jar','sign','--ks',TOOLS/'quiet-qr-development.keystore','--ks-pass','pass:android','--key-pass','pass:android','--out',out,BUILD/'aligned.apk')
run(JDK/'java.exe','-jar',BT/'lib/apksigner.jar','verify','--verbose',out)
out.with_suffix('.apk.sha256').write_text(hashlib.sha256(out.read_bytes()).hexdigest()+'  '+out.name+'\n')
print(out)
