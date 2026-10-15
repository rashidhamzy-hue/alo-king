"""Pick the voice objectively: synthesise every script line with each candidate, transcribe it back, keep the clearest and
steadiest. Writes voice/selection.json, voice/SELECTION.md and a short Opus sample per candidate in voice/samples/.

Score = 0.7 × clarity + 0.3 × steadiness
  clarity    = 1 − word error rate of pocketsphinx's transcript against the script (both videos, all lines)
  steadiness = 1 − ½·min(1, CV of speaking rate across lines / 0.25) − ½·min(1, SD of line loudness in dB / 6)
Speaking rate per line = words / aligned speech time; loudness per line = RMS in dBFS over the aligned speech.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
import kokoro_tts as k  # noqa: E402
import speech_check as sc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "scripts")
CANDIDATES = [
    "af_heart", "af_bella", "af_nicole", "af_sarah", "af_aoede",
    "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george",
]


def lines() -> list[str]:
    out = []
    for f in ("video1.json", "video2.json"):
        with open(os.path.join(SCRIPTS, f), encoding="utf-8") as fh:
            out += [l["text"] for l in json.load(fh)["lines"]]
    return out


def evaluate(voice: str, texts: list[str]) -> dict:
    errs = total = 0
    rates, levels, worst = [], [], []
    clips = []
    for t in texts:
        a = k.synthesize(t, voice)
        clips.append(a)
        e, n = sc.wer(sc.norm_words(t), sc.recognize(a, k.SAMPLE_RATE))
        errs += e
        total += n
        al = sc.align(a, k.SAMPLE_RATE, t)
        s, e2 = al[0]["start"], al[-1]["end"]
        rates.append(len(al) / max(e2 - s, 1e-3))
        seg = a[int(s * k.SAMPLE_RATE): int(e2 * k.SAMPLE_RATE)]
        levels.append(20 * np.log10(np.sqrt(np.mean(seg**2)) + 1e-9))
        worst.append(float(np.max(np.abs(a))))
    w = errs / total
    cv = float(np.std(rates) / np.mean(rates))
    sd = float(np.std(levels))
    clarity = 1 - w
    steadiness = 1 - 0.5 * min(1, cv / 0.25) - 0.5 * min(1, sd / 6)
    sample = np.concatenate([np.concatenate([c, np.zeros(int(0.25 * k.SAMPLE_RATE), np.float32)]) for c in clips[:3]])
    return {
        "voice": voice,
        "wer": round(w, 4),
        "word_errors": errs,
        "words": total,
        "rate_wps_mean": round(float(np.mean(rates)), 2),
        "rate_cv": round(cv, 4),
        "loudness_sd_db": round(sd, 2),
        "peak_max": round(max(worst), 3),
        "clarity": round(clarity, 4),
        "steadiness": round(steadiness, 4),
        "score": round(0.7 * clarity + 0.3 * steadiness, 4),
        "_sample": sample,
    }


def main() -> None:
    texts = lines()
    os.makedirs(os.path.join(HERE, "samples"), exist_ok=True)
    results = []
    for v in CANDIDATES:
        r = evaluate(v, texts)
        wav = f"/tmp/alo-sample-{v}.wav"
        sf.write(wav, r.pop("_sample"), k.SAMPLE_RATE)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", "32k",
                        os.path.join(HERE, "samples", f"{v}.opus")], check=True)
        results.append(r)
        print(json.dumps(r))
    results.sort(key=lambda r: r["score"], reverse=True)
    with open(os.path.join(HERE, "selection.json"), "w", encoding="utf-8") as f:
        json.dump({"winner": results[0]["voice"], "results": results}, f, indent=2)
    rows = "\n".join(
        f"| {i + 1} | `{r['voice']}` | {r['wer']:.1%} ({r['word_errors']}/{r['words']}) | {r['rate_wps_mean']} | "
        f"{r['rate_cv']:.3f} | {r['loudness_sd_db']} | {r['clarity']:.3f} | {r['steadiness']:.3f} | **{r['score']:.3f}** |"
        for i, r in enumerate(results)
    )
    with open(os.path.join(HERE, "SELECTION.md"), "w", encoding="utf-8") as f:
        f.write(
            "# Voice selection\n\n"
            f"All {len(texts)} script lines (both videos) synthesised with each Kokoro voice at speed 1.0, then transcribed "
            "back with pocketsphinx and force-aligned. Method and weights: `select_voice.py`. Samples (first three lines of "
            "video 1): `samples/<voice>.opus`.\n\n"
            "| Rank | Voice | Word error rate | Words/s | Rate CV | Loudness SD (dB) | Clarity | Steadiness | Score |\n"
            "|---|---|---|---|---|---|---|---|---|\n"
            f"{rows}\n\n**Winner: `{results[0]['voice']}`.**\n"
        )


if __name__ == "__main__":
    main()
