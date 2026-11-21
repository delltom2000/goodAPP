"""Generate Mandarin dialogue locally and match stock voices to source pitch."""

from functools import lru_cache
import math
from pathlib import Path
import re
import subprocess
import unicodedata

import numpy as np


ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "models/kokoro-int8-multi-lang-v1_1"
FAST_MODEL = ROOT / "models/vits-icefall-zh-aishell3"
PADDLE_MODEL = ROOT / "models/paddlespeech-aishell3-24k"
CACHE_PROFILES = {"standard": "kokoro-v1.1-fixed-jargon-v2", "fast": "paddlespeech-24k-aishell3-v1"}
SAMPLE_RATE = 8000
# Median fundamental frequency (Hz) measured on a common Mandarin phrase.
PROFILES = {"standard": {58: 114, 61: 130, 80: 145, 22: 210, 4: 229, 32: 239, 3: 258},
            "fast": {10: 128, 102: 157, 23: 168, 38: 178, 47: 200, 99: 211, 31: 235, 33: 267}}
# Named presets follow the published Kokoro sid table and the AISHELL-3
# speaker metadata matched against this model's own speakers.txt ordering.
FIXED_VOICES = {
    "standard": {"female": 22, "female_clear": 32, "male": 61},
    "fast": {"female": 47, "female_clear": 31, "male": 10},
}


@lru_cache(maxsize=2)
def _load_tts(quality):
    if quality == "fast":
        return _PaddleMandarin()
    import sherpa_onnx

    model = sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=str(MODEL / "model.int8.onnx"), voices=str(MODEL / "voices.bin"),
            tokens=str(MODEL / "tokens.txt"),
            lexicon=",".join(str(MODEL / f) for f in ("lexicon-us-en.txt", "lexicon-zh.txt")),
        ), num_threads=3, provider="cpu")
    rules = [MODEL / (name + "-zh.fst") for name in ("phone", "date", "number")]
    config = sherpa_onnx.OfflineTtsConfig(model=model, rule_fsts=",".join(map(str, rules)),
                                          max_num_sentences=1)
    if not config.validate():
        raise RuntimeError("中文配音模型不完整，请重新解压完整发布包。")
    return sherpa_onnx.OfflineTts(config)


_DIGITS = "零一二三四五六七八九"


def _cardinal(value, omit_first_one=True):
    if value >= 10000:
        high, low = divmod(value, 10000)
        return _cardinal(high) + "万" + ("零" if 0 < low < 1000 else "") + (_cardinal(low, False) if low else "")
    parts = []
    zero = False
    for unit, label in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
        digit, value = divmod(value, unit)
        if digit:
            if zero:
                parts.append("零")
            if digit != 1 or unit != 10 or parts or not omit_first_one:
                parts.append(_DIGITS[digit])
            parts.append(label)
            zero = False
        elif parts and value:
            zero = True
    return "".join(parts) or "零"


def _number(match):
    sign, whole, fraction, suffix = match.groups()
    whole = whole.replace(",", "")
    per_digit = len(whole) > 8 or len(whole)>1 and whole.startswith("0") or suffix == "年" and len(whole)==4
    body = "".join(_DIGITS[int(n)] for n in whole) if per_digit else _cardinal(int(whole))
    if fraction:
        body += "点" + "".join(_DIGITS[int(n)] for n in fraction)
    return ("负" if sign == "-" else "") + ("百分之" if suffix == "%" else "") + body + ("年" if suffix == "年" else "")


class _PaddleMandarin:
    """PaddleSpeech 24 kHz FastSpeech2 and HiFiGAN, both trained on AISHELL-3."""
    sample_rate = 24000

    def __init__(self):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        backend = ["CPUExecutionProvider"]
        self.acoustic = ort.InferenceSession(str(PADDLE_MODEL / "fastspeech2_aishell3.onnx"), options, providers=backend)
        self.vocoder = ort.InferenceSession(str(PADDLE_MODEL / "hifigan_aishell3.onnx"), options, providers=backend)
        with (PADDLE_MODEL / "phone_id_map.txt").open(encoding="utf-8") as file:
            self.ids = {phoneme: int(i) for phoneme, i in (line.split() for line in file if line.strip())}
        with (FAST_MODEL / "lexicon.txt").open(encoding="utf-8") as file:
            self.lexicon = {parts[0]: [p for p in parts[1:] if p not in {"^", "#0"}]
                            for line in file if (parts := line.split())}
        self.longest = max(map(len, self.lexicon))

    def _phonemes(self, text):
        text = unicodedata.normalize("NFKC", text)
        text = re.sub(r"(-?)([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]+))?(%|年)?", _number, text)
        phones = []
        i = 0
        while i < len(text):
            # Prefer the full word (e.g. 银行 and 行为 have different readings).
            for end in range(min(len(text), i+self.longest), i, -1):
                word = text[i:end]
                if word in self.lexicon:
                    phones.extend(self.lexicon[word])
                    i = end
                    break
            else:
                if text[i] in ",.!?;:、。？！；：" and phones and phones[-1] != "sp":
                    phones.append("sp")
                elif "\u3400" <= text[i] <= "\u9fff":
                    phones.append("<unk>")
                i += 1
        # An initial may stand between the finals of a 3rd-3rd tone pair.
        for i, p in enumerate(phones[:-1]):
            if p.endswith("3"):
                after = i+1 if phones[i+1][-1:].isdigit() else i+2
                if after < len(phones) and phones[i+1] != "sp" and phones[after].endswith("3"):
                    phones[i] = p[:-1]+"2"
        return np.array([self.ids.get(p, self.ids.get(p[:-1]+"1", self.ids["<unk>"])) for p in phones], dtype=np.int64)

    def synthesize(self, text, sid):
        phones = self._phonemes(text)
        if not phones.size:
            return np.zeros(0, dtype=np.float32)
        mel = self.acoustic.run(None, {"text": phones, "spk_id": np.array([sid], dtype=np.int64)})[0]
        return self.vocoder.run(None, {"logmel": mel})[0].reshape(-1)


