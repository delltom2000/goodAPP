"""Install a project-local Android build toolchain from official HTTPS sources."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import shutil
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.toolchain'
PACKAGES = [
    ('jdk17', 'https://download.visualstudio.microsoft.com/download/pr/1f2b3c02-2145-4a46-a595-f6d249a7c3fe/e00c46bbf94ca5c5e1da9f363f4d5edc/microsoft-jdk-17.0.21.0.2-windows-x64.zip', 'sha256', '49154292866386b2f4f09a3ecf3be07ab80a419149c84ec1d4419b9eec9e4b64', 'jdk17'),
    ('android36', 'https://dl.google.com/android/repository/platform-36_r02.zip', 'sha1', '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576', 'android/platforms/android-36'),
    ('buildtools35', 'https://dl.google.com/android/repository/build-tools_r35_windows.zip', 'sha1', 'af059bb67cf7786f45ee0db85e2d24985df1b4b6', 'android/build-tools/35.0.0'),
    ('platformtools', 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip', 'sha1', 'e03e78b1d80b396f1c3358e31251cb31740e1110', 'android/platform-tools'),
]


def fetch(url, path, algorithm, checksum):
    if path.exists() and hashlib.new(algorithm, path.read_bytes()).hexdigest() == checksum:
        return
    temporary = path.with_suffix(path.suffix + '.part')
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
        shutil.copyfileobj(response, output, 1024 * 1024)
    if hashlib.new(algorithm, temporary.read_bytes()).hexdigest() != checksum:
        raise RuntimeError(f'Checksum mismatch: {path.name}')
    temporary.replace(path)


def install(package):
    name, url, algorithm, checksum, relative = package
    target = BASE / relative
    marker = target / '.installed.json'
    if marker.exists() and json.loads(marker.read_text())['checksum'] == checksum:
        return name + ': already installed'
    archive = BASE / 'downloads' / (name + '.zip')
    fetch(url, archive, algorithm, checksum)
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        entries = [n for n in z.namelist() if not n.startswith('__MACOSX/')]
        roots = {n.split('/')[0] for n in entries}
        if len(roots) != 1:
            raise RuntimeError(f'Unexpected archive layout: {name}')
        for entry in entries:
            relative_path = entry.partition('/')[2]
            if not relative_path or entry.endswith('/'):
                continue
            path = (target / relative_path).resolve()
            if not path.is_relative_to(target.resolve()):
                raise RuntimeError('Unsafe archive path')
            path.parent.mkdir(parents=True, exist_ok=True)
            with z.open(entry) as source, path.open('wb') as output:
                shutil.copyfileobj(source, output)
    marker.write_text(json.dumps({'url': url, 'checksum': checksum, 'algorithm': algorithm}, indent=2))
    return name + ': installed'


if __name__ == '__main__':
    (BASE / 'downloads').mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(install, PACKAGES):
            print(result, flush=True)
    # The library is downloaded separately and checked against its publisher checksum.
    library_url = 'https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar'
    library_sha = urllib.request.urlopen(library_url + '.sha1', timeout=30).read().decode().strip()
    (BASE / 'libraries').mkdir(exist_ok=True)
    fetch(library_url, BASE / 'libraries/zxing-core-3.5.3.jar', 'sha1', library_sha)
    (BASE / 'libraries/zxing-core-3.5.3.sha1').write_text(library_sha)
    print('ZXing: downloaded and checksum verified', flush=True)
