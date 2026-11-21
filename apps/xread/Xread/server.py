"""Xread personal video subtitle workbench. Run with the bundled Python on Windows."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from threading import Lock, RLock, Timer
import time
from urllib.parse import unquote, urlsplit
from urllib.request import build_opener, ProxyHandler
import uuid
import webbrowser

import media

ROOT = Path(__file__).resolve().parent
LIBRARY = Path(os.environ.get("XREAD_LIBRARY") or
               (Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Xread" / "Library"))
request_library = ContextVar("xread_request_library")
MAX_UPLOAD = 8 * 1024**3
X_URL = re.compile(r"https?://(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)/(?:[\w]+/status|i/web/status)/(\d+)(?:[/?#].*)?", re.I)
FORMATS = {".mp4", ".mkv", ".mov", ".webm", ".m4v", ".avi", ".mpeg", ".mpg"}
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="subtitle")
caption_scan = ThreadPoolExecutor(max_workers=1, thread_name_prefix="caption-check")
state_lock = RLock()
file_locks = {}
pending = []
VERSION = "2.1"
DEFAULT_VOICE = "female"
VOICES = {"female", "female_clear", "male", "auto", "low", "high"}


def read(path):
    with state_lock:
        return json.loads(path.read_text(encoding="utf-8"))


def save(path, value):
    with state_lock:
        temp = path.with_name(path.name + ".tmp")
        temp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        temp.replace(path)


def update(folder, **changes):
    with state_lock:
        path = folder / "job.json"
        job = read(path) if path.exists() else {}
        job.update(changes)
        save(path, job)
        return job


def artifact_lock(folder):
    with state_lock:
        return file_locks.setdefault(folder.name, Lock())


def new_job(source, title, **extra):
    folder = request_library.get(LIBRARY) / uuid.uuid4().hex
    folder.mkdir()
    update(folder, id=folder.name, source=source, title=title, created=time.time(),
           status="queued", message="等待处理", progress=0, duration=0, count=0, **extra)
    return folder


def public(job):
    item = {key: job[key] for key in ("id", "title", "status", "message", "source", "duration", "count")}
    # The included sample was visually checked. Other videos may have burned-in text.
    item["detectedCaptions"] = known_picture(job) or job.get("visualCaptions") is True
    item["captionMode"] = job.get("captionMode", "auto")
    item["captionsChecked"] = known_picture(job) or "visualCaptions" in job or item["captionMode"] in {"keep","burn"}
    item["burnedCaptions"] = item["detectedCaptions"] or item["captionMode"] == "keep"
    item["created"] = job.get("created", 0)
    item["progress"] = job.get("progress", 100 if job["status"] == "ready" else 0)
    item["dub"] = {**dict(status="none", progress=0, message="", voice=job.get("autoVoice") or DEFAULT_VOICE,
                          quality=job.get("autoQuality", "standard"), captionMode=item["captionMode"],
                          audioMode=job.get("audioMode", "dubbed")),
                   **{k:v for k,v in job.get("dub", {}).items() if k in {"status","progress","message","voice","quality","captionMode","audioMode"}}}
    with state_lock:
        item["queuePosition"] = next((i for i, (_, identifier) in enumerate(pending, 1)
                                     if identifier == job["id"]), 0)
    return item


def enqueue(folder, action, *args):
    entry = (uuid.uuid4().hex, folder.name)
    def work():
        with state_lock:
            pending.remove(entry)
        action(folder, *args)
    with state_lock:
        pending.append(entry)
        pool.submit(work)


def voice_name(value):
    if not isinstance(value, str) or value not in VOICES:
        raise ValueError("请选择可用的女声、男声或自动匹配。")
    return value


def quality_name(value):
    if value not in ("standard", "fast"):
        raise ValueError("请选择标准音质或快速配音。")
    return value


def audio_mode(value):
    if value not in ("original", "dubbed"):
        raise ValueError("请选择原声或中文配音。")
    return value


def sound_options(sound, voice, quality):
    sound = audio_mode(sound)
    if sound == "original":
        return sound, DEFAULT_VOICE, "standard"
    return sound, voice_name(voice), quality_name(quality)


def caption_mode(value):
    if value not in ("auto", "keep", "burn"):
        raise ValueError("请选择自动判断、沿用原画中文或添加中文字幕。")
    return value


def known_picture(job):
    link = X_URL.fullmatch(job.get("url", ""))
    return job["id"] == "demo" or bool(link and link[1] == "2115421187044225159")


def inspect_picture(folder, job, source, rows):
    if known_picture(job) or job.get("captionMode") in {"keep","burn"} or "visualCaptions" in job:
        return job
    with artifact_lock(folder):
        job = read(folder / "job.json")
        if "visualCaptions" not in job:
            from detect_captions import detect
            job = update(folder, visualCaptions=bool(detect(source, rows)))
    return job


def inspect_history(folder):
    job = read(folder / "job.json")
    try:
        inspect_picture(folder, job, folder / job["preview"], read(captions_dir(folder) / "cues.json"))
    except Exception as exc:
        update(folder, captionCheckError=str(exc)[:250])


def new_dub(job, voice, quality="standard", mode=None, sound=None):
    sound = sound or job.get("audioMode", "dubbed")
    message = "等待制作原声字幕版" if sound == "original" else "等待生成中文配音"
    return dict(status="queued", message=message, progress=0, voice=voice, quality=quality, audioMode=sound,
                renderVersion=VERSION,
                captionMode=mode or job.get("captionMode", "auto"),
                revision=job.get("revision", "."), ticket=uuid.uuid4().hex)


def film_folder(folder, dub):
    style = "picture" if dub.get("picture") else "subtitled"
    renders = folder / dub["revision"] / "renders"
    if dub.get("audioMode") == "original":
        return renders / "original" / style
    if dub.get("renderVersion"):
        renders = renders / dub["renderVersion"]
    return renders / dub["voice"] / dub.get("quality", "standard") / style


class Superseded(Exception):
    """A caption edit or another render request replaced this job."""


def run_dub(folder, request):
    original = request.get("audioMode") == "original"
    final_message = "原声字幕成片已就绪" if original else "中文配音成片已就绪"
    def persist(**change):
        with state_lock:
            job = read(folder / "job.json")
            current = job.get("dub", {})
            if current.get("ticket") != request["ticket"]:
                raise Superseded()
            return update(folder, dub={**current, **change})
    def report(percent, message):
        nonlocal final_message
        if percent >= 100:
            final_message = message
        persist(progress=max(0, min(99, int(percent))), message=message)
    try:
        job = persist(status="working", message="正在准备原声字幕版" if original else "正在准备中文音轨")
        rows = read(folder / request["revision"] / "cues.json")
        job = inspect_picture(folder, job, folder / job["preview"], rows)
        picture = public(job)["burnedCaptions"]
        request = {**request, "picture":picture}
        persist(picture=picture)
        output = film_folder(folder, request)
        output.mkdir(parents=True, exist_ok=True)
        if not (output / "dubbed.mp4").is_file():
            import dub
            if original:
                dub.render_original(folder / job["preview"], rows, output, report, burned_captions=picture)
            else:
                dub.render(folder / job["preview"], rows, output, request["voice"], report,
                           burned_captions=picture,
                           cache_dir=folder / "voice-cache" / request["voice"] / request["quality"],
                           quality=request["quality"])
        if not (output / "dubbed.mp4").is_file():
            raise ValueError("配音引擎没有生成视频文件。")
        persist(status="ready", progress=100, message=final_message)
    except Superseded:
        return
    except Exception as exc:
        try:
            persist(status="error", message=str(exc)[:1400] or "配音失败，请重试。")
        except Superseded:
            pass


def duration(path):
    result = subprocess.check_output([str(ROOT / "tools" / "ffprobe.exe"), "-v", "error",
        "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        encoding="utf-8", errors="replace", timeout=45, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    value = float(result.strip())
    if not math.isfinite(value) or value <= 0:
        raise ValueError("无法读取视频时长。")
    return value


def process(folder):
    percent = 0
    def report(message):
        update(folder, message=str(message), progress=percent)
    def advance(value):
        nonlocal percent
        percent = max(percent, min(99, int(value)))
    try:
        job = update(folder, status="working", progress=1, message="正在读取视频")
        advance(1)
        cache = folder / "source.json"
        if cache.exists():
            meta = read(cache)
            source = folder / meta["file"]
            rows = meta["rows"]
        else:
            if job["source"] == "x":
                source, rows, title = media.download_x(job["url"], folder, report, lambda n: advance(2 + 22*n))
                update(folder, title=title or job["title"])
            else:
                source = folder / job["input"]
                if not source.is_file():
                    raise ValueError("上次文件上传未完成，请重新选择本地视频。")
                rows = media.inspect_local(source)
            save(cache, {"file": source.name, "rows": rows})
        advance(25)
        report("正在准备浏览器预览")
        preview = media.prepare_preview(source, folder / "preview.mp4")
        length = duration(preview)
        update(folder, preview=preview.name, duration=length)
        speech_cache = folder / "english.json"
        if not rows:
            if speech_cache.exists():
                rows = read(speech_cache)
            else:
                import engine
                report("正在本机识别英文语音")
                rows = engine.transcribe(source, report, lambda sec: advance(28 + 43*min(sec/length, 1)))
                save(speech_cache, rows)
        if not rows:
            raise ValueError("没有识别到英文对白，请检查原视频的人声。")
        missing = [row for row in rows if not row.get("zh") and row.get("en")]
        if missing:
            import engine
            advance(72)
            report("正在翻译为简体中文")
            engine.translate(missing, report, lambda n: advance(72 + 24*n))
        for row in rows:
            row.setdefault("en", "")
            row.setdefault("zh", "")
        advance(97)
        report("正在检查原画中的中文字幕")
        job = inspect_picture(folder, read(folder / "job.json"), preview, rows)
        with artifact_lock(folder):
            advance(98)
            report("正在保存时间轴和中文字幕")
            media.write_subtitles(rows, folder)
            save(folder / "cues.json", rows)
            request = new_dub(job, job["autoVoice"], job.get("autoQuality", "standard")) if job.get("autoVoice") else None
            update(folder, count=len(rows), status="ready", progress=100, message="字幕已就绪",
                   **({"dub":request} if request else {}))
        if request:
            run_dub(folder, request)
    except Exception as exc:
        update(folder, status="error", message=str(exc)[:1400] or "任务处理失败")


def initialize(library=None):
    library = library or LIBRARY
    library.mkdir(parents=True, exist_ok=True)
    for path in sorted(library.glob("*/job.json"), key=lambda p:read(p).get("created", 0)):
        job = read(path)
        if job["status"] in {"queued", "working"}:
            if job["source"] == "file" and not (path.parent / job["input"]).is_file():
                update(path.parent, status="error", message="上次上传未完成，请重新选择文件。")
            else:
                update(path.parent, status="queued", message="恢复上次任务")
                enqueue(path.parent, process)
        elif job.get("dub", {}).get("status") in {"queued", "working"}:
            request = new_dub(job, job["dub"]["voice"], job["dub"].get("quality", "standard"),
                              sound=job["dub"].get("audioMode", "dubbed"))
            update(path.parent, dub=request)
            enqueue(path.parent, run_dub, request)
        elif job["status"] == "ready" and not known_picture(job) and "visualCaptions" not in job:
            caption_scan.submit(inspect_history, path.parent)
    demo = library / "demo"
    demo.mkdir(exist_ok=True)
    if not (demo / "job.json").exists():
        sample = demo / "source.mp4"
        shutil.copyfile(ROOT / "demo" / "source.mp4", sample)
        rows = media.inspect_local(sample)
        if not rows or not any(r.get("zh") for r in rows):
            raise RuntimeError("内置样片字幕读取失败")
        media.write_subtitles(rows, demo)
        save(demo / "cues.json", rows)
        update(demo, id="demo", source="demo", title="Lauren Tan 谈 AI 助手团队",
               created=0, status="ready", message="作者双语字幕", duration=duration(sample),
               count=len(rows), preview=sample.name)
    job = read(demo / "job.json")
    bundled = ROOT / "demo" / "dubbed.mp4"
    if bundled.is_file() and (not job.get("dub") or "picture" not in job["dub"]) and not job.get("revision"):
        request = new_dub(job, DEFAULT_VOICE)
        request["picture"] = True
        target = film_folder(demo, request)
        target.mkdir(parents=True, exist_ok=True)
        staging = target / "demo.part"
        shutil.copyfile(bundled, staging)
        staging.replace(target / "dubbed.mp4")
        update(demo, dub={**request, "status":"ready", "progress":100, "message":"中文配音成片已就绪"})


def open_job(identifier):
    if not re.fullmatch(r"[a-f0-9]{32}|demo", identifier):
        raise FileNotFoundError
    folder = request_library.get(LIBRARY) / identifier
    if not (folder / "job.json").is_file():
        raise FileNotFoundError
    return folder


def captions_dir(folder):
    return folder / read(folder / "job.json").get("revision", ".")


def picture_preview(folder, job):
    with artifact_lock(folder):
        job = read(folder / "job.json")
        if job.get("cleanPreview") and (folder / job["cleanPreview"]).is_file():
            return folder / job["cleanPreview"]
        source = folder / job["preview"]
        streams = media.probe(source)["streams"]
        if any(s.get("codec_type") == "subtitle" for s in streams):
            source = media._convert(folder / "picture-only.mp4",
                                    ["-i", source, "-map", "0:V:0", "-map", "0:a:0?",
                                     "-c", "copy", "-sn", "-movflags", "+faststart"])
        update(folder, cleanPreview=source.name)
        return source


class Handler(BaseHTTPRequestHandler):
    server_version = "Xread/" + VERSION

    def reply(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def check_host(self):
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.headers.get("Host", "") not in allowed:
            raise PermissionError("请使用本机启动地址打开 Xread。")

    def valid_origin(self):
        return self.headers.get("Origin") in {None, "http://" + self.headers["Host"]}

    def serve(self, path, download=None):
        if not path.is_file():
            raise FileNotFoundError
        with path.open("rb") as handle:
            size = os.fstat(handle.fileno()).st_size
            start, end = 0, size - 1
            req = self.headers.get("Range")
            if req:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", req)
                if match and any(match.groups()):
                    left, right = match.groups()
                    start = int(left) if left else max(0, size - int(right))
                    end = min(int(right), end) if left and right else end
                if not match or not any(match.groups()) or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
            self.send_response(206 if req else 200)
            mime = {".srt":"application/x-subrip", ".vtt":"text/vtt", ".js":"text/javascript"}.get(path.suffix,
                mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-cache")
            if req:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            if download:
                self.send_header("Content-Disposition", f'attachment; filename="{download}"')
            self.end_headers()
            handle.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                data = handle.read(min(remaining, 256 * 1024))
                if not data:
                    break
                self.wfile.write(data)
                remaining -= len(data)

    def body(self):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 16 * 1024**2:
            raise ValueError("请求内容大小有误")
        obj = json.loads(self.rfile.read(length))
        if not isinstance(obj, dict):
            raise ValueError("请求内容格式有误")
        return obj

    def route_get(self, path):
        if path == "/api/health":
            return self.reply({"app":"Xread", "version":VERSION})
        if path == "/":
            return self.serve(ROOT / "web" / "index.html")
        if re.fullmatch(r"/static/[\w.\-]+", path):
            return self.serve(ROOT / "web" / path.split("/")[-1])
        if path == "/api/jobs":
            with state_lock:
                jobs = [read(p) for p in request_library.get(LIBRARY).glob("*/job.json")]
            return self.reply([public(j) for j in sorted(jobs, key=lambda j:j["created"], reverse=True)])
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api","jobs"] and parts[3] == "cues":
            return self.reply(read(captions_dir(open_job(parts[2])) / "cues.json"))
        if len(parts) == 3 and parts[0] == "media":
            folder = open_job(parts[1])
            job = read(folder / "job.json")
            if job["status"] != "ready":
                raise ValueError("视频尚未完成处理")
            name = parts[2]
            if name == "video.mp4":
                if public(job)["burnedCaptions"]:
                    return self.serve(picture_preview(folder, job))
                return self.serve(folder / job["preview"])
            if name in {"dubbed.mp4", "dub-download.mp4"}:
                film = job.get("dub", {})
                if film.get("status") != "ready" or film["revision"] != job.get("revision", "."):
                    raise ValueError("请先制作当前字幕对应的成片。")
                suffix = "original-audio" if film.get("audioMode") == "original" else "Mandarin"
                return self.serve(film_folder(folder, film) / "dubbed.mp4",
                                  f"Xread-{folder.name[:8]}-{suffix}.mp4" if name == "dub-download.mp4" else None)
            if name == "original":
                original = folder / (read(folder / "source.json")["file"]
                                     if (folder / "source.json").exists() else job["preview"])
                return self.serve(original, f"Xread-{folder.name[:8]}-original{original.suffix}")
            if name in {"zh.vtt","bilingual.vtt","zh.srt","bilingual.srt"}:
                return self.serve(captions_dir(folder) / name, f"Xread-{folder.name[:8]}-{name}" if name.endswith(".srt") else None)
            if name in {"zh.mp4","bilingual.mp4","burn.mp4"}:
                if public(job)["burnedCaptions"]:
                    return self.serve(picture_preview(folder, job), f"Xread-{folder.name[:8]}-original-captions.mp4")
                hard = name == "burn.mp4"
                with artifact_lock(folder):
                    revision = captions_dir(folder)
                    target = revision / ("burned.mp4" if hard else "video.mp4")
                    if not target.exists():
                        target = media.export_video(folder / job["preview"], read(revision / "cues.json"), revision,
                                                    lambda _: None, burn=hard)
                return self.serve(target, f"Xread-{folder.name[:8]}-{'zh' if hard else 'subtitles'}.mp4")
        raise FileNotFoundError

    def route_post(self, path):
        if self.headers.get("X-Xread") != "1" or not self.valid_origin():
            raise PermissionError("请从本机 Xread 工作台提交任务。")
        if path == "/api/upload":
            title = Path(unquote(self.headers.get("X-Filename", ""))).name[:200]
            ext = Path(title).suffix.lower()
            if ext not in FORMATS:
                raise ValueError("请选择 MP4、MOV、MKV、WebM 等视频文件。")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_UPLOAD:
                raise ValueError("视频必须大于 0 字节，且不超过 8 GB。")
            sound, selected, quality = sound_options(self.headers.get("X-Audio-Mode", "dubbed"),
                self.headers.get("X-Voice", DEFAULT_VOICE), self.headers.get("X-Quality", "standard"))
            mode = caption_mode(self.headers.get("X-Caption-Mode", "auto"))
            folder = new_job("file", title, input="upload" + ext, autoVoice=selected, autoQuality=quality,
                             captionMode=mode, audioMode=sound)
            update(folder, message="正在接收本地文件")
            try:
                partial = folder / "upload.part"
                with partial.open("wb") as handle:
                    while length:
                        data = self.rfile.read(min(1024**2, length))
                        if not data:
                            raise ValueError("上传中断，请重新选择文件。")
                        handle.write(data)
                        length -= len(data)
                partial.replace(folder / ("upload" + ext))
            except Exception:
                partial.unlink(missing_ok=True)
                update(folder, status="error", message="上传中断，请重新选择文件。")
                raise
        elif path == "/api/jobs":
            data = self.body()
            url = data.get("url", "")
            match = X_URL.fullmatch(url) if isinstance(url, str) else None
            if not match:
                raise ValueError("请粘贴包含 /status/ 和帖子编号的 X 视频链接。")
            sound, voice, quality = sound_options(data.get("audioMode", "dubbed"),
                data.get("voice", DEFAULT_VOICE), data.get("quality", "standard"))
            folder = new_job("x", "X 视频 · " + match[1], url=url, autoVoice=voice,
                             autoQuality=quality, captionMode=caption_mode(data.get("captionMode", "auto")), audioMode=sound)
        else:
            match = re.fullmatch(r"/api/jobs/([^/]+)/(retry|cues|dub)", path)
            if not match:
                raise FileNotFoundError
            folder = open_job(match[1])
            if match[2] == "dub":
                data = self.body()
                sound, voice, quality = sound_options(data.get("audioMode", "dubbed"),
                    data.get("voice", DEFAULT_VOICE), data.get("quality", "standard"))
                with state_lock:
                    job = read(folder / "job.json")
                    mode = caption_mode(data.get("captionMode", job.get("captionMode", "auto")))
                    if job["status"] != "ready":
                        raise ValueError("请等待中文字幕完成后再配音。")
                    previous = job.get("dub", {})
                    if (previous.get("status") in {"queued", "working", "ready"} and
                        previous.get("audioMode","dubbed") == sound and
                        (previous.get("renderVersion") == VERSION or sound == "original") and
                        (sound == "original" or (previous.get("voice") == voice and previous.get("quality","standard") == quality))
                        and mode == previous.get("captionMode", "auto")
                        and previous.get("revision") == job.get("revision", ".")):
                        return self.reply(public(job))
                    if previous.get("status") in {"queued","working"}:
                        raise ValueError("当前配音任务尚未完成，请稍后更换音色。")
                    request = new_dub(job, voice, quality, mode, sound)
                    job = update(folder, dub=request, captionMode=mode, audioMode=sound)
                    enqueue(folder, run_dub, request)
                    return self.reply(public(job), 202)
            elif match[2] == "retry":
                with state_lock:
                    if read(folder / "job.json")["status"] != "error":
                        raise ValueError("只能重试未完成的任务。")
                    update(folder, status="queued", message="等待重试")
            else:
                rows = self.body().get("rows")
                with artifact_lock(folder):
                    job = read(folder / "job.json")
                    original = read(captions_dir(folder) / "cues.json")
                    if not isinstance(rows, list) or len(rows) != len(original):
                        raise ValueError("字幕条数不匹配，请刷新页面。")
                    for row, prior in zip(rows, original):
                        if not isinstance(row, dict) or not isinstance(row.get("zh"), str) or not row["zh"].strip() or len(row["zh"]) > 10000:
                            raise ValueError("中文字幕格式有误。")
                        prior["zh"] = row["zh"].strip()
                    revision = folder / ("edit-" + uuid.uuid4().hex)
                    media.write_subtitles(original, revision)
                    save(revision / "cues.json", original)
                    with state_lock:
                        old = read(folder / "job.json").get("dub", {})
                        changes = {}
                        if old:
                            changes["dub"] = dict(status="stale", progress=0, voice=old["voice"],
                                                  quality=old.get("quality", "standard"),
                                                  audioMode=old.get("audioMode", "dubbed"),
                                                  captionMode=old.get("captionMode", "auto"),
                                                  message="字幕已修改，请重新制作成片")
                        job = update(folder, revision=revision.name, **changes)
                    return self.reply(public(job))
        enqueue(folder, process)
        return self.reply(public(read(folder / "job.json")), 202)

    def dispatch(self, route):
        try:
            self.check_host()
            route(urlsplit(self.path).path)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except FileNotFoundError:
            self.reply({"error":"找不到这个文件或任务。"}, 404)
        except PermissionError as exc:
            self.reply({"error":str(exc)}, 403)
        except (ValueError, TypeError) as exc:
            self.reply({"error":str(exc)}, 400)
        except Exception as exc:
            self.reply({"error":"处理失败：" + str(exc)[:600]}, 500)

    def do_GET(self):
        self.dispatch(self.route_get)

    def do_POST(self):
        self.dispatch(self.route_post)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError:
        try:
            with build_opener(ProxyHandler({})).open(url + "/api/health", timeout=2) as response:
                existing = json.load(response)
                if existing.get("app") != "Xread":
                    raise ValueError()
        except Exception:
            sys.exit(f"Port {args.port} is in use. Start with --port 8766.")
        if existing.get("version") != VERSION:
            sys.exit("Another Xread version is running. Close the old Xread before launching this release.")
        if args.open:
            webbrowser.open(url)
        sys.exit(0)
    # Different ports must not start competing workers against one task library.
    import msvcrt
    LIBRARY.mkdir(parents=True, exist_ok=True)
    library_lock = (LIBRARY / ".lock").open("a+b")
    library_lock.seek(0)
    try:
        msvcrt.locking(library_lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        sys.exit("This Xread library is open in another process. Close it or set XREAD_LIBRARY.")
    initialize()
    if args.open:
        Timer(0.4, webbrowser.open, args=(url,)).start()
    print(f"Xread Web  {url}", flush=True)
    server.serve_forever()
