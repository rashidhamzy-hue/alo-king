"""Sound for both Reels, made in code (numpy + scipy), then mixed, loudness-normalised and muxed with ffmpeg.

  python audio/mix.py            -> out/<id>/mix.wav and the final <video>.mp4 next to this README
Sound effects sit on the cues in remotion/src/data/cues.json (the same word anchors the picture uses), plus a light whoosh on
every scene cut. The music bed is a soft pad, a plucked arpeggio and a quiet pulse, ducked under the voice.
Delivery target: -14 LUFS integrated, true peak below -1 dBTP (we aim for -1.5), H.264 + AAC 48 kHz.
"""
from __future__ import annotations

import json
import os
import re
import subprocess

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, sosfiltfilt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SR = 48000
FPS = 30
RNG = np.random.default_rng(7)  # deterministic: the same file every run

OUTPUTS = {"v1": "video1-customers.mp4", "v2": "video2-merchants.mp4", "inv": "investor/alo-king-investor-explainer.mp4"}
SIZE_CAP_MB = {"inv": 40}  # keeps the explainer easy to share and light in git


# ---------- sound effects ----------
def env(n: int, attack: float, decay: float) -> np.ndarray:
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def whoosh(dur: float = 0.42, lo: float = 250, hi: float = 3200, gain: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    noise = RNG.standard_normal(n)
    out = np.zeros(n)
    hop = 512
    for i in range(0, n, hop):  # a band that sweeps upward, crossfaded block by block
        f = lo * (hi / lo) ** (i / n)
        seg = bandpass(noise[max(0, i - 2048): i + hop], f * 0.7, min(f * 1.6, SR / 2 - 100))[-min(hop, n - i):]
        out[i: i + len(seg)] = seg
    shape = np.sin(np.linspace(0, np.pi, n)) ** 1.6
    return gain * 0.5 * out * shape / (np.max(np.abs(out)) + 1e-9)


def pop(f0: float = 950, f1: float = 520, dur: float = 0.09, gain: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.018)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return gain * 0.55 * np.sin(ph) * env(n, 0.002, 0.03)


def tap(gain: float = 1.0) -> np.ndarray:
    n = int(0.06 * SR)
    click = bandpass(RNG.standard_normal(n), 1800, 6000) * env(n, 0.0005, 0.006)
    thump = np.sin(2 * np.pi * 140 * np.arange(n) / SR) * env(n, 0.001, 0.02)
    x = 0.5 * click / (np.abs(click).max() + 1e-9) + 0.5 * thump
    return gain * 0.6 * x


def tick(gain: float = 1.0) -> np.ndarray:
    n = int(0.03 * SR)
    x = bandpass(RNG.standard_normal(n), 2500, 7000) * env(n, 0.0003, 0.004)
    return gain * 0.45 * x / (np.abs(x).max() + 1e-9)


def chime(gain: float = 1.0) -> np.ndarray:
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for delay, f in ((0.0, 1318.5), (0.085, 1975.5)):  # E6 then B6, a bright "done"
        d = int(delay * SR)
        tt = t[: n - d]
        tone = sum(a * np.sin(2 * np.pi * f * k * tt) * np.exp(-tt * (3.2 + 2.5 * k)) for k, a in ((1, 1.0), (2, 0.25), (3, 0.08)))
        out[d:] += tone
    return gain * 0.32 * out * env(n, 0.002, 10)


def printer(gain: float = 1.0) -> np.ndarray:
    n = int(0.7 * SR)
    out = np.zeros(n)
    for i in range(0, n - 2000, int(SR / 38)):  # a thermal printer's rapid line feeds
        t = tick(0.5)
        out[i: i + len(t)] += t
    motor = bandpass(RNG.standard_normal(n), 300, 1200) * 0.06
    return gain * (out + motor) * np.sin(np.linspace(0, np.pi, n)) ** 0.3


def ring(gain: float = 1.0) -> np.ndarray:
    """A soft phone ring: two quick marimba-like trills (not any phone maker's ringtone)."""
    n = int(1.4 * SR)
    out = np.zeros(n)
    notes = [76, 79, 76, 79, 76, 79]
    for burst in (0.0, 0.7):
        for i, m in enumerate(notes):
            q = pluck(m, 0.35) * 0.5
            s0 = int((burst + i * 0.07) * SR)
            out[s0: s0 + len(q)] += q[: max(0, n - s0)]
    return gain * 0.5 * out


SFX = {
    "whoosh": lambda: whoosh(gain=0.9),
    "swish": lambda: whoosh(0.26, 600, 5000, 0.7),
    "pop": lambda: pop(),
    "tap": lambda: tap(),
    "tick": lambda: tick(),
    "chime": lambda: chime(),
    "print": lambda: printer(),
    "ring": lambda: ring(),
}


# ---------- music bed ----------
def note_hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def pad_chord(midis: list[int], dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in midis:
        for det in (-0.06, 0.0, 0.07):  # three slightly detuned saw-like voices
            f = note_hz(m + det)
            out += sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7))
    out = sosfilt(butter(2, 900, btype="low", fs=SR, output="sos"), out)
    a = np.clip(t / 0.6, 0, 1) * np.clip((dur - t) / 0.5, 0, 1)
    return out * a / (len(midis) * 3)


