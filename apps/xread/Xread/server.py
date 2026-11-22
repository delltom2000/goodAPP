"""Xread personal video subtitle workbench. Run with the bundled Python on Windows."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import ContextVar
from hashlib import sha256
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
from threading import BoundedSemaphore, Lock, RLock, Timer
import time
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import build_opener, ProxyHandler
import uuid
import webbrowser

import media
import bailian
import clips
import cloud_cache
from voices import DELIVERY_STYLES, FIXED_VOICES

ROOT = Path(__file__).resolve().parent
LIBRARY = Path(os.environ.get("XREAD_LIBRARY") or
               (Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Xread" / "Library"))
request_library = ContextVar("xread_request_library")
MAX_UPLOAD = 8 * 1024**3
X_URL = re.compile(r"https?://(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)/(?:[\w]+/status|i/web/status)/(\d+)(?:[/?#].*)?", re.I)
FORMATS = {".mp4", ".mkv", ".mov", ".webm", ".m4v", ".avi", ".mpeg", ".mpg"}
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="subtitle")
caption_scan = ThreadPoolExecutor(max_workers=1, thread_name_prefix="caption-check")
clip_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="highlights")
plan_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clip-plan")
plan_slots = BoundedSemaphore(4)
post_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="highlight-posts")
clip_slots = BoundedSemaphore(8)
state_lock = RLock()
file_locks = {}
pending = []
VERSION = "2.3"
RENDER_VERSION = "2.1"
DEFAULT_VOICE = "female"
VOICES = {"auto", "low", "high", *FIXED_VOICES["standard"]}


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


def retired_link_job(folder, job):
    return job.get("source")=="youtube" and not job.get("input") and not (folder/"source.json").is_file()


def public(job):
    item = {key: job[key] for key in ("id", "title", "status", "message", "source", "duration", "count")}
    # The included sample was visually checked. Other videos may have burned-in text.
    item["detectedCaptions"] = known_picture(job) or job.get("visualCaptions") is True
    item["captionMode"] = job.get("captionMode", "auto")
    item["captionsChecked"] = known_picture(job) or "visualCaptions" in job or item["captionMode"] in {"keep","burn"}
    item["burnedCaptions"] = item["detectedCaptions"] or item["captionMode"] == "keep"
    item["created"] = job.get("created", 0)
    if job["status"] in {"error","paused"} and retired_link_job(request_library.get(LIBRARY)/job["id"],job):
        item.update(status="error",message="这个旧链接任务的来源已停用。已有视频可以通过本地文件导入。",retryUnavailable=True)
    item["canControlImport"] = bool(job.get("importRun")) and job["status"] in {"queued","working"}
    item["progress"] = job.get("progress", 100 if job["status"] == "ready" else 0)
    item["dub"] = {**dict(status="none", progress=0, message="", voice=job.get("autoVoice") or DEFAULT_VOICE,
                          quality=job.get("autoQuality", "standard"), captionMode=item["captionMode"],
                          audioMode=job.get("audioMode", "dubbed"), style=job.get("autoStyle", "natural")),
                   **{k:v for k,v in job.get("dub", {}).items() if k in {"status","progress","message","voice","quality","captionMode","audioMode","style","originalReady"}}}
    with state_lock:
        item["queuePosition"] = next((i for i, (_, identifier) in enumerate(pending, 1)
                                     if identifier == job["id"]), 0) if job["status"]=="queued" or item["dub"]["status"]=="queued" else 0
    return item


def enqueue(folder, action, *args):
    entry = (uuid.uuid4().hex, folder.name)
    def work():
        with state_lock:
            pending.remove(entry)
        if action is process:
            action(folder,*args,run=entry[0])
        else:
            action(folder,*args)
    with state_lock:
        if action is process:
            update(folder,importRun=entry[0])
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
    if value not in ("original", "dubbed", "both"):
        raise ValueError("请至少选择一种成片声音。")
    return value


def sound_options(sound, voice, quality, style="natural"):
    sound = audio_mode(sound)
    if sound == "original":
        return sound, DEFAULT_VOICE, "standard", "natural"
    if style not in DELIVERY_STYLES:
        raise ValueError("请选择自然交谈、演讲或甜美讲述。")
    return sound, voice_name(voice), quality_name(quality), style


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


def new_dub(job, voice, quality="standard", mode=None, sound=None, style="natural"):
    sound = sound or job.get("audioMode", "dubbed")
    message = {"original":"等待制作原声字幕版", "dubbed":"等待生成中文配音", "both":"等待制作原声和配音两版"}[sound]
    return dict(status="queued", message=message, progress=0, voice=voice, quality=quality, audioMode=sound,
                renderVersion=RENDER_VERSION, style=style,
                captionMode=mode or job.get("captionMode", "auto"),
                revision=job.get("revision", "."), ticket=uuid.uuid4().hex)


def film_folder(folder, dub):
    captions = "picture" if dub.get("picture") else "subtitled"
    renders = folder / dub["revision"] / "renders"
    if dub.get("audioMode") == "original":
        return renders / "original" / captions
    if dub.get("renderVersion"):
        renders = renders / dub["renderVersion"]
    audio = renders / dub["voice"] / dub.get("quality", "standard")
    if dub.get("style", "natural") != "natural":
        audio = audio / dub["style"]
    return audio / captions


class Superseded(Exception):
    """A caption edit or another render request replaced this job."""


def run_dub(folder, request):
    sound = request.get("audioMode", "dubbed")
    final_message = {"original":"原声字幕成片已就绪", "dubbed":"中文配音成片已就绪", "both":"原声和中文配音成片均已就绪"}[sound]
    def persist(**change):
        with state_lock:
            job = read(folder / "job.json")
            current = job.get("dub", {})
            if current.get("ticket") != request["ticket"]:
                raise Superseded()
            return update(folder, dub={**current, **change})
    def report(percent, message):
        nonlocal final_message
        if percent >= 100 and sound != "both":
            final_message = message
        persist(progress=max(0, min(99, int(percent))), message=message)
    try:
        job = persist(status="working", message="正在准备成片")
        rows = read(folder / request["revision"] / "cues.json")
        job = inspect_picture(folder, job, folder / job["preview"], rows)
        picture = public(job)["burnedCaptions"]
        request = {**request, "picture":picture}
        persist(picture=picture)
        import dub
        source = folder / job["preview"]
        if sound in {"original", "both"}:
            output = film_folder(folder, {**request, "audioMode":"original"})
            if not (output / "dubbed.mp4").is_file():
                original_progress = (lambda pct, msg: report(.25*pct, msg)) if sound == "both" else report
                dub.render_original(source, rows, output, original_progress, burned_captions=picture)
            if not (output / "dubbed.mp4").is_file():
                raise ValueError("原声字幕版未生成，请重试。")
            persist(originalReady=True)
        if sound in {"dubbed", "both"}:
            output = film_folder(folder, request)
            if not (output / "dubbed.mp4").is_file():
                voice_progress = (lambda pct, msg: report(25+.75*pct, msg)) if sound == "both" else report
                dub.render(source, rows, output, request["voice"], voice_progress,
                           burned_captions=picture,
                           cache_dir=folder / "voice-cache" / request["voice"] / request["quality"],
                           quality=request["quality"], style=request.get("style", "natural"))
            if not (output / "dubbed.mp4").is_file():
                raise ValueError("中文配音版未生成，请重试。")
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


def process(folder, *, run=None):
    percent = 0

    def check():
        if run is not None:
            current=read(folder/"job.json")
            if current.get("importRun")!=run or current["status"] in {"paused","stopped"}:
                raise Superseded()

    def persist(**changes):
        with state_lock:
            check()
            return update(folder,**changes)

    def report(message):
        persist(message=str(message),progress=percent)

    def advance(value):
        nonlocal percent
        check()
        percent = max(percent, min(99, int(value)))
    try:
        job = persist(status="working",progress=1,message="正在读取视频")
        advance(1)
        cache = folder / "source.json"
        if retired_link_job(folder,job):
            raise ValueError("这个旧链接任务的来源已停用。已有视频可以通过本地文件导入。")
        if cache.exists():
            meta = read(cache)
            source = folder / meta["file"]
            rows = meta["rows"]
        else:
            if job["source"] == "x":
                source, rows, title = media.download_x(job["url"],folder,report,lambda n: advance(2+22*n))
                persist(title=title or job["title"])
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
        persist(preview=preview.name,duration=length)
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
            request = new_dub(job, job["autoVoice"], job.get("autoQuality", "standard"),
                              style=job.get("autoStyle", "natural")) if job.get("autoVoice") else None
            persist(count=len(rows),status="ready",progress=100,message="字幕已就绪",
                   **({"dub":request} if request else {}))
        if request:
            run_dub(folder, request)
    except Superseded:
        return
    except Exception as exc:
        try:
            persist(status="error",message=str(exc)[:1400] or "任务处理失败")
        except Superseded:
            pass


def initialize(library=None):
    library = library or LIBRARY
    library.mkdir(parents=True, exist_ok=True)
    for path in sorted(library.glob("*/job.json"), key=lambda p:read(p).get("created", 0)):
        job = read(path)
        highlights = job.get("highlights", {})
        if highlights.get("status") in {"queued", "working"}:
            update(path.parent, highlights={**highlights, "status":"error",
                "message":"切片在服务重启时中断。点击「从断点继续」恢复。"})
        plan = clip_plan_status(job)
        if plan.get("status") in {"queued","working"}:
            update(path.parent,clipPlan={**plan,"status":"error","message":"方案生成中断，可重新发送给 Agent。"})
        if job["status"] in {"queued", "working"}:
            if job["source"] == "cache":
                connection = cloud_cache.configuration()
                if connection:
                    enqueue(path.parent, restore_cloud, connection, job["restoreCode"])
                else:
                    update(path.parent, status="error", message="云端续存当前未配置。")
            elif job["source"] == "file" and not (path.parent / job["input"]).is_file():
                update(path.parent, status="error", message="上次上传未完成，请重新选择文件。")
            else:
                update(path.parent, status="queued", message="恢复上次任务")
                enqueue(path.parent, process)
        elif job.get("dub", {}).get("status") in {"queued", "working"}:
            request = new_dub(job, job["dub"]["voice"], job["dub"].get("quality", "standard"),
                              sound=job["dub"].get("audioMode", "dubbed"), style=job["dub"].get("style", "natural"))
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


def highlight_status(job):
    state = job.get("highlights", {})
    if state and state.get("revision") != job.get("revision", "."):
        return {"status":"stale", "message":"字幕已修改，可用最新字幕重新生成切片。"}
    return state


def clip_plan_status(job):
    plan=job.get("clipPlan",{})
    return plan if plan.get("revision")==job.get("revision",".") else {}


def requested_clip_count(message):
    amounts={"一":1,"两":2,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10}
    matches=re.findall(r"(?:^\s*|(?:整理[成为]|拆[成为]|切[成为]|做[成为]|剪[成为]|生成|重点|做|出|要|留)\s*)"
                       r"(\d{1,2}|十[一二三四五]|[一两二三四五六七八九十])\s*[个条部段]?\s*(?:视频|片段|切片|短片|片)",
                       message)
    if not matches:
        return None
    value=matches[-1]
    number=int(value) if value.isdecimal() else 10+amounts[value[1]] if len(value)==2 else amounts[value]
    return number if 1<=number<=15 else None


def run_clip_plan(folder, job, plan, key, previous):
    def report(message, **fields):
        with state_lock:
            current=clip_plan_status(read(folder/"job.json"))
            if current.get("ticket")!=plan["ticket"]:
                raise Superseded()
            plan.update(fields,message=message)
            update(folder,clipPlan=plan)

    def progress(_, message):
        report(message)

    try:
        report("正在读取字幕并整理剪辑方案",status="working")
        revision=folder/plan["revision"]
        rows=clips.text_rows(read(revision/"cues.json"),job["duration"])
        if not rows:
            raise ValueError("当前任务没有可分析的字幕。")
        chapter_file=revision/"clip-plan-chapters.json"
        chapters=read(chapter_file) if chapter_file.is_file() else []
        checkpoint={"chapters":chapters}
        saved_chapters=len(chapters)
        def persist():
            nonlocal saved_chapters
            if len(chapters)!=saved_chapters:
                save(chapter_file,chapters)
                saved_chapters=len(chapters)
        discussion={"requests":[turn["text"] for turn in plan["turns"] if turn["role"]=="user"],
                    "parameters_changed":bool(previous) and (plan["count"]!=plan["previousCount"] or plan["mode"]!=plan["previousMode"]),
                    "explicit_count":plan.get("explicitCount"),"default_mode":plan["mode"],
                    "previous":[{k:c[k] for k in ("title","ranges")} for c in previous]}
        suggestion=clips.propose(rows,job["duration"],plan["count"],key,plan["model"],progress,
                                 plan["mode"],checkpoint=checkpoint,persist=persist,source_title=job.get("title",""),
                                 discussion=discussion)
        reply=checkpoint.get("reply")
        if checkpoint.get("answer_only"):
            plan["turns"]=[*plan["turns"],{"role":"agent","text":reply}][-12:]
            report("原方案可继续确认。",status="ready",clips=previous,count=plan["previousCount"],mode=plan["previousMode"])
            return
        plan.update(count=checkpoint["plan_count"],mode=checkpoint["plan_mode"])
        if not reply:
            reply="我根据字幕整理了下列观点和时间段。" if suggestion else "目前没有找到符合要求的独立片段。"
        if len(suggestion)<plan["count"]:
            reply+=f"\n\n目前排出 {len(suggestion)} / {plan['count']} 片符合 2–5 分钟的时间线。你可以继续指定要保留或调整的内容。"
        plan["turns"]=[*plan["turns"],{"role":"agent","text":reply}][-12:]
        report("方案已就绪，请核对后确认" if suggestion else "没有符合要求的 2–5 分钟片段，可以调整要求再试。",
               status="ready",clips=suggestion)
    except Superseded:
        pass
    except Exception as error:
        try:
            report(str(error)[:240] if isinstance(error,ValueError) else "剪辑方案生成失败，请重试。",status="error")
        except Superseded:
            pass
    finally:
        plan_slots.release()


HIGHLIGHT_SOURCES = {"source":"原始视频", "original":"原声字幕版", "dubbed":"中文配音版"}


def highlight_inputs(folder, job):
    if job.get("status") != "ready" or not job.get("preview"):
        return {}
    inputs = {"source":folder / job["preview"]}
    film = job.get("dub", {})
    if film.get("revision") == job.get("revision", "."):
        mode = film.get("audioMode", "dubbed")
        ready = film.get("status") == "ready"
        if mode in {"both","original"} and (film.get("originalReady") or mode=="original" and ready):
            inputs["original"] = film_folder(folder, {**film,"audioMode":"original"}) / "dubbed.mp4"
        if mode in {"both","dubbed"} and ready:
            inputs["dubbed"] = film_folder(folder, film) / "dubbed.mp4"
    return {variant:path for variant,path in inputs.items() if path.is_file()}


def restore_cloud(folder, connection, code):
    try:
        update(folder, status="working", message="正在读取云端字幕、视频与切片")
        job = cloud_cache.Snapshot(connection, code).restore(folder)
        save(folder / "job.json", job)
    except FileNotFoundError:
        update(folder, status="error", message="找不到云端断点，请确认恢复链接已完成备份。")
    except Exception:
        update(folder, status="error", message="云端任务恢复失败，请重新打开恢复链接重试。")


def write_highlight_post(item, rows, key, model, current, source_title, source_url):
    gateway = bailian.Gateway(key,model,current=current)
    post, length = clips.write_post(item, rows, key, model, gateway=gateway,
                                    source_title=source_title, source_url=source_url)
    return post, length, gateway.model


def run_highlights(folder, job, request, key):
    def report(percent, message, **fields):
        request.update(fields, progress=max(request["progress"], percent), message=message)
        update(folder, highlights=request)

    def switch_model(previous, selected, reason):
        report(request["progress"], "正在切换百炼模型",
               actualModel=selected, modelNotice=f"{previous} 不可用，已切换至 {selected}。{reason}")

    try:
        report(request["progress"], "正在准备字幕", status="working")
        variant = request.get("videoSource", "source")
        source = folder / request.get("videoPath", job["preview"])
        if not source.is_file():
            raise ValueError("所选视频已找不到，请重新选择切片来源。")
        rows = clips.text_rows(read(folder / request["revision"] / "cues.json"), job["duration"])
        if not rows:
            raise ValueError("当前任务没有可分析的字幕。")
        model = request["model"]
        gateway = bailian.Gateway(key,model,switch_model,current=request.get("actualModel"))
        report(request["progress"],"正在分析字幕",actualModel=gateway.model)
        output = folder / "highlights" / request["ticket"]
        checkpoint_path = output / "analysis.json"
        connection = cloud_cache.configuration() if request.get("cloudToken") else None
        snapshot = cloud_cache.Snapshot(connection, request["cloudToken"]) if connection else None

        def save_cloud():
            if not snapshot:
                return
            try:
                caption_dir = folder / request["revision"]
                paths = {source, folder / job["preview"], checkpoint_path}
                paths.update(p for p in caption_dir.iterdir() if p.suffix in {".srt", ".vtt"} or p.name == "cues.json")
                for item in request["clips"]:
                    if item.get("videoReady"):
                        target = output / f"clip-{item['id']:02d}"
                        paths.update(target / name for name in ("clip.mp4","zh.srt","post.txt"))
                state = {k:v for k,v in request.items() if k not in {"cloudToken","cloudStatus","cloudSavedAt"}}
                metadata = {k:v for k,v in job.items() if k != "restoreCode"}
                metadata["highlights"] = state
                if variant == "source":
                    metadata.pop("dub",None)
                else:
                    metadata["dub"] = {**job["dub"], "status":"ready", "audioMode":variant,
                                       "originalReady":variant=="original"}
                snapshot.save(folder, metadata, sorted(p for p in paths if p.is_file()))
                request.update(cloudStatus="saved",cloudSavedAt=time.time())
            except (OSError, ValueError):
                request["cloudStatus"] = "error"
            update(folder, highlights=request)

        def save_analysis():
            save(checkpoint_path, checkpoint)
            save_cloud()

        if snapshot:
            report(request["progress"], "正在云端备份所选视频与字幕")
            save_cloud()
        items = request["clips"]
        if not items:
            output.mkdir(parents=True, exist_ok=True)
            checkpoint = read(checkpoint_path) if checkpoint_path.is_file() else {}
            items = clips.propose(rows, job["duration"], request["count"], key, model, report,
                                  mode=request.get("mode","chronological"),gateway=gateway,
                                  checkpoint=checkpoint,persist=save_analysis,
                                  source_title=job.get("title",""))
            items = [{**item, "id":i} for i,item in enumerate(items,1)]
            report(30, f"已选出 {len(items)} 个片段", clips=items)
            save_cloud()
        source_url = job.get("url", "")
        if job.get("source") == "x" and X_URL.fullmatch(source_url):
            source_url = urlsplit(source_url)._replace(query="",fragment="").geturl()
        else:
            source_url = ""
        baked = variant != "source"
        if not baked:
            checked = inspect_picture(folder, job, source, rows)
            baked = known_picture(checked) or checked.get("visualCaptions") is True or checked.get("captionMode") == "keep"
        for i, item in enumerate(items):
            progress = round(30+30*i/len(items))
            target = output / f"clip-{item['id']:02d}"
            if not (item.get("videoReady") and (target / "clip.mp4").is_file() and (target / "zh.srt").is_file()):
                report(max(request["progress"],progress), f"正在剪辑{HIGHLIGHT_SOURCES[variant]} · {i+1}/{len(items)}")
                if not ((target / "clip.mp4").is_file() and (target / "zh.srt").is_file()):
                    clips.export_clip(source, target, item, rows, baked)
                item["videoReady"] = True
                report(max(request["progress"],round(30+30*(i+1)/len(items))), f"片段 {i+1} 已可预览和下载")
                save_cloud()
        pending_posts = {}
        for item in items:
            target = output / f"clip-{item['id']:02d}"
            if item.get("post") and (target / "post.txt").is_file():
                item["ready"] = True
                item.pop("postError",None)
                continue
            item.update(ready=False)
            item.pop("postError",None)
            pending_posts[post_pool.submit(write_highlight_post, item.copy(), rows, key, model, gateway.model,
                                           job.get("title",""),source_url)] = item
        reviewed = len(items) - len(pending_posts)
        report(round(60+35*reviewed/len(items)), f"正在生成 X 长帖 · {reviewed}/{len(items)} 篇就绪")
        for future in as_completed(pending_posts):
            item = pending_posts[future]
            try:
                post, length, post_model = future.result()
                target = output / f"clip-{item['id']:02d}"
                draft_path = target / "post.txt"
                staging = draft_path.with_suffix(".tmp")
                staging.write_text(post + "\n", encoding="utf-8")
                staging.replace(draft_path)
                item.update(post=post,length=length,postModel=post_model,ready=True)
            except ValueError as exc:
                item["postError"] = str(exc)[:240]
            except Exception:
                item["postError"] = "此篇长帖处理失败，可从断点继续。"
            reviewed += 1
            ready = sum(bool(clip.get("ready")) for clip in items)
            report(round(60+35*reviewed/len(items)), f"已生成 {ready}/{len(items)} 篇 X 长帖")
            save_cloud()
        missing = sum(not item.get("ready") for item in items)
        if missing:
            report(95, f"视频已就绪，{missing} 篇长帖待补写。点击「从断点继续」只补写这些长帖。", status="error")
            save_cloud()
            return
        clips.bundle(output, items)
        message = f"{len(items)} 个视频和 X 长帖已就绪"
        if items[0].get("whole"):
            message = "全片和 X 长帖已就绪（拆开后无法独立讲完整，保留为一条）"
        elif len(items) < request["count"]:
            message += f"（目标 {request['count']} 片，只有 {len(items)} 片能独立讲完整）"
        if snapshot:
            request.update(progress=100, message=message, status="ready")
            save_cloud()
        else:
            report(100, message, status="ready")
    except bailian.GatewayError as exc:
        report(request["progress"], str(exc), status="error")
    except ValueError as exc:
        report(request["progress"], str(exc)[:240], status="error")
    except Exception:
        report(request["progress"], "切片导出失败，请重试。已生成的长帖会保留。", status="error")
    finally:
        clip_slots.release()


def highlight_asset(folder, path):
    parts = path.split("/")
    state = highlight_status(read(folder / "job.json"))
    if state.get("ticket") != parts[0]:
        raise FileNotFoundError
    output = folder / "highlights" / parts[0]
    if parts[1:] == ["highlights.zip"] and state.get("status") == "ready":
        return output / parts[1]
    if len(parts)==3 and parts[2] in {"clip.mp4", "post.txt", "zh.srt"}:
        for item in state.get("clips", []):
            ready = item.get("ready") if parts[2] == "post.txt" else item.get("videoReady") or item.get("ready")
            if ready and parts[1] == f"clip-{item['id']:02d}":
                return output / parts[1] / parts[2]
    raise FileNotFoundError


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

    def highlight_key(self):
        return bailian.configured_key()

    def highlight_login_required(self):
        return False

    def supplied_highlight_key(self, given_key):
        return given_key or self.highlight_key()

    def clip_access_key(self, data):
        given_key = data.get("key", "")
        if not isinstance(given_key, str):
            raise ValueError("请输入百炼 API Key。")
        key = self.supplied_highlight_key(given_key.strip())
        if not re.fullmatch(r"[!-~]{8,8192}", key):
            raise ValueError("请输入有效的百炼 API Key。")
        return key

    def clip_settings(self, data):
        count,model,mode=data.get("count",3),data.get("model",bailian.AUTO),data.get("mode","chronological")
        if type(count) is not int or not 1<=count<=15 or model not in bailian.MODEL_CHOICES or mode not in ("chronological","montage"):
            raise ValueError("请选择剪辑方式、百炼模型以及 1–15 个片段。")
        return count,model,mode,self.clip_access_key(data)

    def start_clip_plan(self, folder):
        data=self.body()
        key=self.clip_access_key(data)
        message=data.get("message","")
        if not isinstance(message,str) or len(message)>1500:
            raise ValueError("每条剪辑要求最多 1500 字。")
        with state_lock:
            job=read(folder/"job.json")
            if job["status"]!="ready":
                raise ValueError("请等中文字幕就绪后再讨论。")
            if highlight_status(job).get("status") in {"queued","working"}:
                raise ValueError("请等当前切片任务结束后再调整方案。")
            previous=clip_plan_status(job)
            if previous.get("status") in {"queued","working"}:
                return self.reply(previous,202)
            turns=previous.get("turns",[])
            if message.strip():
                turns=[*turns,{"role":"user","text":message.strip()}]
            requested=data.get("count")
            explicit=requested_clip_count(message)
            count=explicit or (requested if type(requested) is int and 1<=requested<=15 else previous.get("count",3))
            mode=data.get("mode")
            if mode not in ("chronological","montage"):
                mode=previous.get("mode","montage")
            model=data.get("model")
            if model not in bailian.MODEL_CHOICES:
                model=bailian.AUTO
            plan={"ticket":uuid.uuid4().hex,"revision":job.get("revision","."),
                  "status":"queued","message":"已排队，等待 Agent 读字幕","turns":turns[-11:],
                  "count":count,"mode":mode,"model":model,"clips":previous.get("clips",[]),"explicitCount":explicit,
                  "previousCount":previous.get("count"),"previousMode":previous.get("mode")}
            if not plan_slots.acquire(blocking=False):
                return self.reply({"error":"剪辑讨论队列已满，请稍后再试。"},429)
            try:
                update(folder,clipPlan=plan)
                plan_pool.submit(run_clip_plan,folder,job,plan,key,plan["clips"])
            except Exception:
                plan_slots.release()
                raise
        return self.reply(clip_plan_status(read(folder/"job.json")),202)

    def start_highlights(self, folder):
        data = self.body()
        count,model,mode,key=self.clip_settings(data)
        variant=data.get("videoSource","source")
        if not isinstance(variant,str) or variant not in HIGHLIGHT_SOURCES:
            raise ValueError("请选择原始视频、原声字幕版或中文配音版。")
        use_cloud=data.get("cloud") is True
        if use_cloud and not cloud_cache.configuration():
            raise ValueError("当前服务尚未配置 CloudBase 云端续存。")
        plan_ticket=data.get("planTicket")
        with state_lock:
            job = read(folder / "job.json")
            if job["status"] != "ready":
                raise ValueError("请等中文字幕就绪后再切片。")
            previous = job.get("highlights", {})
            if previous.get("status") in {"queued","working"}:
                return self.reply(highlight_status(job))
            plan=clip_plan_status(job)
            if plan.get("status") in {"queued","working"}:
                raise ValueError("请等剪辑方案完成后再确认切片。")
            revision = job.get("revision", ".")
            source = highlight_inputs(folder,job).get(variant)
            if source is None:
                raise ValueError("所选视频还未就绪，请等该成片完成后再生成切片。")
            video_path = source.relative_to(folder).as_posix()
            if (previous.get("status") == "error" and previous.get("revision") == revision
                    and previous.get("editorialVersion") == clips.EDITORIAL_VERSION
                    and previous.get("count") == count
                    and previous.get("planTicket")==plan_ticket
                    and previous.get("videoSource","source") == variant
                    and previous.get("videoPath",job["preview"]) == video_path
                    and previous.get("mode","chronological") == mode):
                request = {**previous, "status":"queued", "message":"等待继续切片", "model":model}
                if model != bailian.AUTO and previous.get("model") != model:
                    request.pop("actualModel", None)
                    request.pop("modelNotice", None)
                if model == bailian.AUTO and previous.get("message","").startswith("网关输出被截断"):
                    last = previous.get("actualModel") or previous.get("model")
                    selected = next(candidate for candidate in bailian.MODELS if candidate != last)
                    request.update(actualModel=selected, modelNotice=f"{last} 上一轮输出被截断，续跑已自动切换至 {selected}。")
            else:
                request = {"status":"queued", "message":"等待识别精彩片段", "progress":0, "clips":[],
                           "ticket":uuid.uuid4().hex, "revision":revision, "model":model, "count":count,"mode":mode,
                           "editorialVersion":clips.EDITORIAL_VERSION,"videoSource":variant,"videoPath":video_path}
                if plan_ticket is not None:
                    if (plan.get("ticket")!=plan_ticket or plan.get("status")!="ready" or not plan.get("clips")
                            or plan["count"]!=count or plan["mode"]!=mode):
                        raise ValueError("方案已失效，或片数和剪辑方式已调整。请先更新方案。")
                    request.update(planTicket=plan_ticket,clips=[{**clip,"id":i} for i,clip in enumerate(plan["clips"],1)],
                                   message="已确认方案，等待剪辑",progress=30)
            if use_cloud and not request.get("cloudToken"):
                request.update(cloudToken=uuid.uuid4().hex+uuid.uuid4().hex, cloudStatus="pending")
            elif not use_cloud:
                for field in ("cloudToken","cloudStatus","cloudSavedAt"):
                    request.pop(field,None)
            if not clip_slots.acquire(blocking=False):
                return self.reply({"error":"切片队列已满，请稍后再试。"}, 429)
            try:
                update(folder, highlights=request)
                clip_pool.submit(run_highlights, folder, job, request, key)
            except Exception:
                clip_slots.release()
                raise
        return self.reply(highlight_status(read(folder / "job.json")), 202)

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

    def upload_info(self):
        title = Path(unquote(self.headers.get("X-Filename", ""))).name[:200]
        ext = Path(title).suffix.lower()
        if ext not in FORMATS:
            raise ValueError("请选择 MP4、MOV、MKV、WebM 等视频文件。")
        length = int(self.headers.get("Content-Length","0"))
        if not 0 < length <= MAX_UPLOAD:
            raise ValueError("视频必须大于 0 字节，且不超过 8 GB。")
        return title, ext, length

    def receive_video(self, folder, filename, length):
        partial = folder / "upload.part"
        try:
            with partial.open("wb") as handle:
                while length:
                    data = self.rfile.read(min(1024**2,length))
                    if not data:
                        raise ValueError("上传中断，请重新选择文件。")
                    handle.write(data)
                    length -= len(data)
            partial.replace(folder / filename)
        except Exception:
            partial.unlink(missing_ok=True)
            update(folder, status="error", message="上传中断，请重新选择文件。")
            raise

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
        if len(parts) == 4 and parts[:2] == ["api","jobs"] and parts[3] == "highlights":
            folder = open_job(parts[2])
            locked = self.highlight_login_required()
            job = read(folder / "job.json")
            inputs = highlight_inputs(folder,job)
            state = {} if locked else highlight_status(job)
            if state.get("actualModel") and state["actualModel"] not in bailian.MODELS:
                state = {**state, "actualModel":"", "modelNotice":""}
            if state.get("status") == "error":
                path = inputs.get(state.get("videoSource", "source"))
                state = {**state, "canResume":path is not None
                         and state.get("editorialVersion") == clips.EDITORIAL_VERSION
                         and path.relative_to(folder).as_posix() == state.get("videoPath", job.get("preview"))}
            return self.reply({"models":bailian.MODEL_CHOICES, "hasKey":bool(self.highlight_key()),
                               "requiresLogin":locked,"plan":{} if locked else clip_plan_status(job),
                               "cloudAvailable":cloud_cache.configuration() is not None,
                               "sources":[{"id":variant,"label":label,"ready":variant in inputs}
                                          for variant,label in HIGHLIGHT_SOURCES.items()],
                               "state":state})
        if len(parts) in (4,5) and parts[0] == "clips":
            folder = open_job(parts[1])
            target = highlight_asset(folder, "/".join(parts[2:]))
            download = parse_qs(urlsplit(self.path).query).get("download") == ["1"]
            if len(parts) == 5:
                name = parts[-2] + "-" + target.name
            else:
                name = "xread-highlights.zip"
            return self.serve(target, name if download else None)
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
            if name in {"original-film.mp4", "original-film-download.mp4"}:
                film = job.get("dub", {})
                available = film.get("originalReady") or (film.get("audioMode") == "original" and film.get("status") == "ready")
                if not available or film.get("revision") != job.get("revision", "."):
                    raise ValueError("请先生成当前字幕的原声版。")
                output = film_folder(folder, {**film,"audioMode":"original"}) / "dubbed.mp4"
                return self.serve(output, f"Xread-{folder.name[:8]}-original-audio.mp4" if "download" in name else None)
            if name == "dual-audio.mp4":
                film = job.get("dub", {})
                if (film.get("audioMode") != "both" or film.get("status") != "ready"
                        or film.get("revision") != job.get("revision", ".")):
                    raise ValueError("请先勾选原声和中文配音，完成两版制作。")
                dubbed = film_folder(folder, film)
                target = dubbed / "dual-audio.mp4"
                with artifact_lock(folder):
                    if not target.exists():
                        original = film_folder(folder, {**film,"audioMode":"original"}) / "dubbed.mp4"
                        media.export_two_soundtracks(original, dubbed / "dubbed.mp4", target)
                return self.serve(target, f"Xread-{folder.name[:8]}-dual-audio.mp4")
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
        if path == "/api/cloud/restore":
            connection = cloud_cache.configuration()
            if not connection:
                raise ValueError("当前服务尚未配置 CloudBase 云端续存。")
            if int(self.headers.get("Content-Length", "0")) > 4096:
                raise ValueError("恢复链接过长。")
            code = self.body().get("code")
            if not isinstance(code,str) or not cloud_cache.TOKEN.fullmatch(code):
                raise ValueError("云端恢复链接无效。")
            digest = sha256(code.encode("ascii")).hexdigest()
            with state_lock:
                library = request_library.get(LIBRARY)
                for file in library.glob("*/job.json"):
                    prior = read(file)
                    if prior.get("restoreDigest") == digest and prior.get("status") in {"queued","working","ready"}:
                        return self.reply(public(prior))
                folder = new_job("cache","云端切片任务",restoreCode=code,restoreDigest=digest)
                enqueue(folder,restore_cloud,connection,code)
            return self.reply(public(read(folder / "job.json")),202)
        if self.headers.get("X-Xread") != "1" or not self.valid_origin():
            raise PermissionError("请从本机 Xread 工作台提交任务。")
        if path == "/api/upload":
            title, ext, length = self.upload_info()
            sound, selected, quality, style = sound_options(self.headers.get("X-Audio-Mode", "dubbed"),
                self.headers.get("X-Voice", DEFAULT_VOICE), self.headers.get("X-Quality", "standard"),
                self.headers.get("X-Style", "natural"))
            mode = caption_mode(self.headers.get("X-Caption-Mode", "auto"))
            folder = new_job("file", title, input="upload" + ext, autoVoice=selected, autoQuality=quality,
                             captionMode=mode, audioMode=sound, autoStyle=style)
            update(folder, message="正在接收本地文件")
            self.receive_video(folder,"upload"+ext,length)
        elif path == "/api/jobs":
            data = self.body()
            url = data.get("url")
            url = url.strip() if isinstance(url,str) else ""
            match = X_URL.fullmatch(url)
            if not match:
                raise ValueError("请输入有效的 X 帖子链接。")
            sound, voice, quality, style = sound_options(data.get("audioMode", "dubbed"),
                data.get("voice", DEFAULT_VOICE), data.get("quality", "standard"), data.get("style", "natural"))
            folder = new_job("x", f"X 视频 · {match[1]}", url=url, autoVoice=voice,
                             autoQuality=quality, autoStyle=style, captionMode=caption_mode(data.get("captionMode", "auto")), audioMode=sound)
        else:
            match = re.fullmatch(r"/api/jobs/([^/]+)/(retry|pause|stop|cues|dub|highlights|clip-plan)", path)
            if not match:
                raise FileNotFoundError
            folder = open_job(match[1])
            if match[2] == "highlights":
                return self.start_highlights(folder)
            if match[2]=="clip-plan":
                return self.start_clip_plan(folder)
            if match[2] in {"pause","stop"}:
                with state_lock:
                    job = read(folder/"job.json")
                    allowed = {"queued","working","paused"} if match[2]=="stop" else {"queued","working"}
                    if not job.get("importRun") or job["status"] not in allowed:
                        raise ValueError("当前任务无法执行这个操作。")
                    status,message = ("paused","已暂停，等待手动继续") if match[2]=="pause" else ("stopped","已停止")
                    return self.reply(public(update(folder,status=status,message=message)))
            if match[2] == "dub":
                data = self.body()
                sound, voice, quality, style = sound_options(data.get("audioMode", "dubbed"),
                    data.get("voice", DEFAULT_VOICE), data.get("quality", "standard"), data.get("style", "natural"))
                with state_lock:
                    job = read(folder / "job.json")
                    mode = caption_mode(data.get("captionMode", job.get("captionMode", "auto")))
                    if job["status"] != "ready":
                        raise ValueError("请等待中文字幕完成后再配音。")
                    previous = job.get("dub", {})
                    if (previous.get("status") in {"queued", "working", "ready"} and
                        previous.get("audioMode","dubbed") == sound and
                        (previous.get("renderVersion") == RENDER_VERSION or sound == "original") and
                        (sound == "original" or (previous.get("voice") == voice and previous.get("quality","standard") == quality
                                                 and previous.get("style","natural") == style))
                        and mode == previous.get("captionMode", "auto")
                        and previous.get("revision") == job.get("revision", ".")):
                        return self.reply(public(job))
                    if previous.get("status") in {"queued","working"}:
                        raise ValueError("当前配音任务尚未完成，请稍后更换音色。")
                    request = new_dub(job, voice, quality, mode, sound, style)
                    job = update(folder, dub=request, captionMode=mode, audioMode=sound)
                    enqueue(folder, run_dub, request)
                    return self.reply(public(job), 202)
            elif match[2] == "retry":
                with state_lock:
                    job = read(folder/"job.json")
                    if retired_link_job(folder,job):
                        raise ValueError("这个旧链接任务的来源已停用。")
                    if job["status"] not in {"error","paused"}:
                        raise ValueError("只能重试未完成的任务。")
                    update(folder,status="queued",message="等待继续" if job["status"]=="paused" else "等待重试",importRun=None)
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
                                                  quality=old.get("quality", "standard"), style=old.get("style", "natural"),
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
