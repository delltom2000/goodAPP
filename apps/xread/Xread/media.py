"""Download X videos, recover timed captions, and export local browser media."""

from __future__ import annotations

import html
import http.client
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4


TOOLS = Path(__file__).resolve().parent / "tools"
ALLOWED_CDN = {"cdn.syndication.twimg.com", "video.twimg.com"}


def _trusted(url):
    u = urlsplit(url)
    if u.scheme != "https" or u.hostname not in ALLOWED_CDN or u.port not in (None, 443) or u.username:
        raise ValueError("这个媒体地址不属于 X 的公开媒体服务。")
    return url


class MediaRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, _trusted(newurl))


def _open(url, headers=None):
    request = Request(_trusted(url), headers={"User-Agent": "Mozilla/5.0 Xread/1.0", **(headers or {})})
    return build_opener(MediaRedirect()).open(request, timeout=45)


def _text(url):
    for attempt in range(3):
        try:
            with _open(url) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
                if len(raw) > 16 * 1024 * 1024:
                    raise ValueError("字幕或播放清单过大。")
                return raw.decode("utf-8-sig")
        except (URLError, OSError, http.client.HTTPException):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def _download_file(url, target, progress, on_fraction=None):
    part = target.with_suffix(".part")
    expected = None
    progress("正在下载视频…")
    for attempt in range(5):
        offset = part.stat().st_size if part.exists() else 0
        try:
            with _open(url, {"Range": f"bytes={offset}-"} if offset else {}) as response:
                if response.status == 206:
                    content_range = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if not content_range or int(content_range[1]) != offset:
                        raise ValueError("视频服务器返回了不匹配的下载片段。")
                    expected = int(content_range[3])
                else:
                    offset = 0
                    length = response.headers.get("Content-Length")
                    expected = int(length) if length else None
                last = 0.0
                with part.open("ab" if offset else "wb") as output:
                    while data := response.read(1024 * 1024):
                        output.write(data)
                        offset += len(data)
                        if time.monotonic() - last >= 0.8:
                            size = f"{offset / expected:.0%}" if expected else f"{offset // (1024*1024)} MB"
                            if on_fraction and expected:
                                on_fraction(offset / expected)
                            progress(f"正在下载视频 · {size}")
                            last = time.monotonic()
            if expected is not None and offset != expected:
                raise OSError("视频下载未完整")
            if not offset:
                raise ValueError("视频文件为空。")
            part.replace(target)
            return
        except HTTPError as exc:
            if exc.code == 416 and expected and expected == offset:
                part.replace(target)
                return
            if attempt == 4 or exc.code in (401, 403, 404):
                raise
        except (OSError, http.client.HTTPException):
            if attempt == 4:
                raise
        progress("下载中断，正在续传…")
        time.sleep(min(2 ** attempt, 6))