def pluck(midi: int, dur: float = 0.9) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = note_hz(midi)
    x = sum(np.sin(2 * np.pi * f * k * t) * np.exp(-t * (4 + 3 * k)) / k for k in range(1, 6))
    return x * env(n, 0.003, 10)


def kick() -> np.ndarray:
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    f = 48 + 90 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.09)


def music(dur: float, night: bool) -> np.ndarray:
    bpm = 100
    beat = 60 / bpm
    bar = 4 * beat
    # Night: D minor, warm (Dm Bb F C). Day: F major, bright (F C Dm Bb).
    prog = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 53, 57], [48, 55, 60, 64]] if night else [[53, 60, 65, 69], [48, 55, 60, 64], [50, 57, 62, 65], [46, 53, 58, 62]]
    n = int(dur * SR)
    out = np.zeros(n + SR * 4)
    t0 = 0.0
    i = 0
    while t0 < dur:
        chord = prog[i % 4]
        s = int(t0 * SR)
        p = pad_chord(chord, bar + 0.5)
        out[s: s + len(p)] += 0.55 * p
        for b in range(8):  # eighth-note arpeggio over the chord, up an octave
            m = chord[[1, 2, 3, 2, 1, 2, 3, 2][b]] + 12
            q = pluck(m, 0.8) * (0.22 if b % 2 == 0 else 0.15)
            ss = s + int(b * beat / 2 * SR)
            out[ss: ss + len(q)] += q
        for b in range(4):
            k = kick() * 0.35
            ss = s + int(b * beat * SR)
            out[ss: ss + len(k)] += k
        t0 += bar
        i += 1
    out = out[:n]
    out = sosfiltfilt(butter(1, 60, btype="high", fs=SR, output="sos"), out)
    return out / (np.max(np.abs(out)) + 1e-9)


