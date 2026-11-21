"""Restore the downloadable Windows ZIP using the release data already on the Space."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def restore(base, delta, destination, metadata):
    if digest(base) != metadata["base_sha256"] or digest(delta) != metadata["patch_sha256"]:
        raise ValueError("Release input checksum failed")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(delta) as archive, base.open("rb") as original, destination.open("wb") as result:
        plan=json.loads(archive.read("plan.json"))
        with archive.open("extra.bin") as extra:
            for offset, length in plan:
                source = extra if offset is None else original
                if source is original:
                    original.seek(offset)
                while length:
                    data = source.read(min(1024*1024,length))
                    if not data:
                        raise ValueError("Release patch is incomplete")
                    result.write(data)
                    length-=len(data)
