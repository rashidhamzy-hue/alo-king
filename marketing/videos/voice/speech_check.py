"""Speech checks with pocketsphinx (BSD-2-Clause, US English model bundled in the wheel).

faster-whisper was the brief's choice, but its weights (Hugging Face) and OpenAI's Whisper weights are both unreachable
from the build sandbox, so pocketsphinx is the free fallback: open recognition for a clarity score, forced alignment for
word timestamps. Both run on 16 kHz mono int16.
"""
from __future__ import annotations

import re

import numpy as np
from pocketsphinx import Decoder
from scipy.signal import resample_poly

# Words missing from the CMU dictionary, in ARPAbet.
EXTRA_WORDS = {"arabizi": "AE R AH B IY Z IY", "alo": "AA L OW"}


def to_pcm16k(audio: np.ndarray, sr: int) -> bytes:
    if sr != 16000:
        from math import gcd

        g = gcd(16000, sr)
        audio = resample_poly(audio, 16000 // g, sr // g)
    return (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()


def _decoder(**kw) -> Decoder:
    d = Decoder(samprate=16000, loglevel="FATAL", **kw)
    for w, p in EXTRA_WORDS.items():
        if d.lookup_word(w) is None:
            d.add_word(w, p, True)
    return d


def norm_words(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r"[A-Za-z']+", text)]


def recognize(audio: np.ndarray, sr: int) -> list[str]:
    d = _decoder()
    d.start_utt()
    d.process_raw(to_pcm16k(audio, sr), full_utt=True)
    d.end_utt()
    hyp = d.hyp()
    return norm_words(hyp.hypstr) if hyp else []


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    """Word-level Levenshtein distance; returns (errors, reference length)."""
    dp = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, dp[0] = dp[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(dp[j] + 1, dp[j - 1] + 1, prev + (r != h))
            prev, dp[j] = dp[j], cur
    return dp[-1], len(ref)


def align(audio: np.ndarray, sr: int, text: str) -> list[dict]:
    """Forced alignment: one {word, start, end} per word of `text`, in seconds."""
    d = _decoder(bestpath=False)
    d.set_align_text(" ".join(norm_words(text)))
    d.start_utt()
    d.process_raw(to_pcm16k(audio, sr), full_utt=True)
    d.end_utt()
    out = []
    for s in d.seg():
        w = re.sub(r"\(\d+\)$", "", s.word)
        if w.startswith("<") or w.startswith("["):
            continue
        out.append({"word": w, "start": s.start_frame / 100, "end": (s.end_frame + 1) / 100})
    if [o["word"] for o in out] != norm_words(text):
        raise RuntimeError(f"alignment failed for {text!r}: {[o['word'] for o in out]}")
    return out
