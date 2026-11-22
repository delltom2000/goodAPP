"""Hugging Face Space entry point. All private resources use the current browser's library."""
from contextlib import contextmanager
from hashlib import sha256
from collections import deque
import hmac
import json
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
login_attempts = {}
login_lock = Lock()


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
        if (job["status"] in {"working", "queued"} or job.get("dub", {}).get("status") in {"working", "queued"}
                or job.get("highlights", {}).get("status") in {"working", "queued"}):
            yield job


def cleanup():
    while True:
        time.sleep(600)
        for folder in SESSIONS.iterdir():
            with session_lock:
                if (folder.is_dir() and not active.get(folder) and time.time() - folder.stat().st_mtime > TTL
                        and not any(pending(folder))):
                    shutil.rmtree(folder)


def account_attempts(now):
    history = BASE / ".highlight-login-attempts"
    try:
        attempts = json.loads(history.read_text(encoding="ascii"))
    except FileNotFoundError:
        attempts = []
    return history, [stamp for stamp in attempts if now - 900 <= stamp <= now]


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

    def highlight_key(self):
        return "" if self.highlight_login_required() else os.environ.get("DASHSCOPE_API_KEY", "")

    def supplied_highlight_key(self, given_key):
        return self.highlight_key()

    def highlight_proof(self):
        phone = os.environ.get("XREAD_HIGHLIGHT_PHONE", "")
        code = os.environ.get("XREAD_HIGHLIGHT_ACCESS_CODE", "")
        folder = server.request_library.get()
        if not phone or not code or not os.environ.get("DASHSCOPE_API_KEY"):
            return folder, "", ""
        proof = hmac.new(KEY, (folder.name+"\0"+phone+"\0"+code).encode(), sha256).hexdigest()
        return folder, phone, proof

    def highlight_login_required(self):
        folder, _, proof = self.highlight_proof()
        marker = folder / ".highlight-access"
        if not proof:
            return True
        try:
            return not (time.time() - marker.stat().st_mtime < TTL and hmac.compare_digest(
                marker.read_text(encoding="ascii"), proof))
        except OSError:
            return True

    def login_highlights(self):
        folder, phone, proof = self.highlight_proof()
        if not proof:
            return self.reply({"error":"Space 尚未配置切片登录。"}, 503)
        if int(self.headers.get("Content-Length", "0")) > 4096:
            raise ValueError("验证信息过长。")
        data = self.body()
        value, code = data.get("phone"), data.get("code")
        if not isinstance(value, str) or not isinstance(code, str):
            raise ValueError("请输入手机号与访问码。")
        now = time.monotonic()
        with login_lock:
            for identifier, attempts in list(login_attempts.items()):
                while attempts and attempts[0] < now-300:
                    attempts.popleft()
                if not attempts:
                    del login_attempts[identifier]
            attempts = login_attempts.setdefault(folder.name, deque())
            if len(attempts) >= 6:
                return self.reply({"error":"验证尝试太频繁，请五分钟后再试。"}, 429)
            attempts.append(now)
            normalized = re.sub(r"[\s-]", "", value).removeprefix("+86")
            if not hmac.compare_digest(normalized.encode(), phone.encode()):
                return self.reply({"error":"手机号或访问码不正确。"}, 403)
            current = time.time()
            history, failures = account_attempts(current)
            if len(failures) >= 8:
                return self.reply({"error":"手机号的验证尝试太频繁，请十五分钟后再试。"}, 429)
            code_matches = hmac.compare_digest(code.strip().encode(), os.environ["XREAD_HIGHLIGHT_ACCESS_CODE"].encode())
            if not code_matches:
                temp = history.with_suffix(".tmp")
                temp.write_text(json.dumps([*failures, current]), encoding="ascii")
                temp.replace(history)
                return self.reply({"error":"手机号或访问码不正确。"}, 403)
            (folder / ".highlight-access").write_text(proof, encoding="ascii")
            login_attempts.pop(folder.name, None)
        return self.reply({"verified":True})

    def end_headers(self):
        if getattr(self, "new_cookie", None):
            secure = "" if LOCAL_TEST else "; Secure; SameSite=None; Partitioned"
            self.send_header("Set-Cookie", f"{COOKIE}={self.new_cookie}; Path=/; HttpOnly; Max-Age={TTL}{secure}")
        self.send_header("Referrer-Policy", "same-origin")
        if self.path.startswith(("/api/", "/media/", "/clips/")):
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
        if path == "/download/windows":
            release=json.loads(Path(__file__).with_name("release.json").read_text(encoding="utf8"))
            archive=Path(__file__).resolve().parents[1]/"downloads"/release["file"]
            return self.serve(archive, release["file"])
        if path == "/":
            self.get_session(create=True)
            return super().route_get(path)
        if path == "/api/health" or path.startswith("/static/"):
            return super().route_get(path)
        if not path.startswith(("/api/", "/media/", "/clips/")):
            raise FileNotFoundError
        with library_for(self.get_session(create=path == "/api/jobs")):
            if path.startswith("/clips/") and self.highlight_login_required():
                raise PermissionError("请先验证手机号与访问码。")
            return super().route_get(path)

    def route_post(self, path):
        if not self.valid_origin() or self.headers.get("X-Xread") != "1":
            raise PermissionError("请在本 Space 工作台提交。")
        with library_for(self.get_session(create=False)) as folder:
            if path == "/api/highlights/login":
                return self.login_highlights()
            if path.endswith("/highlights") and self.highlight_login_required():
                raise PermissionError("请先验证手机号与访问码。")
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
