"""Create a single-track Mandarin video from a saved subtitle timeline."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import unicodedata
import wave
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import numpy as np

import media

RATE = 24000
FFMPEG = media.TOOLS / "ffmpeg.exe"
CREATE_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)
CACHE_VERSION = "3-clean-24k"


def _get_cues(rows, duration, speech=True):
    cues = []
    for row in rows:
        text = " ".join(str(row.get("zh") or "").split())
        start, end = float(row["start"]), float(row["end"])
        if not (math.isfinite(start) and math.isfinite(end)):
            raise ValueError("字幕时间包含无效数值。")
        start, end = max(start, 0.0), min(end, duration)
        if text and end > start and (not speech or any(char.isalnum() for char in text)):
            cues.append(dict(row, start=start, end=end, zh=text))
    cues.sort(key=lambda r: r["start"])
    if not cues:
        raise ValueError("没有可配音的中文字幕。")
    return cues


def _validate_audio(samples):
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim != 1 or samples.size < 16 or not np.all(np.isfinite(samples)):
        raise ValueError("语音引擎返回了无效的音频。")
    if np.max(np.abs(samples)) < 0.0001:
        raise ValueError("语音引擎生成了空白音频。")
    return samples


def _normalize(samples, rate):
    samples = _validate_audio(samples)
    # Remove DC and sub-bass before measuring speech level or trimming tails.
    # Resample once, before time stretching; use the bundled swresample filter
    # with a longer interpolation kernel for a narrow-band synthesizer.
    cmd = [str(FFMPEG), "-nostdin", "-v", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1",
           "-i", "pipe:0", "-af", f"highpass=f=48:p=2,aresample={RATE}:filter_size=64:kaiser_beta=10:cutoff=0.95",
           "-f", "f32le", "pipe:1"]
    processed = subprocess.run(cmd, input=np.asarray(samples, dtype="<f4").tobytes(), stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, creationflags=CREATE_FLAGS)
    if processed.returncode:
        raise ValueError("语音重采样失败。" + processed.stderr.decode("utf8", "replace")[-300:])
    samples = _validate_audio(np.frombuffer(processed.stdout, dtype="<f4"))
    block = RATE // 100
    squared = np.pad(samples.astype(np.float64)**2, (0, (-len(samples)) % block))
    energy = np.sqrt(squared.reshape(-1, block).mean(axis=1))
    threshold = min(0.005, max(0.0012, np.max(energy) * 0.009))
    active = np.flatnonzero(energy >= threshold)
    if len(active):
        samples = samples[max(0, (active[0] - 5)*block):min(len(samples), (active[-1] + 7)*block)]
    # An active speech measurement avoids boosting long pauses and hiss.
    active_rms = float(np.sqrt(np.mean(energy[active]**2))) if len(active) else threshold
    peak = float(np.max(np.abs(samples)))
    gain = min(0.81 / max(peak, 0.001), 1.65, 0.100 / max(active_rms, 0.001))
    pcm = samples * gain
    fade = min(len(pcm)//2, int(RATE * 0.012))
    if fade:
        pcm[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
        pcm[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    return np.rint(pcm * 32767).astype("<i2").tobytes()


def _get_clip(folder, key, row, get_synth):
    clip = folder / (key + ".wav")
    if clip.is_file():
        try:
            with wave.open(str(clip), "rb") as saved:
                if saved.getsampwidth() == 2 and saved.getnchannels() == 1 and saved.getnframes() > 0:
                    n = saved.getnframes()
                    saved.setpos(n - 1)
                    if len(saved.readframes(1)) == 2:
                        return clip, n / saved.getframerate()
        except (OSError, ValueError, EOFError, wave.Error):
            pass
    rate, samples = get_synth().render(row["zh"], row)
    rate = int(rate)
    if not 4000 <= rate <= 192000:
        raise ValueError("语音引擎返回了无效的采样率。")
    pcm = _normalize(samples, rate)
    with tempfile.NamedTemporaryFile(dir=folder, suffix=".tmp", delete=False) as handle:
        tmp = Path(handle.name)
    try:
        with wave.open(str(tmp), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes(pcm)
        os.replace(tmp, clip)
    finally:
        tmp.unlink(missing_ok=True)
    return clip, len(pcm) / (RATE * 2)


def _fit_clip(clip, duration, available):
    # FFmpeg's overlap-add tempo filter retains pitch. Add a small guard at the
    # boundaries because the filter's chosen windows vary with the waveform.
    available_seconds = available / RATE
    if available_seconds <= 0:
        raise ValueError("部分字幕没有配音时间。请合并相同时刻的字幕后重试。")
    with wave.open(str(clip), "rb") as wav:
        if wav.getframerate() == RATE and wav.getnframes() <= available:
            return wav.readframes(wav.getnframes())
    speed = max(1.0, duration / max(0.04, available_seconds - 0.035))
    for _ in range(4):
        # Supply a short quiet tail to flush WSOLA's final overlap window.
        filters = ["apad=pad_dur=0.055"]
        factor = speed
        while factor > 2:
            filters.append("atempo=2")
            factor /= 2
        if factor > 1.001:
            filters.append(f"atempo={factor:.7f}")
        cmd = [str(FFMPEG), "-nostdin", "-v", "error", "-i", str(clip)]
        cmd.extend(["-af", ",".join(filters)])
        cmd += ["-ar", str(RATE), "-ac", "1", "-f", "s16le", "pipe:1"]
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=CREATE_FLAGS)
        if out.returncode:
            raise RuntimeError("语音时间对齐失败。" + out.stderr.decode("utf8", "replace")[-300:])
        pcm = np.frombuffer(out.stdout, dtype="<i2").copy()
        active = np.flatnonzero(np.abs(pcm.astype(np.int32)) > 4)
        if len(active):
            pcm = pcm[:active[-1] + 1 + round(0.010 * RATE)]
        count = len(pcm)
        if 0 < count <= available:
            fade = min(round(RATE * 0.008), count//2)
            if fade:
                env = np.sin(np.linspace(0, math.pi/2, fade))**2
                pcm[:fade] = np.rint(pcm[:fade] * env)
                pcm[-fade:] = np.rint(pcm[-fade:] * env[::-1])
            return pcm.tobytes()
        if not count:
            break
        speed *= max(1.035, (count + 0.03 * RATE) / available)
    raise ValueError("字幕时间过短，无法完整放入这句话。请缩短译文或调整时间后重新导出。")


def _write_gap(out, count):
    silence = bytes(2 * RATE)
    while count > 0:
        n = min(count, RATE)
        out.writeframesraw(silence[:2 * n])
        count -= n


def _pages(text, limit):
    # Keep Western words together; prefer a punctuation boundary in long cues.
    tokens = re.findall(r"[a-zA-Z0-9_./+\-]+|.", text)
    pages = []
    while tokens:
        width, fit, last_break = 0.0, 0, 0
        for i, token in enumerate(tokens):
            units = sum(1 if unicodedata.east_asian_width(c) in "WFA" else 0.55 for c in token)
            if i and width + units > limit:
                break
            width += units
            fit = i + 1
            if token in "，。！？；、,.!?; " and width >= limit * 0.48:
                last_break = fit
        n = last_break if fit < len(tokens) and last_break else max(1, fit)
        phrase = "".join(tokens[:n]).strip()
        if phrase:
            pages.append(phrase)
        tokens = tokens[n:]
    return pages


def _subtitle_pages(row, start, end, limit):
    pages = _pages(row["zh"], limit)
    weights = [max(1, len(line)) for line in pages]
    total = sum(weights)
    elapsed = 0
    for text, w in zip(pages, weights):
        a = start + (end - start) * elapsed / total
        elapsed += w
        b = start + (end - start) * elapsed / total
        yield {"zh": text, "start": a, "end": b}


def _voice_slots(cues, lengths, duration):
    """Plan all sentences together so a tight cue can borrow nearby silence."""
    # Divide simultaneous caption ranges in proportion to speech duration.
    starts, ends = [], []
    i = 0
    while i < len(cues):
        j, group_end = i + 1, cues[i]["end"]
        while j < len(cues) and cues[j]["start"] < group_end - .001:
            group_end = max(group_end, cues[j]["end"])
            j += 1
        left = cues[i]["start"]
        scale = (group_end - left) / sum(lengths[i:j])
        for length in lengths[i:j]:
            starts.append(left)
            left += length * scale
            ends.append(left)
        i = j
    count = len(starts)
    # Keep a breath between cues, borrow up to 450 ms on the left and allow
    # a bounded delay on the right. Work backwards to reserve time for the
    # *next* voice line as well; individual greedy fits can squeeze it out.
    gaps = [min(.065, max(0, (starts[k+1]-starts[k]) * .09)) for k in range(count-1)] + [0.0]
    earliest = [max(0.0, t - .45) for t in starts]
    deadlines = [min(duration, end + 1.5) for end in ends]

    def latest_starts(speed):
        latest = [0.0] * count
        # Bound each guard by the native subtitle span, including tiny cues.
        for k in reversed(range(count)):
            guard = min(.055, (ends[k]-starts[k]) * .06)
            limit = min(deadlines[k], latest[k+1] - gaps[k]) if k+1 < count else deadlines[k]
            latest[k] = min(starts[k] + .7, limit - lengths[k] / speed - guard)
            if latest[k] < earliest[k] - 1e-6:
                return None
        return latest

    speed = 1.26
    latest = latest_starts(speed)
    if latest is None:
        low, high = speed, speed * 2
        while latest_starts(high) is None and high < 100:
            high *= 2
        for _ in range(16):
            mid = (low + high) / 2
            if latest_starts(mid) is None:
                low = mid
            else:
                high = mid
        latest = latest_starts(high * 1.001)
        if latest is None:
            raise ValueError("字幕过于密集，无法容纳完整中文配音。请调整字幕时间或缩短译文。")
    slots, cursor = [], 0.0
    for k in range(count):
        hard_end = min(deadlines[k], latest[k+1] - gaps[k]) if k+1 < count else deadlines[k]
        natural = lengths[k] + .045
        # Prefer the original onset unless an earlier start avoids rushing.
        start = max(earliest[k], cursor, min(starts[k], latest[k], hard_end - lengths[k]/1.20 - .045))
        next_onset = starts[k+1] - gaps[k] if k+1 < count else duration
        end = min(start + natural, hard_end, max(next_onset, start + lengths[k]/1.20 + .045))
        slots.append((round(start * RATE), round(end * RATE)))
        cursor = end + gaps[k]
    return slots


def _timeline(cues, clips, duration, wav_path, limit, progress):
    total_frames = round(duration * RATE)
    slots = _voice_slots(cues, [length for _,length in clips], duration)
    pages = []
    cursor, peak_speed = 0, 1.0
    with wave.open(str(wav_path), "wb") as out:
        out.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        for k, ((start, end), (clip, length)) in enumerate(zip(slots, clips)):
            audio = _fit_clip(clip, length, end - start)
            speed = length * RATE / (len(audio) // 2)
            peak_speed = max(peak_speed, speed)
            _write_gap(out, start - cursor)
            out.writeframesraw(audio)
            cursor = start + len(audio) // 2
            next_onset = slots[k+1][0] if k+1 < len(slots) else total_frames
            cap_end = min(next_onset, cursor + round(.3 * RATE))
            captions = list(_subtitle_pages(cues[k], start / RATE, cap_end / RATE, limit))
            if captions:
                captions[-1]["end"] = min(next_onset/RATE, max(captions[-1]["end"], cues[k]["end"]))
                pages.extend(captions)
            detail = f" · 本句需加速约 {speed:.1f} 倍" if speed >= 1.45 else ""
            progress(65 + 13 * (k + 1) / len(cues), f"对齐中文配音 · {k+1}/{len(cues)}{detail}")
        _write_gap(out, total_frames - cursor)
    return pages, peak_speed


def _encode(source, work, target, duration, width, height, baked, progress, codec="h264",
            original=False, audio_stream=None):
    if baked and codec == "h264":
        # The source pixels already carry captions. Preserve the bitstream and
        # discard selectable text tracks to avoid a second displayed caption.
        video = ["-c:v", "copy"]
    else:
        vf = "pad=ceil(iw/2)*2:ceil(ih/2)*2"
        if not baked:
            # libass uses its default PlayResY=288 for imported SRT.
            font_px = max(14, round(min(width * 0.048, height * 0.044)))
            font = max(6, round(font_px * 288 / height, 2))
            style = f"FontName=Microsoft YaHei,FontSize={font},Bold=-1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00111111,Outline=1,Shadow=0,Alignment=2,MarginV=10"
            vf += f",subtitles=zh.srt:force_style='{style}'"
        timing = ["-fps_mode:v", "passthrough"] if original else ["-fps_mode:v", "vfr", "-t", f"{duration:.6f}"]
        video = ["-vf", vf, *timing,
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"]
    cmd = [str(FFMPEG), "-y", "-nostdin", "-v", "error", "-nostats", "-progress", "pipe:1", "-i", str(source)]
    if original:
        cmd.extend(["-map", "0:V:0"])
        if audio_stream:
            cmd.extend(["-map", f"0:{audio_stream['index']}"])
            if audio_stream["codec_name"] in {"aac", "mp3", "ac3", "eac3", "alac"}:
                cmd.extend(["-c:a", "copy"])
            else:
                cmd.extend(["-c:a", "aac", "-b:a", "192k"])
    else:
        cmd.extend(["-i", "dubbing.wav", "-map", "0:V:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "96k",
                    "-metadata:s:a:0", "language=zho", "-metadata:s:a:0", "handler_name=中文配音"])
    cmd.extend(["-sn", "-dn", *video, "-map_chapters", "-1", "-movflags", "+faststart", str(target)])
    with tempfile.TemporaryFile(mode="w+b") as log:
        with subprocess.Popen(cmd, cwd=work, stdin=subprocess.DEVNULL, stderr=log, stdout=subprocess.PIPE,
                              text=True, encoding="utf8", errors="replace", creationflags=CREATE_FLAGS) as proc:
            try:
                for line in proc.stdout:
                    key, _, value = line.strip().partition("=")
                    if key == "out_time_us" and value.isdigit():
                        fraction = min(1.0, int(value) / 1000000 / duration)
                        start = 3 if original else 78
                        message = "导出原声中文字幕" if original else "封装中文成片"
                        progress(start + (99.8 - start) * fraction, f"{message} · {fraction:.0%}")
            except BaseException:
                if proc.poll() is None:
                    proc.kill()
                proc.wait()
                raise
            finally:
                proc.stdout.close()
            if proc.wait():
                log.seek(0)
                raise RuntimeError("成片导出失败。" + log.read().decode("utf8", "replace")[-600:])


def _video_info(info):
    stream = next((s for s in info["streams"] if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    if stream is None:
        raise ValueError("源文件没有视频轨。")
    duration = float(stream.get("duration") or info["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("视频时长无效。")
    w, h = stream["width"], stream["height"]
    rotation = next((int(s.get("rotation", 0)) for s in stream.get("side_data_list", []) if "rotation" in s), 0)
    if rotation % 180:
        w, h = h, w
    return duration, w, h, stream["codec_name"]


@contextmanager
def _workspace(folder):
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / (".dub-" + uuid4().hex)
    tmp.mkdir()
    try:
        yield tmp
    finally:
        for name in ("dubbing.wav", "zh.srt", "zh.vtt", "bilingual.srt", "bilingual.vtt", "render.mp4"):
            (tmp / name).unlink(missing_ok=True)
        tmp.rmdir()


def _line_limit(width, height):
    font_px = max(14, round(min(width * 0.048, height * 0.044)))
    return max(8, math.floor(width * 0.83 / font_px))


def render_original(source: Path, rows: list, folder: Path, progress, burned_captions: bool = False) -> Path:
    source, folder = Path(source).resolve(), Path(folder).resolve()
    output = folder / "dubbed.mp4"
    if source == output:
        raise ValueError("请选择原视频作为导出源。")
    progress(0, "正在读取原声音轨")
    info = media.probe(source)
    duration, width, height, codec = _video_info(info)
    audio = max((s for s in info["streams"] if s["codec_type"] == "audio"),
                key=lambda s: bool(s.get("disposition", {}).get("default")), default=None)
    with _workspace(folder) as tmp:
        if not burned_captions:
            cues = _get_cues(rows, duration, speech=False)
            limit = _line_limit(width, height)
            pages = [p for cue in cues for p in _subtitle_pages(cue, cue["start"], cue["end"], limit)]
            media.write_subtitles(pages, tmp)
        progress(3, "正在导出原声中文字幕")
        staged = tmp / "render.mp4"
        _encode(source, tmp, staged, duration, width, height, burned_captions, progress, codec,
                original=True, audio_stream=audio)
        os.replace(staged, output)
    progress(100, "原声中文字幕成片已就绪")
    return output


def render(source: Path, rows: list, folder: Path, voice: str, progress,
           burned_captions: bool = False, cache_dir: Path | None = None, quality: str = "standard") -> Path:
    import voices

    source, folder = Path(source).resolve(), Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / "dubbed.mp4"
    if source == output:
        raise ValueError("请从原视频创建配音。")
    if quality not in ("standard", "fast"):
        raise ValueError("请选择标准音质或快速配音。")
    progress(0, "正在准备中文配音")
    duration, w, h, codec = _video_info(media.probe(source))
    cues = _get_cues(rows, duration)
    stat = source.stat()
    synth = None
    def get_synth():
        nonlocal synth
        if synth is None:
            synth = voices.Synthesizer(voice, source, cues, quality=quality)
        return synth
    profiles = getattr(voices, "CACHE_PROFILES", {"standard": "kokoro-v1.1-fixed-v1", "fast": "vits-8k"})
    identity = (CACHE_VERSION, str(source), stat.st_size, stat.st_mtime_ns, voice, quality, profiles[quality])
    cache = Path(cache_dir).resolve() if cache_dir is not None else folder / "voice-cache"
    cache.mkdir(exist_ok=True, parents=True)
    clips = []
    for i, cue in enumerate(cues):
        key = hashlib.sha256(json.dumps([identity, cue], ensure_ascii=False, sort_keys=True).encode("utf8")).hexdigest()
        progress(65 * i / len(cues), f"生成中文语音 · {i+1}/{len(cues)}")
        clip = _get_clip(cache, key, cue, get_synth)
        clips.append(clip)
    synth = None
    with _workspace(folder) as tmp:
        limit = _line_limit(w, h)
        pages, peak_speed = _timeline(cues, clips, duration, tmp / "dubbing.wav", limit, progress)
        if not burned_captions:
            media.write_subtitles(pages, tmp)
        staged = tmp / "render.mp4"
        _encode(source, tmp, staged, duration, w, h, burned_captions, progress, codec)
        os.replace(staged, output)
    info = f" · 最紧凑的字幕约加速 {peak_speed:.1f} 倍" if peak_speed >= 1.45 else ""
    progress(100, "中文配音成片已就绪" + info)
    return output
