"""Hugging Face Space entry point. All private resources use the current browser's library."""
from contextlib import contextmanager
from hashlib import sha256
import hmac
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
from threading import Lock, Thread
import time
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Xread"))
import server


BASE = Path(os.environ.get("XREAD_SPACE_DATA", "/tmp/xread-space")).resolve()
SESSIONS = BASE / "sessions"
TEMPLATE = BASE / "sample"
HOST = os.environ.get("SPACE_HOST", "dellweb3-translateall.hf.space")
PORT = int(os.environ.get("PORT", "7860"))
LOCAL_TEST = os.environ.get("XREAD_SPACE_LOCAL_TEST") == "1"
ORIGIN = f"http://127.0.0.1:{PORT}" if LOCAL_TEST else "https://" + HOST
COOKIE = "xread-test" if LOCAL_TEST else "__Host-xread"
TTL = 24 * 3600
UPLOAD = 512 * 1024**2
session_lock = Lock()
active = {}


def copy_sample(source, target):
    if source.endswith(".mp4"):
        try:
            os.link(source, target)
            return target
        except OSError:
            pass
    return shutil.copyfile(source, target)


def prepare():
    BASE.mkdir(parents=True, exist_ok=True)
    SESSIONS.mkdir(exist_ok=True)
    key = BASE / ".session-key"
    if not key.exists():
        key.write_bytes(secrets.token_bytes(32))
    server.initialize(TEMPLATE)
    for folder in SESSIONS.iterdir():
        if folder.is_dir():
            server.initialize(folder)
    return key.read_bytes()


def pending(library):
    for path in library.glob("*/job.json"):
        job = server.read(path)
        if job["status"] in {"working", "queued"} or job.get("dub", {}).get("status") in {"working", "queued"}:
            yield job


def cleanup():
    while True:
        time.sleep(600)
        for folder in SESSIONS.iterdir():
            with session_lock:
                if (folder.is_dir() and not active.get(folder) and time.time() - folder.stat().st_mtime > TTL
                        and not any(pending(folder))):
                    shutil.rmtree(folder)


@contextmanager
def library_for(session):
    folder = SESSIONS / sha256(session.encode()).hexdigest()[:32]
    with session_lock:
        if not folder.exists():
            folder.mkdir()
            try:
                shutil.copytree(TEMPLATE / "demo", folder / "demo", copy_function=copy_sample)
            except Exception:
                shutil.rmtree(folder)
                raise
        os.utime(folder, None)
        active[folder] = active.get(folder, 0) + 1
    ctx = server.request_library.set(folder)
    try:
        yield folder
    finally:
        server.request_library.reset(ctx)
        with session_lock:
            active[folder] -= 1
            if not active[folder]:
                del active[folder]


class SpaceHandler(server.Handler):
    def check_host(self):
        # Spaces terminates HTTPS in front of this process. All absolute links
        # and origin checks use the configured canonical host.
        pass

    def valid_origin(self):
        return self.headers.get("Origin") in {None, ORIGIN}

    def end_headers(self):
        if getattr(self, "new_cookie", None):
            secure = "" if LOCAL_TEST else "; Secure; SameSite=None; Partitioned"
            self.send_header("Set-Cookie", f"{COOKIE}={self.new_cookie}; Path=/; HttpOnly; Max-Age={TTL}{secure}")
        self.send_header("Referrer-Policy", "same-origin")
        if self.path.startswith(("/api/", "/media/")):
            self.send_header("Vary", "Cookie")
            self.send_header("Cache-Control", "private, no-store")
        super().end_headers()

    def get_session(self, create):
        cookies = SimpleCookie()
        cookies.load(self.headers.get("Cookie", ""))
        value = cookies[COOKIE].value if COOKIE in cookies else ""
        if re.fullmatch(r"[a-f0-9]{48}\.[a-f0-9]{64}", value):
            session, signature = value.split(".")
            if hmac.compare_digest(signature, hmac.new(KEY, session.encode(), sha256).hexdigest()):
                return session
        if not create:
            raise PermissionError("请先从工作台首页打开当前会话；也可在独立窗口打开 Space。")
        session = secrets.token_hex(24)
        self.new_cookie = session + "." + hmac.new(KEY, session.encode(), sha256).hexdigest()
        return session

    def route_get(self, path):
        if path == "/":
            self.get_session(create=True)
            return super().route_get(path)
        if path == "/api/health" or path.startswith("/static/"):
            return super().route_get(path)
        if not path.startswith(("/api/", "/media/")):
            raise FileNotFoundError
        with library_for(self.get_session(create=path == "/api/jobs")):
            return super().route_get(path)

    def route_post(self, path):
        if not self.valid_origin() or self.headers.get("X-Xread") != "1":
            raise PermissionError("请在本 Space 工作台提交。")
        with library_for(self.get_session(create=False)) as folder:
            if path == "/api/upload" and int(self.headers.get("Content-Length", "0")) > UPLOAD:
                return self.reply({"error":"在线版单个文件最多 512 MB，长视频也可使用 Windows 离线版。"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            if path in {"/api/upload", "/api/jobs"}:
                if shutil.disk_usage(BASE).free < 3 * 1024**3:
                    return self.reply({"error":"服务器临时空间已满，请稍后重试或使用 Windows 版。"}, HTTPStatus.SERVICE_UNAVAILABLE)
                if sum(1 for _ in pending(folder)) >= 8:
                    return self.reply({"error":"已有 8 个任务处理中，请在部分任务完成后继续导入。"}, HTTPStatus.TOO_MANY_REQUESTS)
            return super().route_post(path)


if __name__ == "__main__":
    KEY = prepare()
    Thread(target=cleanup, daemon=True).start()
    print(f"Xread Space listening on {PORT}", flush=True)
    address = "127.0.0.1" if LOCAL_TEST and os.environ.get("XREAD_CONTAINER_LOCAL") != "1" else "0.0.0.0"
    ThreadingHTTPServer((address, PORT), SpaceHandler).serve_forever()
