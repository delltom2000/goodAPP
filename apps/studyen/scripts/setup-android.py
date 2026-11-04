"""Download verified official build tools into this checkout; never changes global settings."""
import concurrent.futures, hashlib, json, pathlib, urllib.request, zipfile
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / '.toolchain'
DEST.mkdir(exist_ok=True)
def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r: return r.read()
def download(name, url, digest, algorithm='sha256'):
    path = DEST / name
    if not path.exists() or hashlib.new(algorithm, path.read_bytes()).hexdigest() != digest:
        print('Downloading '+name, flush=True)
        tmp=path.with_suffix('.part')
        with urllib.request.urlopen(url,timeout=120) as r, tmp.open('wb') as f:
            while chunk:=r.read(1024*1024): f.write(chunk)
        if hashlib.new(algorithm,tmp.read_bytes()).hexdigest()!=digest: raise RuntimeError('Checksum mismatch: '+name)
        tmp.replace(path)
    return path
def unpack(path, target):
    marker=target/'.ready'
    if marker.exists(): return
    target.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(path) as z:
        for item in z.infolist():
            if not (target/item.filename).resolve().is_relative_to(target.resolve()): raise RuntimeError('Unsafe archive')
        z.extractall(target)
    marker.touch()
metadata_path=DEST/'jdk-metadata.json'
if not metadata_path.exists():
    metadata_path.write_bytes(fetch('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows'))
metadata=json.loads(metadata_path.read_text(encoding='utf-8-sig'))
jdk=metadata[0]['binary']['package']
xml=ET.fromstring(fetch('https://dl.google.com/android/repository/repository2-1.xml'))
packages=list(xml.findall('remotePackage'))
cli=next(p for p in packages if p.attrib['path']=='cmdline-tools;23.0')
archive=next(a for a in cli.findall('./archives/archive') if a.findtext('host-os')=='windows')
complete=archive.find('complete')
license_id=cli.find('uses-license').attrib['ref']
license_text=next(l.text for l in xml.findall('license') if l.attrib['id']==license_id)
(DEST/'ANDROID-SDK-LICENSE.txt').write_text(license_text,encoding='utf-8')
gradle_url='https://services.gradle.org/distributions/gradle-8.9-bin.zip'
gradle_hash=fetch(gradle_url+'.sha256').decode().strip()
jobs=[('jdk.zip',jdk['link'],jdk['checksum'],'sha256','java'),('commandline.zip','https://dl.google.com/android/repository/'+complete.findtext('url'),complete.findtext('checksum'),'sha1','sdk-cli'),('gradle.zip',gradle_url,gradle_hash,'sha256','gradle')]
def run(job):
    name,url,digest,algo,folder=job
    unpack(download(name,url,digest,algo),DEST/folder)
    print('Ready: '+folder,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: list(pool.map(run,jobs))
print('Tool downloads complete. Android SDK license acceptance is a separate step.',flush=True)
