from pathlib import Path
import os
import subprocess
from build_android import ROOT,APP,JDK,ZXING

output=APP/'build/core-tests';output.mkdir(parents=True,exist_ok=True)
sources=[APP/'app/src/main/java/org/dailyfree/quietqr'/name for name in ['QrContent.java','QrCodec.java']]
sources.append(APP/'tests/QrCoreTest.java')
subprocess.run([str(JDK/'javac.exe'),'-encoding','UTF-8','--release','8','-cp',str(ZXING),'-d',str(output),*[str(s) for s in sources]],check=True)
subprocess.run([str(JDK/'java.exe'),'-cp',str(output)+os.pathsep+str(ZXING),'org.dailyfree.quietqr.QrCoreTest',str(APP/'build/fixtures')],check=True)
