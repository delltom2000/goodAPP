"""Fail the Linux image build if a media binary, model, or native wheel is unusable."""

from pathlib import Path
import subprocess
import tempfile

import numpy as np

import detect_captions
import engine
from voices import Synthesizer


def main():
    root = Path(engine.__file__).parent
    tools = root / "tools"
    subprocess.run([tools / "whisper/whisper-cli.exe", "--help"], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    demo = root / "demo/source.mp4"
    subprocess.run([tools / "ffprobe.exe", "-v", "error", "-show_format", demo],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run([tools / "ffmpeg.exe", "-nostdin", "-v", "error", "-i", demo,
                    "-vf", "subtitles=captions.srt", "-frames:v", "1", "-f", "null", "-"],
                   cwd=demo.parent, check=True)
    detect_captions._models()
    with tempfile.TemporaryDirectory() as work:
        speech = Path(work) / "opening.wav"
        subprocess.run([tools / "ffmpeg.exe", "-nostdin", "-v", "error", "-i", demo,
                        "-t", "5.5", "-vn", "-ar", "16000", "-ac", "1", speech], check=True)
        row = engine.transcribe(speech, print)[0]
    engine.translate([row], print)
    if not any("\u3400" <= character <= "\u9fff" for character in row["zh"]):
        raise RuntimeError("The translation model produced no Chinese text")
    for quality in ("fast", "standard"):
        rate, samples = Synthesizer("female", quality=quality).render("你好。", row)
        if rate != 24000 or len(samples) < 2400 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.01:
            raise RuntimeError(f"Invalid output from the {quality} Mandarin voice")


if __name__ == "__main__":
    main()
