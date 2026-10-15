"""Kokoro-82M text-to-speech without espeak.

Phonemes come from misaki's US English lexicons (Apache-2.0) plus a small override table for brand words. The espeak-ng
fallback that misaki and kokoro-onnx use for unknown words is GPL-3.0, so it is not used: an unknown word raises instead,
and gets an entry in OVERRIDES. Model input follows kokoro-js 1.2.1: ids padded with 0 at both ends, style row = phoneme count.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache

import numpy as np
import onnxruntime as ort

MODELS = os.environ.get("MODELS", "/tmp/alo-voice-models")
SAMPLE_RATE = 24000

# Brand and channel words, plus words whose lexicon default is the wrong part of speech in these scripts.
OVERRIDES = {
    "whatsapp": "wˈʌtsˌæp",
    "arabizi": "ˌɛɹəbˈizi",
    "alo": "ɑlˈO",
    "arrives": "əɹˈIvz",
    "live": "lˈɪv",  # "customers already live on WhatsApp" (verb)
    "the": "ðə",
    "a": "ə",
}

_TOKEN = re.compile(r"[A-Za-z']+|[.,!?;:—]")


@lru_cache(maxsize=1)
def _lexicon() -> dict:
    lex: dict = {}
    for name in ("us_silver.json", "us_gold.json"):  # gold wins
        with open(os.path.join(MODELS, name), encoding="utf-8") as f:
            lex.update(json.load(f))
    return lex


@lru_cache(maxsize=1)
def _vocab() -> dict:
    with open(os.path.join(MODELS, "config.json"), encoding="utf-8") as f:
        return json.load(f)["vocab"]


@lru_cache(maxsize=1)
def _session() -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = os.cpu_count() or 4
    return ort.InferenceSession(os.path.join(MODELS, "kokoro-v1.0-fp32.onnx"), opts, providers=["CPUExecutionProvider"])


def word_phonemes(word: str) -> str:
    key = word.lower()
    if key in OVERRIDES:
        return OVERRIDES[key]
    lex = _lexicon()
    for k in (word, key, key.capitalize()):
        v = lex.get(k)
        if v is not None:
            return v["DEFAULT"] if isinstance(v, dict) else v
    raise KeyError(f"no pronunciation for {word!r}: add it to OVERRIDES")


def phonemize(text: str) -> str:
    out = ""
    for tok in _TOKEN.findall(text):
        if re.match(r"[.,!?;:—]", tok):
            out = out.rstrip() + tok + " "
        else:
            out += word_phonemes(tok) + " "
    return out.strip()


def words(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text) if not re.match(r"[.,!?;:—]", t)]


def voice_tensor(voice: str) -> np.ndarray:
    data = np.fromfile(os.path.join(MODELS, "voices", f"{voice}.bin"), dtype=np.float32)
    return data.reshape(-1, 256)


def synthesize(text: str, voice: str, speed: float = 1.0) -> np.ndarray:
    phonemes = phonemize(text)
    vocab = _vocab()
    ids = [vocab[c] for c in phonemes if c in vocab]
    style = voice_tensor(voice)[min(len(ids), 509)][None, :]
    feed = {
        "input_ids": np.array([[0, *ids, 0]], dtype=np.int64),
        "style": style.astype(np.float32),
        "speed": np.array([speed], dtype=np.float32),
    }
    return _session().run(None, feed)[0][0].astype(np.float32)
