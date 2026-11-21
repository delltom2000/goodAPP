"""Check timed cues against Chinese text already present in decoded video frames."""

from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
import re
import subprocess

import numpy as np


ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "models/ppocr"


@lru_cache(maxsize=1)
def _models():
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    models = [ort.InferenceSession(str(MODEL / f"ch_PP-OCRv4_{kind}_infer.onnx"), options,
                                   providers=["CPUExecutionProvider"]) for kind in ("det", "rec")]
    alphabet = [""] + models[1].get_modelmeta().custom_metadata_map["character"].splitlines() + [" "]
    return *models, alphabet


def _frame(source, seconds):
    result = subprocess.run(
        [str(ROOT / "tools/ffmpeg.exe"), "-nostdin", "-v", "error", "-ss", f"{seconds:.3f}",
         "-i", str(source), "-map", "0:v:0", "-frames:v", "1",
         "-vf", "scale='min(1152,iw)':-2,crop=iw:ih*0.57:0:ih-oh",
         "-c:v", "ppm", "-f", "image2pipe", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    header = re.match(rb"P6\s+(\d+)\s+(\d+)\s+255\s", result.stdout)
    if result.returncode or not header:
        return None
    width, height = map(int, header.groups())
    data = np.frombuffer(result.stdout, dtype=np.uint8, offset=header.end())
    return data.reshape(height, width, 3)[:, :, ::-1]  # PP-OCR takes BGR


def _resize(image, width, height):
    y = np.linspace(0, image.shape[0] - 1, height, dtype=np.float32)
    x = np.linspace(0, image.shape[1] - 1, width, dtype=np.float32)
    ix, iy = x.astype(int), y.astype(int)
    fx = (x - ix).astype(np.float32)[None, :, None]
    fy = (y - iy).astype(np.float32)[:, None, None]
    left = image[iy[:, None], ix]
    right = image[iy[:, None], np.minimum(ix + 1, image.shape[1] - 1)]
    lower = np.minimum(iy + 1, image.shape[0] - 1)
    bottom_left = image[lower[:, None], ix]
    bottom_right = image[lower[:, None], np.minimum(ix + 1, image.shape[1] - 1)]
    return (1 - fy) * ((1 - fx) * left + fx * right) + fy * ((1 - fx) * bottom_left + fx * bottom_right)


def _components(mask):
    """Horizontal subtitle boxes on a sparse, half-size detector mask."""
    ypos, xpos = np.nonzero(mask[::2, ::2])
    points = set(zip(xpos.tolist(), ypos.tolist()))
    while points:
        x, y = points.pop()
        left = right = x
        top = bottom = y
        todo = [(x, y)]
        while todo:
            x, y = todo.pop()
            for xx, yy in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                if (xx, yy) in points:
                    points.remove((xx, yy))
                    todo.append((xx, yy))
                    left, right = min(left, xx), max(right, xx)
                    top, bottom = min(top, yy), max(bottom, yy)
        if right - left >= 4 and bottom - top >= 2:
            yield (2*left, 2*top, 2*(right+1), 2*(bottom+1))


def _recognize(frame):
    detector, recognizer, alphabet = _models()
    h, w = frame.shape[:2]
    factor = min(1, 864 / w)
    dw, dh = [max(32, 32 * round(n * factor / 32)) for n in (w, h)]
    tensor = _resize(frame, dw, dh) / np.float32(127.5) - 1
    prob = detector.run(None, {"x": tensor.transpose(2, 0, 1)[None]})[0][0, 0]
    boxes = sorted(_components(prob > 0.32), key=lambda b: (b[2]-b[0])*(b[3]-b[1]), reverse=True)
    result = []
    for left, top, right, bottom in boxes[:16]:
        margin = (bottom - top) * 0.49
        x1, y1 = max(0, int((left-margin)*w/dw)), max(0, int((top-margin)*h/dh))
        x2, y2 = min(w, int((right+margin)*w/dw+1)), min(h, int((bottom+margin)*h/dh+1))
        if x2-x1 < (y2-y1)*1.1:
            continue
        width = max(8, min(1024, round((x2-x1) / (y2-y1) * 48)))
        crop = _resize(frame[y1:y2, x1:x2], width, 48) / np.float32(127.5) - 1
        padded = np.zeros((1, 3, 48, max(160, width)), dtype=np.float32)
        padded[0, :, :, :width] = crop.transpose(2, 0, 1)
        scores = recognizer.run(None, {"x": padded})[0][0]
        ids = scores.argmax(axis=1)
        take = (ids != 0) & (ids != np.r_[-1, ids[:-1]])
        if take.any() and scores[np.arange(len(ids)), ids][take].mean() >= 0.52:
            text = "".join(alphabet[i] for i in ids[take] if i < len(alphabet))
            result.append((text, (x1+x2)/(2*w), (y1+y2)/(2*h), (y2-y1)/h))
    return result


def _han(text):
    return "".join(re.findall(r"[\u3400-\u9fff]", text))


def _matches(reference, candidate):
    # Several consecutive characters can identify one line of a multi-line cue.
    shorter = min(len(reference), len(candidate))
    if shorter < 3:
        return False
    blocks = SequenceMatcher(None, reference, candidate, autojunk=False).get_matching_blocks()
    longest = max(block.size for block in blocks)
    overlap = sum(block.size for block in blocks)
    return longest >= min(4, shorter) and overlap >= 0.62 * shorter


def _english(text):
    return "".join(re.findall("[a-z0-9]", text.lower()))


def _dialogue_lines(lines):
    return [(text, x, y, height) for text, x, y, height in lines
            if len(_han(text)) >= 3 and 0.23 < x < 0.77 and y > 0.43 and 0.018 < height < 0.20]


def _same_band(a, b):
    return abs(a[2] - b[2]) <= 0.042 and abs(a[1] - b[1]) <= 0.17 and 0.62 < a[3]/b[3] < 1.62


def _similar(a, b):
    return SequenceMatcher(None, _han(a[0]), _han(b[0]), autojunk=False).ratio()


def _single_cue(source, cue, read_at):
    start, end, expected, _ = cue
    if len(expected) < 6:
        return False
    def aligned(t):
        for line in _dialogue_lines(read_at(t)):
            actual = _han(line[0])
            if _matches(expected, actual) and SequenceMatcher(None, expected, actual).ratio() >= 0.80:
                return True
        return False
    if not all(aligned(start + (end - start)*portion) for portion in (0.30, 0.70)):
        return False
    try:
        probe = subprocess.run([str(ROOT / "tools/ffprobe.exe"), "-v", "error", "-show_entries",
                                "format=duration", "-of", "default=nw=1:nk=1", str(source)],
                               capture_output=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        duration = float(probe.stdout)
    except (ValueError, OSError, subprocess.TimeoutExpired):
        return False
    outside = [t for t in (start-0.45, end+0.45) if 0 <= t < duration-0.05]
    return all(not aligned(t) for t in outside) if outside else len(expected) >= 10


def detect(source: Path, rows: list[dict]) -> bool:
    """Check text, bilingual alignment, or repeated cue-timed changes in one subtitle band."""
    candidates = [(float(row["start"]), float(row["end"]), _han(row.get("zh") or ""), _english(row.get("en") or ""))
                  for row in rows]
    candidates = [cue for cue in candidates if cue[1] - cue[0] >= 0.35 and len(cue[2]) >= 3]
    if not candidates:
        return False
    @lru_cache(maxsize=32)
    def read_at(t):
        try:
            frame = _frame(source, t)
            return [] if frame is None else _recognize(frame)
        except (OSError, subprocess.TimeoutExpired):
            return []

    if len(candidates) == 1:
        return _single_cue(source, candidates[0], read_at)
    # Check the opening turn first, then sample across the video to handle
    # intros, changes of layout, and captions that appear later in the talk.
    selected = sorted({0, 1, *np.linspace(2, len(candidates)-1, min(6,len(candidates)-2), dtype=int)})
    matches = []
    bilingual = []
    by_index = {}
    for index in selected:
        start, end, reference, english = candidates[index]
        lines = read_at((start+end)/2)
        by_index[index] = _dialogue_lines(lines)
        chinese = [_han(line[0]) for line in lines]
        for raw, *_ in lines:
            candidate = _han(raw)
            if not _matches(reference, candidate):
                continue
            for old_reference, old_candidate, old_frame in matches:
                if old_reference != reference and not any(_matches(old_candidate, word) for word in chinese
                                                          if len(word) >= 3) and not any(
                        _matches(candidate, word) for word in old_frame if len(word) >= 3):
                    return True
            matches.append((reference, candidate, chinese))
            break
        if len(english) >= 8:
            neighbors = [line for line in lines if len(_english(line[0])) >= 8 and
                         _matches(english, _english(line[0]))]
            for line in by_index[index]:
                if any(0.012 < abs(line[2]-other[2]) < 0.15 and abs(line[1]-other[1]) < 0.15
                       for other in neighbors):
                    if any(index != earlier and _same_band(line, previous) and _similar(line, previous) < 0.50
                           and not any(_similar(previous, current) >= 0.72 for current in by_index[index])
                           for earlier, previous in bilingual):
                        return True
                    bilingual.append((index, line))
    # With independently translated Chinese, verify three distinct lines in
    # the same location and two actual changes at nearby subtitle boundaries.
    dialogue = [line for lines in by_index.values() for line in lines]
    for anchor in dialogue:
        distinct = []
        for line in dialogue:
            if _same_band(anchor, line) and all(_similar(line, seen) < 0.55 for seen in distinct):
                distinct.append(line)
        if len(distinct) >= 3:
            break
    else:
        return False
    changes = []
    for i, lines in by_index.items():
        if i+1 >= len(candidates):
            continue
        start, end = candidates[i][:2]
        next_start, next_end = candidates[i+1][:2]
        if not -0.15 <= next_start-end <= 1.5 or not any(_same_band(anchor, line) for line in lines):
            continue
        before = _dialogue_lines(read_at(end-min(0.30, (end-start)/4)))
        after = _dialogue_lines(read_at(next_start+min(0.35,(next_end-next_start)/4)))
        for previous in before:
            if not _same_band(anchor, previous) or not any(_similar(previous, line) >= 0.65 for line in lines):
                continue
            if any(_same_band(previous, later) and _similar(previous, later) < 0.50 for later in after):
                if all(_similar(previous, seen) < 0.55 for seen in changes):
                    changes.append(previous)
                break
        if len(changes) >= 2:
            return True
    return False