def music_long(dur: float, sections: list[tuple[float, bool, float]]) -> np.ndarray:
    """Long bed in sections: each (start_s, night, energy) gets its own key and density, crossfaded at the joins."""
    n = int(dur * SR)
    out = np.zeros(n)
    bounds = [s[0] for s in sections] + [dur]
    for (start, night, energy), end in zip(sections, bounds[1:]):
        seg = music(end - start + 1.2, night) * energy
        a = int(start * SR)
        b = min(n, a + len(seg), int((end + 1.0) * SR))
        fade = np.ones(b - a)
        k = min(int(0.8 * SR), len(fade) // 2)
        fade[:k] = np.linspace(0, 1, k)
        fade[-k:] = np.linspace(1, 0, k)
        out[a:b] += seg[: b - a] * fade
    return out / (np.max(np.abs(out)) + 1e-9)


# ---------- timeline ----------
def load(vid: str) -> tuple[dict, list[dict]]:
    with open(os.path.join(ROOT, "remotion", "src", "data", f"{vid}.json"), encoding="utf-8") as f:
        tl = json.load(f)
    with open(os.path.join(ROOT, "remotion", "src", "data", "cues.json"), encoding="utf-8") as f:
        cues = json.load(f)[vid]
    return tl, cues


def cue_time(tl: dict, c: dict) -> float:
    clean = lambda s: re.sub(r"[^A-Za-z0-9'\u0660-\u0669]", "", s).lower()
    line = c["line"] if "line" in c else next(s["line"] for s in tl["scenes"] if s["id"] == c["scene"])
    w = [x for x in tl["words"] if x["line"] == line and clean(x["text"]) == clean(c["word"])][c.get("nth", 0)]
    frame = round((w["startMs"] + c.get("offsetMs", 0)) / 1000 * FPS)  # same rounding as the picture
    return max(0.0, frame / FPS)


def place(buf: np.ndarray, x: np.ndarray, t: float, gain: float = 1.0) -> None:
    s = int(t * SR)
    if s < 0:
        x, s = x[-s:], 0
    e = min(len(buf), s + len(x))
    if e > s:
        buf[s:e] += gain * x[: e - s]


def db(x: float) -> float:
    return 10 ** (x / 20)


def build(vid: str) -> dict:
    tl, cues = load(vid)
    dur = tl["durationInFrames"] / FPS
    n = int(dur * SR)
    voice, sr = sf.read(os.path.join(ROOT, "out", vid, "voice.wav"), dtype="float64")
    assert sr == SR
    voice = np.pad(voice, (0, max(0, n - len(voice))))[:n]

    sfx = np.zeros(n)
    times = []
    for c in cues:
        if "sfx" in c:
            t = cue_time(tl, c)
            place(sfx, SFX[c["sfx"]](), t - (0.18 if c["sfx"] in ("whoosh", "swish") else 0.0))
            times.append(t)
    for s in tl["scenes"][1:]:  # a light whoosh on every cut that has no cue of its own nearby
        t = s["from"] / FPS
        if all(abs(t - x) > 0.2 for x in times):
            place(sfx, whoosh(0.32, 400, 4000, 0.45), t - 0.14)

    if vid == "inv":
        # Chapter energy: quiet open, build through the product, day key for merchants, lift for the close.
        energy = {0: 0.55, 1: 0.7, 2: 0.75, 3: 0.95, 4: 0.85, 5: 0.9, 6: 0.95, 7: 0.9, 8: 0.8, 9: 0.85, 10: 0.95, 11: 1.0}
        starts = {}
        for sc in tl["scenes"]:
            starts.setdefault(sc["chapter"], sc["from"] / FPS)
        sections = [(starts[c], c != 6, energy[c]) for c in sorted(starts)]
        bed = music_long(dur, sections)
    else:
        bed = music(dur, night=vid == "v1")
    # Duck the bed under the voice: a smoothed voice envelope pulls the music down by up to 7 dB.
    venv = np.convolve(np.abs(voice), np.ones(int(0.12 * SR)) / int(0.12 * SR), mode="same")
    duck = 1 - (1 - db(-7)) * np.clip(venv / 0.04, 0, 1)
    duck = np.convolve(duck, np.ones(int(0.08 * SR)) / int(0.08 * SR), mode="same")
    last_word = tl["lines"][-1]["endMs"] / 1000
    t = np.arange(n) / SR
    swell = 1 + 0.6 * np.clip((t - last_word) / 0.6, 0, 1)  # the bed lifts on the end card
    fade = np.clip((dur - t) / 0.7, 0, 1) * np.clip(t / 0.05, 0, 1)

    v_rms = np.sqrt(np.mean(voice[np.abs(voice) > 0.01] ** 2))
    parts = {"voice": voice, "sfx": sfx * v_rms / 0.18 * db(-6.5), "music": bed * duck * swell * fade * v_rms * db(-2)}
    mix = sum(parts.values()) * fade ** 0.25
    stems = os.path.join(ROOT, "out", vid, "stems")
    os.makedirs(stems, exist_ok=True)
    pre = os.path.join(ROOT, "out", vid, "premix.wav")
    scale = 0.7 / (np.max(np.abs(mix)) + 1e-9)
    sf.write(pre, (mix * scale).astype(np.float32), SR, subtype="FLOAT")
    for k, x in parts.items():  # stems at their exact level in the pre-mix, for the balance check in the README
        sf.write(os.path.join(stems, f"{k}.wav"), (x * scale).astype(np.float32), SR, subtype="FLOAT")
    return loudnorm_and_mux(vid, pre)


def loudnorm_and_mux(vid: str, pre: str) -> dict:
    """Gain to -14 LUFS through a look-ahead limiter, iterated (the limiter takes back a little loudness each pass).
    The limiter ceiling (-2.3 dBFS sample peak) leaves room for inter-sample peaks and the AAC encoder, so true peak stays
    under -1 dBTP; the final MP4 is measured again below."""
    mixed = os.path.join(ROOT, "out", vid, "mix.wav")
    gain = -14 - measure(pre)["integrated_lufs"]
    for _ in range(4):
        af = f"volume={gain:.2f}dB,alimiter=limit=0.767:attack=3:release=60:level=disabled:asc=1"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", pre, "-af", af, "-ar", "48000", "-c:a", "pcm_s24le", mixed], check=True)
        got = measure(mixed)["integrated_lufs"]
        if abs(got + 14) <= 0.2:
            break
        gain += -14 - got
    final = os.path.join(ROOT, OUTPUTS[vid])
    if vid in SIZE_CAP_MB:
        encode_capped(vid, mixed, final, SIZE_CAP_MB[vid])
        return measure(final)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", os.path.join(ROOT, "out", vid, "silent.mp4"), "-i", mixed,
                    "-map", "0:v:0", "-map", "1:a:0",
                    # Re-encode to broadcast-range yuv420p (Remotion's JPEG frames come out full-range yuvj420p, which some
                    # players and Instagram's transcoder show with lifted blacks).
                    "-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
                    "-profile:v", "high", "-level", "4.1", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709",
                    "-color_trc", "bt709", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                    "-movflags", "+faststart", "-shortest", final], check=True)
    return measure(final)