def _tool(name, args, cwd=None):
    executable = TOOLS / (name + ".exe")
    if not executable.is_file():
        executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f"未找到 {name}。请重新解压完整应用。")
    common = ["-v", "error"]
    if name == "ffmpeg":
        common.extend(["-nostdin", "-y"])
    local_args = []
    for arg in args:
        if arg == "-i":
            local_args.extend(["-protocol_whitelist", "file,pipe", "-format_whitelist",
                               "mov,matroska,webm,avi,mpeg,mpegts,srt,webvtt,ass"])
        local_args.append(str(arg))
    result = subprocess.run([str(executable), *common, *local_args], cwd=cwd,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()[-500:]
        raise RuntimeError(f"{name} 处理媒体失败。{detail}")
    return result.stdout.decode("utf-8-sig", "replace")


def probe(path):
    return json.loads(_tool("ffprobe", ["-show_streams", "-show_format", "-of", "json", "-i", Path(path).resolve()]))


def _seconds(stamp):
    value = 0.0
    for number in stamp.replace(",", ".").split(":"):
        value = 60 * value + float(number)
    return value


def parse_captions(document, lang=""):
    rows = []
    for block in re.split(r"\n\s*\n", document.replace("\r", "").strip()):
        lines = block.splitlines()
        for index, line in enumerate(lines):
            timing = re.match(r"^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d+)", line)
            if not timing:
                continue
            start, end = map(_seconds, timing.groups())
            if end <= start:
                break
            zh, en = [], []
            for raw in lines[index+1:]:
                cleaned = html.unescape(re.sub(r"<[^>]+>|\{\\[^}]*\}", "", raw)).strip()
                if cleaned:
                    (zh if re.search(r"[\u3400-\u9fff]", cleaned) else en).append(cleaned)
            if zh or en:
                rows.append({"start": start, "end": end, "en": " ".join(en), "zh": " ".join(zh)})
            break
    return rows


def _rank_language(language):
    lang = language.lower().replace("_", "-")
    if lang in {"zh", "zh-cn", "zh-hans", "zh-hans-cn", "zho", "chi", "cmn"}:
        return 0
    if lang.startswith("zh"):
        return 1
    if lang.startswith("en"):
        return 2
    if lang in {"", "und"}:
        return 3
    return 4


def inspect_local(path):
    path = Path(path).resolve()
    streams = [stream for stream in probe(path)["streams"] if stream.get("codec_type") == "subtitle"
               and stream.get("codec_name") in {"mov_text", "subrip", "webvtt", "ass", "ssa", "text"}]
    return _select_captions(streams, lambda s: s.get("tags", {}).get("language", ""),
                            lambda s: parse_captions(_tool("ffmpeg", [
                                "-i", path, "-map", f"0:{s['index']}", "-f", "webvtt", "pipe:1"
                            ])))


def _select_captions(tracks, language, load):
    selected = []
    for track in sorted(tracks, key=lambda x: _rank_language(language(x))):
        if _rank_language(language(track)) >= 4:
            continue
        try:
            rows = load(track)
        except (ValueError, OSError, RuntimeError, http.client.HTTPException):
            continue
        if not rows:
            continue
        if not selected:
            selected = rows
        elif any(row["zh"] for row in selected):
            # Supplement Chinese with English only when the cues really align.
            english = {(round(r["start"], 2), round(r["end"], 2)): r["en"] for r in rows if r["en"]}
            for row in selected:
                if not row["en"]:
                    row["en"] = english.get((round(row["start"], 2), round(row["end"], 2)), "")
        if all(row["en"] and row["zh"] for row in selected):
            break
    return selected


def _attributes(line):
    return {name: value.strip('"') for name, value in re.findall(r'([A-Z0-9-]+)=("[^"]*"|[^,\s]+)', line)}


def _hls_rows(master_url):
    playlist = _text(master_url)
    tracks = [_attributes(line) for line in playlist.splitlines() if line.startswith("#EXT-X-MEDIA:")]
    tracks = [track for track in tracks if track.get("TYPE") == "SUBTITLES" and track.get("URI")]
    def load_track(track):
        lang = track.get("LANGUAGE", "")
        url = urljoin(master_url, track["URI"])
        subs = _text(url)
        if subs.startswith("WEBVTT"):
            rows = parse_captions(subs, lang)
        else:
            rows = []
            clock_base = None
            seen = set()
            for segment in subs.splitlines():
                if not segment.strip() or segment.startswith("#"):
                    continue
                doc = _text(urljoin(url, segment.strip()))
                stamp = re.search(r"X-TIMESTAMP-MAP=([^\n\r]+)", doc)
                delta = 0.0
                if stamp:
                    pts = re.search(r"MPEGTS:(\d+)", stamp[1])
                    local = re.search(r"LOCAL:([\d:.]+)", stamp[1])
                    if pts and local:
                        mapped = int(pts[1]) / 90000 - _seconds(local[1])
                        if clock_base is None:
                            clock_base = mapped
                        delta = mapped - clock_base
                for row in parse_captions(doc, lang):
                    row["start"] += delta
                    row["end"] += delta
                    key = (round(row["start"], 3), round(row["end"], 3), row["en"], row["zh"])
                    if key not in seen:
                        rows.append(row)
                        seen.add(key)
        return sorted(rows, key=lambda row: row["start"])
    return _select_captions(tracks, lambda t: t.get("LANGUAGE", ""), load_track)


def download_x(url, folder, progress, on_fraction=None):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    u = urlsplit(url.strip())
    match = re.fullmatch(r"/(?:[\w]+/status(?:es)?|i/(?:web/)?status)/(\d{1,22})(?:/video/(\d+))?/?", u.path)
    if u.scheme not in ("http", "https") or u.hostname not in {
        "x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"
    } or not match:
        raise ValueError("请输入完整的 X 帖子链接，例如 https://x.com/用户名/status/帖子编号。")
    post_id, index = match.groups()
    progress("正在读取 X 帖子…")
    info = json.loads(_text(f"https://cdn.syndication.twimg.com/tweet-result?id={post_id}&lang=en&token=a"))
    media = [m for m in info.get("mediaDetails", []) if m.get("video_info")]
    if not media:
        raise ValueError("此公开帖子没有可读取的视频。登录可见、已删除或受限的帖子可改用本地导入。")
    pos = int(index or 1) - 1
    if not 0 <= pos < len(media):
        raise ValueError("帖子中找不到所选视频。")
    variants = media[pos]["video_info"]["variants"]
    def quality_key(variant):
        match = re.search(r"/(\d+)x(\d+)/", variant["url"])
        resolution = min(map(int, match.groups())) if match else 0
        return (resolution > 720, abs(resolution - 720), -variant.get("bitrate", 0))
    sources = sorted((v for v in variants if v.get("content_type") == "video/mp4"), key=quality_key)
    if not sources:
        raise ValueError("这个帖子没有直连 MP4，请导入本地文件。")
    src = folder / f"x-{post_id}-{pos + 1}.mp4"
    valid_cached = False
    if src.is_file():
        try:
            valid_cached = any(s.get("codec_type") == "video" for s in probe(src)["streams"])
        except (OSError, RuntimeError):
            pass
    if not valid_cached:
        _download_file(sources[0]["url"], src, progress, on_fraction)
    rows = []
    for variant in variants:
        if "mpegurl" in variant.get("content_type", "").lower():
            progress("正在查找视频字幕…")
            try:
                rows = _hls_rows(variant["url"])
            except (ValueError, OSError, http.client.HTTPException):
                progress("播放清单字幕暂时不可用，正在检查视频文件…")
            if rows:
                break
    return src, rows or inspect_local(src), (info.get("text") or "X 视频").split("https://t.co/")[0].strip()[:160]


def _convert(destination, args, cwd=None):
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_name(f".{destination.stem}-{uuid4().hex}.mp4")
    try:
        _tool("ffmpeg", [*args, tmp], cwd=cwd)
        os.replace(tmp, destination)
    finally:
        tmp.unlink(missing_ok=True)
    return destination


def export_two_soundtracks(original, mandarin, destination):
    has_sound = any(s["codec_type"] == "audio" for s in probe(original)["streams"])
    inputs = ["-i", original, "-i", mandarin, "-map", "0:v:0",
              "-map", "0:a:0" if has_sound else "1:a:0", "-map", "1:a:0", "-c", "copy"]
    if not has_sound:
        inputs.extend(["-c:a:0", "aac", "-filter:a:0", "volume=0", "-metadata:s:a:0", "language=und"])
    return _convert(destination, [*inputs, "-disposition:a:0", "default", "-disposition:a:1", "0",
        "-metadata:s:a:0", "handler_name=原声", "-metadata:s:a:1", "handler_name=中文配音",
        "-metadata:s:a:1", "language=zho", "-movflags", "+faststart"])


def prepare_preview(source, destination):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    info = probe(source)
    streams = info["streams"]
    v = next((s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v:
        raise ValueError("文件中没有可播放的视频轨。")
    video_ok = v.get("codec_name") == "h264" and v.get("pix_fmt") in {"yuv420p", "yuvj420p"}
    audio_ok = not a or a.get("codec_name") == "aac"
    if video_ok and audio_ok and source.suffix.lower() == ".mp4" and "mp4" in info["format"]["format_name"]:
        return source
    if destination == source:
        destination = source.with_name(source.stem + "-browser.mp4")
    if destination.is_file() and destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
        return destination
    video_opts = ["-c:v", "copy"] if video_ok else [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p"
    ]
    audio_opts = ["-c:a", "copy"] if audio_ok else ["-c:a", "aac", "-b:a", "128k"]
    return _convert(destination, ["-i", source, "-map", f"0:{v['index']}", "-map", "0:a:0?",
                                  *video_opts, *audio_opts, "-movflags", "+faststart"])


def _stamp(seconds, separator):
    total = max(0, round(seconds * 1000))
    whole, ms = divmod(total, 1000)
    hours, rest = divmod(whole, 3600)
    minutes, sec = divmod(rest, 60)
    return f"{hours:02}:{minutes:02}:{sec:02}{separator}{ms:03}"


def write_subtitles(rows, folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for bilingual, label in [(False, "zh"), (True, "bilingual")]:
        for vtt, extension in [(False, "srt"), (True, "vtt")]:
            content = ["WEBVTT", ""] if vtt else []
            separator = "." if vtt else ","
            count = 0
            for row in rows:
                cn = str(row.get("zh") or "").strip()
                en = str(row.get("en") or "").strip()
                lines = [cn] if cn else []
                if bilingual and en and en != cn:
                    lines.append(en)
                if not lines:
                    continue
                start, end = float(row["start"]), float(row["end"])
                if end <= start:
                    continue
                count += 1
                if not vtt:
                    content.append(str(count))
                content.append(f"{_stamp(start, separator)} --> {_stamp(end, separator)}")
                content += [html.escape(" ".join(line.split()), quote=False) for line in lines]
                content.append("")
            target = folder / f"{label}.{extension}"
            tmp = target.with_name(f".{label}-{uuid4().hex}.tmp")
            try:
                tmp.write_text("\n".join(content) + "\n", encoding="utf-8")
                os.replace(tmp, target)
            finally:
                tmp.unlink(missing_ok=True)


def export_video(source, rows, folder, progress, burn=False):
    folder = Path(folder).resolve()
    source = Path(source).resolve()
    if not rows or not any(row.get("zh") for row in rows):
        raise ValueError("还没有可导出的中文字幕。")
    folder.mkdir(parents=True, exist_ok=True)
    write_subtitles(rows, folder)
    src = prepare_preview(source, folder / "preview.mp4")
    target = folder / ("burned.mp4" if burn else "video.mp4")
    if target == source:
        target = target.with_stem(target.stem + "-subtitled")
    if burn:
        progress("正在将中文字幕写入画面…")
        return _convert(target, ["-i", src, "-map", "0:V:0", "-map", "0:a:0?", "-vf",
                                 "subtitles=zh.srt:force_style='FontName=Microsoft YaHei,FontSize=18,Outline=1.3,MarginV=15'",
                                 "-c:v", "libx264", "-crf", "21", "-preset", "veryfast", "-c:a", "copy",
                                 "-movflags", "+faststart"], cwd=folder)
    progress("正在封装中文字幕与中英双语字幕…")
    return _convert(target, ["-i", src, "-i", folder / "zh.srt", "-i", folder / "bilingual.srt",
                             "-map", "0:V:0", "-map", "0:a:0?", "-map", "1:s:0", "-map", "2:s:0",
                             "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
                             "-metadata:s:s:0", "language=zho", "-metadata:s:s:0", "handler_name=简体中文",
                             "-metadata:s:s:1", "language=zho", "-metadata:s:s:1", "handler_name=中英双语",
                             "-disposition:s:0", "default", "-disposition:s:1", "0", "-movflags", "+faststart"])
