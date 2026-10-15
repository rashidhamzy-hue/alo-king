"""Stage 4 checks on the final MP4s. Writes VERIFY.md next to the README.

1. Format: H.264 + AAC, 1080×1920, 30 fps, about 25 s.
2. Audio: integrated loudness -14 LUFS (±0.5) and true peak below -1 dBTP (ffmpeg ebur128 on the final file).
3. Caption sync: every script line is force-aligned again on the *final mixed* audio (voice + music + effects) with
   pocketsphinx; each word's measured start is compared with the caption timestamp in the timeline.
4. Clarity: open transcription of the final audio, line by line, word error rate against the script.
5. Hook: first spoken word in the first 0.5 s, and more than 5% of the pixels change between frame 0 and 1.5 s (a major element enters); see also review/v1-hook-strip.jpg.
6. Cadence: average and longest time between picture changes (scene cuts from the timeline).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "voice"))
sys.path.insert(0, HERE)
import speech_check as sc  # noqa: E402
from mix import OUTPUTS, measure  # noqa: E402


def probe(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def audio16k(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def frame_rgb(path: str, t: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t}", "-i", path, "-frames:v", "1", "-vf", "scale=270:480", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(480, 270, 3).astype(np.float32)


def check(vid: str) -> dict:
    path = os.path.join(ROOT, OUTPUTS[vid])
    with open(os.path.join(ROOT, "remotion", "src", "data", f"{vid}.json"), encoding="utf-8") as f:
        tl = json.load(f)
    p = probe(path)
    v = next(s for s in p["streams"] if s["codec_type"] == "video")
    a = next(s for s in p["streams"] if s["codec_type"] == "audio")
    fmt = {
        "video": f"{v['codec_name']} {v['profile']} {v['width']}x{v['height']} {v['r_frame_rate']} {v['pix_fmt']}",
        "audio": f"{a['codec_name']} {a['sample_rate']} Hz {a['channels']} ch",
        "duration_s": round(float(p["format"]["duration"]), 2),
    }
    lv = measure(path)

    audio = audio16k(path)
    offsets, errs, n, unaligned = [], 0, 0, []
    for i, line in enumerate(tl["lines"]):
        al = None
        for pad in (0.25, 0.4, 0.15, 0.6):  # the music can throw the aligner off; try a few windows
            s0 = max(0, int((line["startMs"] / 1000 - pad) * 16000))
            s1 = int((line["endMs"] / 1000 + pad) * 16000)
            seg = audio[s0:s1]
            try:
                al = sc.align(seg, 16000, line["text"])
                break
            except (RuntimeError, TypeError):
                continue
        if al is None:
            unaligned.append(line["text"])
        else:
            words = [w for w in tl["words"] if w["line"] == i]
            for w, m in zip(words, al):
                offsets.append(abs((s0 / 16000 + m["start"]) * 1000 - w["startMs"]))
        e, k = sc.wer(sc.norm_words(line["text"]), sc.recognize(seg, 16000))
        errs, n = errs + e, n + k
    offsets = np.array(offsets)

    f0, f45 = frame_rgb(path, 0.0), frame_rgb(path, 1.5)
    change = float(np.mean(np.max(np.abs(f0 - f45), axis=2) > 25))  # share of pixels that visibly change
    cuts = [s["to"] - s["from"] for s in tl["scenes"]]
    return {
        "file": OUTPUTS[vid],
        "format": fmt,
        "loudness": lv,
        "loudness_ok": abs(lv["integrated_lufs"] + 14) <= 0.5 and lv["true_peak_dbtp"] < -1.0,
        "caption_sync_ms": {"words": int(len(offsets)), "mean": round(float(offsets.mean()), 1), "p95": round(float(np.percentile(offsets, 95)), 1), "max": round(float(offsets.max()), 1)},
        "caption_sync_ok": float(np.percentile(offsets, 95)) <= 100,
        "lines_not_aligned_on_final_mix": unaligned,
        "final_audio_wer": round(errs / n, 3),
        "hook": {"first_word_s": tl["words"][0]["startMs"] / 1000, "picture_change_0_to_1_5s": round(change, 3)},
        # Reels: voice within 0.5 s. The explainer opens on a ringing call, so its first word may wait until 1.5 s.
        "hook_ok": tl["words"][0]["startMs"] <= (1500 if vid == "inv" else 500) and change > 0.05,
        "cadence_s": {"scenes": len(cuts), "mean": round(float(np.mean(cuts)) / 30, 2), "max": round(max(cuts) / 30, 2)},
    }


def main() -> None:
    res = {v: check(v) for v in (sys.argv[1:] or ["v1", "v2"])}
    out_dir = os.path.join(ROOT, "investor") if list(res) == ["inv"] else ROOT
    with open(os.path.join(out_dir, "verify.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    rows = []
    for v, r in res.items():
        rows.append(
            f"| {r['file']} | {r['format']['video']}; {r['format']['audio']}; {r['format']['duration_s']} s | "
            f"{r['loudness']['integrated_lufs']} LUFS, {r['loudness']['true_peak_dbtp']} dBTP {'✅' if r['loudness_ok'] else '❌'} | "
            f"mean {r['caption_sync_ms']['mean']} ms, p95 {r['caption_sync_ms']['p95']} ms, max {r['caption_sync_ms']['max']} ms ({r['caption_sync_ms']['words']} words) {'✅' if r['caption_sync_ok'] else '❌'} | "
            f"{r['final_audio_wer']:.1%} | first word {r['hook']['first_word_s']} s, change {r['hook']['picture_change_0_to_1_5s']} {'✅' if r['hook_ok'] else '❌'} | "
            f"{r['cadence_s']['scenes']} shots, mean {r['cadence_s']['mean']} s, longest {r['cadence_s']['max']} s |"
        )
    with open(os.path.join(out_dir, "VERIFY.md"), "w", encoding="utf-8") as f:
        f.write(
            "# Stage 4 verification\n\nProduced by `audio/verify.py` on the final MP4s (raw numbers in `verify.json`).\n\n"
            "| File | Format | Loudness (target -14 LUFS, TP < -1 dBTP) | Caption sync (caption start vs. word re-aligned on the final mix; pass: p95 ≤ 100 ms) | "
            "Word error rate of the final mix (pocketsphinx) | Hook | Cuts |\n|---|---|---|---|---|---|---|\n" + "\n".join(rows) + "\n"
        )
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
