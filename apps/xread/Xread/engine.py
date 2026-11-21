"""Offline English speech recognition and English-to-Chinese subtitles."""

import json
import os
import re
import subprocess
import tempfile
from collections import deque
from functools import lru_cache
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
THREADS = max(1, min(os.cpu_count() or 2, 6))
CHILD_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def transcribe(media, progress, on_seconds=None):
    """Return English cues with start and end measured in seconds."""
    media = Path(media).resolve()
    progress("正在提取英文音轨")
    with tempfile.TemporaryDirectory(prefix="xread-asr-") as work:
        wav = Path(work) / "audio.wav"
        audio = subprocess.run(
            [str(ROOT / "tools/ffmpeg.exe"), "-nostdin", "-v", "error",
             "-i", str(media), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", str(wav)],
            capture_output=True, creationflags=CHILD_FLAGS,
        )
        if audio.returncode:
            raise RuntimeError("无法读取音轨，请确认视频包含可播放的声音。")

        progress("正在本机识别英文语音")
        base = Path(work) / "transcript"
        command = [
            str(ROOT / "tools/whisper/whisper-cli.exe"), "-m", "models/ggml-small.en-q5_1.bin",
            "-f", str(wav), "-l", "en", "-t", str(THREADS), "-ng",
            "-ml", "150", "-sow", "-sns", "-oj", "-of", str(base),
        ]
        with subprocess.Popen(
            command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", creationflags=CHILD_FLAGS,
        ) as process:
            tail = deque(maxlen=3)
            last_update = -5
            for line in process.stdout:
                tail.append(line.strip())
                end = re.search(r"--> (\d\d):(\d\d):(\d\d)", line)
                if end:
                    hour, minute, second = map(int, end.groups())
                    seconds = hour * 3600 + minute * 60 + second
                    if seconds >= last_update + 5:
                        last_update = seconds
                        if on_seconds:
                            on_seconds(seconds)
                        progress(f"正在识别英文语音，已到 {':'.join(end.groups())}")
            if process.wait():
                raise RuntimeError("本机语音识别失败。" + " ".join(tail)[-300:])

        payload = json.loads(base.with_suffix(".json").read_text(encoding="utf-8"))
        rows = []
        for item in payload["transcription"]:
            text = item["text"].strip()
            start = item["offsets"]["from"] / 1000
            end = item["offsets"]["to"] / 1000
            if text and end > start and not re.fullmatch(r"\[(?:BLANK_AUDIO|MUSIC|SILENCE)\]", text, re.I):
                rows.append({"start": start, "end": end, "en": text})
        if not rows:
            raise RuntimeError("没有识别到英文对白。")
        return rows


@lru_cache(maxsize=1)
def _translator():
    import ctranslate2
    import sentencepiece

    folder = MODELS / "translate-en_zh-1_9"
    tokenizer = sentencepiece.SentencePieceProcessor(
        model_proto=(folder / "sentencepiece.model").read_bytes())
    model = ctranslate2.Translator(str(folder / "model"), device="cpu", compute_type="int8",
                                   inter_threads=1, intra_threads=THREADS)
    return tokenizer, model


def translate(rows, progress, on_fraction=None):
    """Fill zh on English cues, preserving existing translations and timing."""
    pending = [row for row in rows if row.get("en") and not row.get("zh")]
    if not pending:
        return rows
    progress("正在加载本地英译中模型")
    tokenizer, model = _translator()
    for offset in range(0, len(pending), 12):
        batch = pending[offset:offset + 12]
        # Keep the transcript verbatim. Fold repeated discourse words only
        # in the translation input when a speaker restarts after a comma.
        phrases = [re.sub(r"\b(very|pretty|quite|really|rather|fairly|so|well|um|uh),\s+\1\b",
                          r"\1", row["en"], flags=re.I) for row in batch]
        sentences = [tokenizer.encode(phrase, out_type=str) for phrase in phrases]
        outputs = model.translate_batch(sentences, beam_size=4, max_decoding_length=512)
        for row, output in zip(batch, outputs):
            chinese = "".join(output.hypotheses[0]).replace("▁", " ").strip()
            chinese = re.sub(r"(?<=[\u3400-\u9fff]) +(?=[\u3400-\u9fff])", "", chinese)
            punctuation = {",": "，", "?": "？", "!": "！", ".": "。"}
            row["zh"] = re.sub(r"(?<=[\u3400-\u9fff])([,?!.])(?=\s|[\u3400-\u9fff]|$)",
                               lambda match: punctuation[match[1]], chinese)
            if not row["zh"]:
                raise RuntimeError("翻译模型未能生成该句译文。")
        if on_fraction:
            on_fraction((offset + len(batch)) / len(pending))
        progress(f"已翻译 {offset + len(batch)} / {len(pending)} 条字幕")
    return rows
