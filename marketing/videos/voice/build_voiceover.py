"""Build each video's voice-over and its timeline.

For each script line: synthesise with the selected voice, trim silence, place it on a 25 s timeline, force-align it for word
timestamps, and re-check intelligibility at the final speed. Writes:
  out/<id>/voice.wav                 48 kHz mono voice-over
  remotion/src/data/<id>.json        timeline: lines, words (caption timing), scenes and sub-beats, sound cues
"""
from __future__ import annotations

import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(__file__))
import kokoro_tts as k  # noqa: E402
import speech_check as sc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
FPS = 30
DURATION_S = 25.0
LEAD_IN_S = 0.12      # the hook starts speaking almost at once (hook in the first 1.5 s)
GAP_S = 0.26          # silence between lines
CTA_HOLD_MIN_S = 1.9  # end card stays on screen after the last word

# Sub-beats: a scene is split at the first word listed, so the picture changes about every 2.5 s inside long lines.
SPLITS = {
    "v1": {
        "hook": [("hook-a", None), ("hook-b", "Just")],
        "basket": [("basket", None), ("confirm", "then")],
        "sendhome": [("abroad", None), ("sendhome", "Send")],
        "cta": [("cta", None)],
    },
    "v2": {
        "dashboard": [("dashboard", None), ("dashboard-b", "orders")],
        "cta": [("cta", None)],
    },
}


def load_script(vid: str) -> dict:
    name = {"v1": "video1.json", "v2": "video2.json"}[vid]
    with open(os.path.join(ROOT, "scripts", name), encoding="utf-8") as f:
        return json.load(f)


def trim(a: np.ndarray, thresh: float = 0.01, pad_s: float = 0.03) -> np.ndarray:
    idx = np.where(np.abs(a) > thresh)[0]
    if len(idx) == 0:
        return a
    pad = int(pad_s * k.SAMPLE_RATE)
    return a[max(0, idx[0] - pad): min(len(a), idx[-1] + pad)]


def display_tokens(text: str) -> list[str]:
    toks = [t for t in text.split() if re.search(r"[A-Za-z]", t)]
    assert [w.lower() for t in toks for w in re.findall(r"[A-Za-z']+", t)] == sc.norm_words(text), text
    return toks


def build(vid: str, voice: str) -> dict:
    script = load_script(vid)
    texts = [l["text"] for l in script["lines"]]

    def render(speed: float) -> list[np.ndarray]:
        return [trim(k.synthesize(t, voice, speed)) for t in texts]

    speed = 1.0
    clips = render(speed)
    budget = DURATION_S - CTA_HOLD_MIN_S - LEAD_IN_S - GAP_S * (len(texts) - 1)
    total = sum(len(c) for c in clips) / k.SAMPLE_RATE
    while total > budget and speed < 1.25:
        speed = round(min(1.25, speed * total / budget * 1.005), 3)
        clips = render(speed)
        total = sum(len(c) for c in clips) / k.SAMPLE_RATE
    if total > budget:
        raise SystemExit(f"{vid}: voice-over {total:.2f}s does not fit {budget:.2f}s even at speed {speed}")
    # Spread the spare time evenly into the gaps, but keep gaps short so the pace stays brisk.
    spare = budget - total
    gap = GAP_S + min(spare / max(1, len(texts) - 1), 0.12)

    sr = k.SAMPLE_RATE
    timeline = np.zeros(int(DURATION_S * sr), np.float32)
    t = LEAD_IN_S
    lines, words = [], []
    errs = n = 0
    for i, (line, clip) in enumerate(zip(script["lines"], clips)):
        start = t
        s0 = int(start * sr)
        timeline[s0: s0 + len(clip)] += clip
        al = sc.align(clip, sr, line["text"])
        e, m = sc.wer(sc.norm_words(line["text"]), sc.recognize(clip, sr))
        errs, n = errs + e, n + m
        toks = display_tokens(line["text"])
        for j, (tok, a) in enumerate(zip(toks, al)):
            words.append({
                "text": tok,
                "startMs": round((start + a["start"]) * 1000),
                "endMs": round((start + a["end"]) * 1000),
                "line": i,
                "lastInLine": j == len(toks) - 1,
            })
        end = start + len(clip) / sr
        lines.append({"scene": line["scene"], "text": line["text"], "startMs": round(start * 1000), "endMs": round(end * 1000)})
        t = end + gap

    # Scenes: line i's picture starts a few frames before its first word (cuts land just ahead of the voice).
    pre = 0.12
    scenes = []
    for i, line in enumerate(lines):
        start_s = 0.0 if i == 0 else line["startMs"] / 1000 - pre
        end_s = DURATION_S if i == len(lines) - 1 else lines[i + 1]["startMs"] / 1000 - pre
        parts = SPLITS.get(vid, {}).get(line["scene"], [(line["scene"], None)])
        cuts = [start_s]
        for _, w in parts[1:]:
            hit = next(x for x in words if x["line"] == i and re.sub(r"\W", "", x["text"]) == w)
            cuts.append(hit["startMs"] / 1000 - pre)
        cuts.append(end_s)
        for (sid, _), a, b in zip(parts, cuts[:-1], cuts[1:]):
            scenes.append({"id": sid, "line": i, "from": round(a * FPS), "to": round(b * FPS)})
    for a, b in zip(scenes, scenes[1:]):
        b["from"] = a["to"]  # no frame gaps

    voice_out = os.path.join(ROOT, "out", vid)
    os.makedirs(voice_out, exist_ok=True)
    sf.write(os.path.join(voice_out, "voice.wav"), resample_poly(timeline, 2, 1).astype(np.float32), 48000)

    data = {
        "id": vid,
        "fps": FPS,
        "durationInFrames": int(DURATION_S * FPS),
        "voice": voice,
        "speed": speed,
        "asrCheck": {"wordErrors": errs, "words": n, "wer": round(errs / n, 4)},
        "lines": lines,
        "words": words,
        "scenes": scenes,
    }
    dst = os.path.join(ROOT, "remotion", "src", "data")
    os.makedirs(dst, exist_ok=True)
    with open(os.path.join(dst, f"{vid}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    return data


def main() -> None:
    with open(os.path.join(HERE, "selection.json"), encoding="utf-8") as f:
        voice = json.load(f)["winner"]
    for vid in ("v1", "v2"):
        d = build(vid, voice)
        lens = [s["to"] - s["from"] for s in d["scenes"]]
        print(vid, "speed", d["speed"], "voice ends", d["lines"][-1]["endMs"], "ms", "asr", d["asrCheck"],
              "scenes", len(lens), "avg", round(sum(lens) / len(lens) / FPS, 2), "s", "max", round(max(lens) / FPS, 2), "s")
        for s in d["scenes"]:
            print("  ", s["id"], s["from"], s["to"], round((s["to"] - s["from"]) / FPS, 2))


if __name__ == "__main__":
    main()