def _voiced_pitch(samples):
    """Median fundamental frequency across short periodic speech frames at 8 kHz."""
    candidates = []
    frame_size = 360
    for offset in range(0, len(samples) - frame_size + 1, 144):
        frame = np.asarray(samples[offset:offset + frame_size], dtype=np.float32)
        frame = frame - frame.mean()
        if np.mean(frame * frame) < 0.00003:
            continue
        # Normalize each lag by the overlap energy to avoid a high-pitch bias.
        power = np.concatenate(([0.], np.cumsum(frame ** 2, dtype=np.float64)))
        lags = np.arange(20, 111)
        energy = np.sqrt(np.maximum(power[-1 - lags] * (power[-1] - power[lags]), 1e-12))
        correlation = np.correlate(frame, frame, mode="full")[frame_size - 1 + lags] / energy
        peaks = np.flatnonzero((correlation[1:-1] >= correlation[:-2]) &
                               (correlation[1:-1] > correlation[2:])) + 1
        if not len(peaks):
            continue
        strong = peaks[correlation[peaks] >= max(0.67, 0.90 * correlation[peaks].max())]
        if len(strong):
            candidates.append(SAMPLE_RATE / lags[strong[0]])
    return float(np.median(candidates)) if len(candidates) >= 4 else None


def _analyze_rows(source, rows):
    """Decode once and retain short speech excerpts per cue, even for long videos."""
    pitches = {}
    times = sorted({(float(row["start"]), float(row["end"])) for row in rows})
    if not times:
        return pitches
    command = [str(ROOT / "tools/ffmpeg.exe"), "-nostdin", "-v", "error", "-i", str(source),
               "-map", "0:a:0", "-t", str(max(end for _, end in times)), "-ac", "1",
               "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"]
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)) as process:
        position = 0
        try:
            for key in times:
                start, end = key
                # Start slightly inside the subtitle to avoid quiet cue edges.
                sample_start = max(position, int((start + min(0.12, (end-start)/8)) * SAMPLE_RATE))
                while position < sample_start:
                    skipped = process.stdout.read(2 * min(65536, sample_start - position))
                    if not skipped:
                        return pitches
                    position += len(skipped) // 2
                length = min(int(2.4 * SAMPLE_RATE), int(end * SAMPLE_RATE) - position)
                if length <= 0:
                    continue
                data = process.stdout.read(2 * length)
                if not data:
                    break
                position += len(data) // 2
                pitches[key] = _voiced_pitch(np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768)
        finally:
            if process.poll() is None:
                process.terminate()
    return pitches


def _nearest(profiles, pitch):
    return min(profiles, key=lambda sid: abs(math.log(profiles[sid] / pitch)))


def _pick_voices(source, rows, profiles):
    pitches = _analyze_rows(source, rows)
    measured = [pitch for pitch in pitches.values() if pitch]
    typical = float(np.median(measured)) if measured else 165
    # Group recurrent pitch registers first and select one stock voice per
    # group. The first raised word of a sentence should not become a new voice.
    registers = []
    assignment = {}
    previous = None
    for key, pitch in pitches.items():
        if pitch:
            value = math.log2(pitch)
            centers = [float(np.median(group)) for group in registers]
            if previous is None or abs(value - centers[previous]) > 0.40:
                best = min(range(len(centers)), key=lambda i: abs(value - centers[i]), default=None)
                if best is None or abs(value - centers[best]) > 0.34:
                    best = len(registers)
                    registers.append([])
                previous = best
            registers[previous].append(value)
        assignment[key] = previous
    bank = [_nearest(profiles, 2 ** float(np.median(group))) for group in registers]
    fallback = _nearest(profiles, typical)
    return {key: bank[index] if index is not None else fallback
            for key, index in assignment.items()}, fallback


def _phrases(text):
    """Bound each model input at clause boundaries; Kokoro has a phoneme limit."""
    while len(text) > 90:
        breaks = list(re.finditer(r"[。！？；，、：,.!?;:\s]", text[:90]))
        split = breaks[-1].end() if breaks and breaks[-1].end() >= 30 else 90
        yield text[:split].strip()
        text = text[split:].strip()
    if text:
        yield text


