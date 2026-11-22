"""Private, incremental CloudBase snapshots for video clipping."""
import base64
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from clips import bundle


BUCKET = "xread-checkpoints"
CHUNK_SIZE = 4 * 1024**2
MAX_BYTES = 2 * 1024**3
TOKEN = re.compile(r"[a-f0-9]{64}")
DIGEST = TOKEN


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configuration():
    try:
        key = os.environ.get("XREAD_CLOUDBASE_KEY") or Path(
            os.environ["XREAD_CLOUDBASE_KEY_FILE"]).read_text(encoding="utf-8-sig").strip()
        encoded = key.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        env = claims["project_id"]
        if claims.get("role") == "service_role" and re.fullmatch(r"[a-z0-9-]{6,80}", env):
            return env, key
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        pass
    return None


def safe_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in (".", "..") for part in path.parts) or ":" in name or "\\" in name:
        raise ValueError("云端检查点的文件路径无效。")
    return path


class Snapshot:
    def __init__(self, connection, token):
        env, self.key = connection
        if not TOKEN.fullmatch(token):
            raise ValueError("云端恢复链接无效。")
        self.prefix = sha256(token.encode("ascii")).hexdigest()
        self.base = f"https://{env}.api.tcloudbasegateway.com/v1/storages/object/{BUCKET}/{self.prefix}"
        self.client = build_opener(NoRedirect())
        self.files = {}
        self.stored = set()

    def object(self, name, data=None):
        headers = {"Authorization":"Bearer " + self.key, "Cache-Control":"no-cache"}
        if data is not None:
            headers.update({"Content-Type":"application/octet-stream", "x-upsert":"true"})
        req = Request(self.base + "/" + name, data, headers)
        with self.client.open(req, timeout=45) as response:
            return response.read(CHUNK_SIZE + 1)

    def manifest(self):
        return json.loads(self.object("state.json"))

    def save(self, folder, job, files):
        if not self.stored:
            try:
                self.stored = {digest for file in self.manifest()["files"] for digest in file["chunks"]}
            except HTTPError as error:
                if error.code != 404:
                    raise
        if sum(path.stat().st_size for path in files) > MAX_BYTES:
            raise ValueError("视频和切片超过云端备份上限。")
        manifest = []
        for path in files:
            name = path.relative_to(folder).as_posix()
            stat = path.stat()
            fingerprint = (stat.st_size, stat.st_mtime_ns)
            if name not in self.files or self.files[name][0] != fingerprint:
                chunks = []
                with path.open("rb") as stream:
                    while data := stream.read(CHUNK_SIZE):
                        digest = sha256(data).hexdigest()
                        if digest not in self.stored:
                            self.object(digest, data)
                            self.stored.add(digest)
                        chunks.append(digest)
                self.files[name] = (fingerprint, {"path":name,"size":stat.st_size,"chunks":chunks})
            manifest.append(self.files[name][1])
        data = json.dumps({"job":job,"files":manifest}, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(data) > CHUNK_SIZE:
            raise ValueError("云端检查点过大。")
        self.object("state.json", data)

    def restore(self, destination):
        try:
            manifest = self.manifest()
        except HTTPError as error:
            if error.code == 404:
                raise FileNotFoundError from None
            raise
        files = manifest["files"]
        total = sum(file["size"] for file in files)
        if total > MAX_BYTES or total > shutil.disk_usage(destination).free - 1024**3:
            raise ValueError("可用空间不足，无法恢复云端任务。")
        with tempfile.TemporaryDirectory(prefix=".restore-", dir=destination) as staging:
            folder = Path(staging)
            for file in files:
                target = folder.joinpath(*safe_path(file["path"]).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as stream:
                    for digest in file["chunks"]:
                        if not DIGEST.fullmatch(digest):
                            raise ValueError("云端检查点校验信息无效。")
                        data = self.object(digest)
                        if sha256(data).hexdigest() != digest:
                            raise ValueError("云端文件校验失败，请重试。")
                        stream.write(data)
                if target.stat().st_size != file["size"]:
                    raise ValueError("云端文件长度不完整，请重试。")
            job = manifest["job"]
            job["id"] = destination.name
            job["restoreDigest"] = self.prefix
            state = job["highlights"]
            if state["status"] in {"queued","working"}:
                state.update(status="error", message="已从云端恢复。点击「从断点继续」。")
            if state["status"] == "ready":
                bundle(folder / "highlights" / state["ticket"], state["clips"])
            for path in folder.iterdir():
                target = destination / path.name
                if path.is_dir() and target.is_dir():
                    shutil.copytree(path, target, dirs_exist_ok=True)
                else:
                    path.replace(target)
        return job
