"""Install the platform-independent files from the verified Windows release."""

import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
import zipfile
from upgrade_archive import restore


manifest = json.loads(Path(__file__).with_name("release.json").read_text(encoding="utf8"))
DIGEST, SIZE = manifest["sha256"], manifest["size"]
RELEASES = "https://huggingface.co/spaces/dellweb3/Translateall/resolve/main/releases/"
DEMO = {"captions.srt", "dubbed.mp4", "source.mp4"}
PREVIEW = re.compile(r"voice-[a-z_]+-(?:standard|fast)(?:-speech|-sweet)?\.mp3")


def extract(archive, destination):
    with archive.open("rb") as stream:
        if archive.stat().st_size != SIZE or hashlib.file_digest(stream, "sha256").hexdigest() != DIGEST:
            raise ValueError("Unexpected release size or SHA-256")
        stream.seek(0)
        with zipfile.ZipFile(stream) as bundle:
            for member in bundle.infolist():
                path = PurePosixPath(member.filename)
                if member.is_dir() or ".." in path.parts or "\\" in member.filename:
                    continue
                selected = (path.parts[:2] == ("Xread", "models")
                            or (path.parent.as_posix() == "Xread/demo" and path.name in DEMO)
                            or (path.parent.as_posix() == "Xread/web" and
                                (path.name == "poster.jpg" or PREVIEW.fullmatch(path.name))))
                if selected:
                    target = destination.joinpath(*path.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output, length=1024 * 1024)


def resolve_asset(directory, name, work):
    local = directory / name
    if local.is_file() and local.stat().st_size > 4096:
        return local
    downloaded = work / name
    for attempt in range(3):
        try:
            req = Request(RELEASES + name + "?download=true", headers={"User-Agent":"Xread-Space-build/2.2"})
            with urlopen(req, timeout=120) as source, downloaded.open("wb") as target:
                shutil.copyfileobj(source, target, length=1024**2)
            return downloaded
        except (URLError, TimeoutError, ConnectionError):
            if attempt==2:
                raise
            time.sleep(2**attempt)


def install(directory, destination):
    complete = destination / "downloads" / manifest["file"]
    complete.parent.mkdir(parents=True, exist_ok=True)
    provided = directory / manifest["file"]
    if provided.is_file() and provided.stat().st_size==SIZE:
        shutil.copyfile(provided, complete)
    else:
        meta=json.loads(Path(__file__).with_name("delta.json").read_text(encoding="utf8"))
        with tempfile.TemporaryDirectory() as tmp:
            base=resolve_asset(directory, meta["base_file"], Path(tmp))
            patch=resolve_asset(directory, meta["patch_file"], Path(tmp))
            restore(base,patch,complete,meta)
    extract(complete, destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    install(args.archive, args.destination)
