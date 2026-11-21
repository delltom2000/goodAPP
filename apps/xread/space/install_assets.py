"""Install the platform-independent files of the verified 2.1 release."""

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
import zipfile


DIGEST = "c525f9b37845f164e8b3000cb830cd681e4c6efc37b80abe5117ad6d226a924b"
SIZE = 722147670
URL = ("https://huggingface.co/spaces/dellweb3/Translateall/resolve/main/"
       "releases/Xread-Web-2.1-Windows-x64.zip?download=true")
DEMO = {"captions.srt", "dubbed.mp4", "source.mp4"}
WEB = {"poster.jpg"} | {
    f"voice-{voice}-{quality}.mp3"
    for voice in ("female", "female_clear", "male")
    for quality in ("standard", "fast")
}


def extract(archive, destination):
    with archive.open("rb") as stream:
        if archive.stat().st_size != SIZE or hashlib.file_digest(stream, "sha256").hexdigest() != DIGEST:
            raise ValueError("Unexpected 2.1 release size or SHA-256")
        stream.seek(0)
        with zipfile.ZipFile(stream) as bundle:
            for member in bundle.infolist():
                path = PurePosixPath(member.filename)
                if member.is_dir() or ".." in path.parts or "\\" in member.filename:
                    continue
                selected = (path.parts[:2] == ("Xread", "models")
                            or (path.parent.as_posix() == "Xread/demo" and path.name in DEMO)
                            or (path.parent.as_posix() == "Xread/web" and path.name in WEB))
                if selected:
                    target = destination.joinpath(*path.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output, length=1024 * 1024)


def install(archive, destination):
    if archive.exists():
        if archive.stat().st_size > 4096:
            extract(archive, destination)
            return
        pointer = archive.read_text(encoding="ascii").splitlines()
        if pointer != ["version https://git-lfs.github.com/spec/v1", f"oid sha256:{DIGEST}", f"size {SIZE}"]:
            raise ValueError("Expected the verified 2.1 release or its matching LFS pointer")
    with tempfile.TemporaryDirectory() as work:
        downloaded = Path(work) / "release.zip"
        for attempt in range(3):
            try:
                request = Request(URL, headers={"User-Agent": "Xread-Space-build/2.1"})
                with urlopen(request, timeout=120) as source, downloaded.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                extract(downloaded, destination)
                return
            except (URLError, TimeoutError, ConnectionError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    install(args.archive, args.destination)