def encode_capped(vid: str, mixed: str, final: str, cap_mb: float) -> None:
    """Two-pass H.264 at the bitrate that lands under the size cap (AAC 160k), broadcast-range yuv420p."""
    silent = os.path.join(ROOT, "out", vid, "silent.mp4")
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent], capture_output=True, text=True).stdout)
    v_kbps = int((cap_mb * 0.95 * 8 * 1024 * 1024 / dur) / 1000) - 160
    common = ["-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-tune", "animation",
              "-b:v", f"{v_kbps}k", "-maxrate", f"{int(v_kbps * 2)}k", "-bufsize", f"{int(v_kbps * 4)}k", "-profile:v", "high", "-level", "4.1",
              "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    log = os.path.join(ROOT, "out", vid, "x264")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", silent, *common, "-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", os.devnull], check=True)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", silent, "-i", mixed, "-map", "0:v:0", "-map", "1:a:0", *common,
                    "-pass", "2", "-passlogfile", log, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", final], check=True)


def measure(path: str) -> dict:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    summ = r[r.rindex("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ).group(1))
    lra = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summ).group(1))
    return {"file": os.path.basename(path), "integrated_lufs": i, "true_peak_dbtp": tp, "lra_lu": lra}


if __name__ == "__main__":
    import sys

    report = {v: build(v) for v in (sys.argv[1:] or ["v1", "v2"])}
    for v in report:
        report[v]["size_mb"] = round(os.path.getsize(os.path.join(ROOT, OUTPUTS[v])) / 1048576, 1)
    print(json.dumps(report, indent=2))