@lru_cache(maxsize=1)
def _english_words():
    with (MODEL / "lexicon-us-en.txt").open(encoding="utf-8") as lexicon:
        return {line.split(maxsplit=1)[0].lower() for line in lexicon if line.strip()}


def _pronounce_word(match):
    word = match[0]
    if word.lower() in {"agent", "agents", "ai"}:
        return _READINGS[word.lower()]
    if word.lower() in _english_words() and (not word.isupper() or len(word) > 4):
        return word
    pieces = re.findall(r"[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]", word)
    return " ".join(piece if len(piece) > 1 and not piece.isupper() and piece.lower() in _english_words()
                    else " ".join(piece.upper()) for piece in pieces)


_LETTER_NAMES = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (
    "诶", "比", "西", "迪", "伊", "艾弗", "吉", "艾尺", "艾", "杰",
    "凯", "艾勒", "艾姆", "恩", "欧", "皮", "丘", "阿尔", "艾斯",
    "提", "优", "维", "达布柳", "艾克斯", "歪", "贼德",
)))
# Chinese reading forms for common computing terms. Subtitles retain the
# source spelling; unlisted words are spelled aloud by the same VITS speaker.
_READINGS = {
    "ai":"人工智能", "agent":"智能体", "agents":"智能体", "android":"安卓", "apple":"苹果",
    "app":"应用", "babel":"巴贝尔", "browser":"浏览器", "bot":"机器人",
    "bug":"程序错误", "build":"构建", "cache":"缓存", "chat":"聊天",
    "chrome":"克罗姆", "claude":"克劳德", "cloud":"云", "code":"代码",
    "coding":"编程", "codex":"科德克斯", "commit":"提交", "cursor":"柯瑟",
    "debug":"调试", "dev":"开发", "docker":"多克", "dune":"沙丘",
    "electron":"伊莱克特朗", "eslint":"伊艾斯林特", "eval":"评测", "feature":"功能", "file":"文件",
    "fork":"派生", "git":"吉特", "github":"吉特哈布", "google":"谷歌",
    "grok":"格罗克", "import":"导入", "install":"安装", "javascript":"加瓦斯克里普特",
    "json":"杰森", "linux":"利纳克斯", "main":"主分支", "map":"映射",
    "markdown":"马克当", "meta":"梅塔", "microsoft":"微软", "model":"模型",
    "next":"内克斯特", "node":"诺德", "openai":"欧朋诶艾", "patch":"补丁",
    "playbook":"操作手册", "prompt":"提示词", "pull":"拉取", "python":"派森",
    "react":"瑞艾克特", "readme":"说明文档", "release":"发布", "render":"渲染",
    "renderer":"渲染器", "request":"请求", "rust":"拉斯特", "script":"脚本",
    "server":"服务器", "skill":"技能", "slack":"斯莱克", "stack":"栈",
    "test":"测试", "token":"词元", "tool":"工具", "tools":"工具", "trace":"追踪",
    "twitter":"推特", "verification":"验证", "web":"网页", "windows":"视窗系统",
    "worktree":"工作树",
}


def _fast_word(match):
    word = match[0]
    reading = _READINGS.get(word.lower())
    if reading:
        return reading
    parts = re.findall(r"[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]", word)
    return "".join(_READINGS.get(part.lower()) or "".join(_LETTER_NAMES[c] for c in part.upper())
                   for part in parts)


class Synthesizer:
    def __init__(self, voice="female", source=None, rows=(), quality="standard"):
        if quality not in PROFILES:
            raise ValueError("请选择标准或快速配音。")
        if voice not in (*FIXED_VOICES[quality], "auto", "low", "high"):
            raise ValueError("请选择自然女声、明亮女声或男声。")
        self.quality = quality
        self.model = _load_tts(quality)
        profiles = PROFILES[quality]
        if voice in FIXED_VOICES[quality]:
            self.voices, self.default_sid = {}, FIXED_VOICES[quality][voice]
        elif voice == "auto":
            self.voices, self.default_sid = _pick_voices(source, rows, profiles)
        else:
            self.voices, self.default_sid = {}, _nearest(profiles, 120 if voice == "low" else 230)

    def render(self, text, row):
        key = (float(row["start"]), float(row["end"]))
        sid = self.voices.get(key, self.default_sid)
        samples = []
        rate = self.model.sample_rate
        spoken = re.sub("[A-Za-z]+", _fast_word if self.quality == "fast" else _pronounce_word,
                        " ".join(text.split()))
        for phrase in _phrases(spoken):
            if not any(ch.isalnum() for ch in phrase):
                continue
            if self.quality == "fast":
                waveform = self.model.synthesize(phrase, sid)
            else:
                audio = self.model.generate(phrase, sid=sid, speed=1.0)
                waveform = np.asarray(audio.samples, dtype=np.float32)
            if len(waveform):
                samples.append(waveform)
        if not samples or not any(np.any(wave) for wave in samples):
            return rate, np.zeros(rate // 10, dtype=np.float32)
        return rate, samples[0] if len(samples) == 1 else np.concatenate(samples)
