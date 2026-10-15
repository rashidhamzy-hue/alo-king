# Stage 4 verification

Produced by `audio/verify.py` on the final MP4s (raw numbers in `verify.json`).

| File | Format | Loudness (target -14 LUFS, TP < -1 dBTP) | Caption sync (caption start vs. word re-aligned on the final mix; pass: p95 ≤ 100 ms) | Word error rate of the final mix (pocketsphinx) | Hook | Cuts |
|---|---|---|---|---|---|---|
| video1-customers.mp4 | h264 High 1080x1920 30/1 yuv420p; aac 48000 Hz 2 ch; 25.0 s | -14.2 LUFS, -5.1 dBTP ✅ | mean 25.1 ms, p95 96.0 ms, max 310.0 ms (57 words) ✅ | 50.9% | first word 0.12 s, change 0.065 ✅ | 12 shots, mean 2.08 s, longest 4.27 s |
| video2-merchants.mp4 | h264 High 1080x1920 30/1 yuv420p; aac 48000 Hz 2 ch; 25.0 s | -14.2 LUFS, -4.9 dBTP ✅ | mean 22.7 ms, p95 40.0 ms, max 630.0 ms (63 words) ✅ | 46.0% | first word 0.12 s, change 0.111 ✅ | 9 shots, mean 2.78 s, longest 4.33 s |

## Notes
- **Caption sync.** Captions are timed from forced alignment of the *clean* voice track (`voice/build_voiceover.py`).
  This check aligns the words again on the *final mix*, with music and effects underneath, and compares the two. The
  largest gaps are artefacts of that harder re-check, not caption errors:
  - Video 1: "Pay" (310 ms window; the aligner stretched the word to 0.67 s over the pop just before it), "Hungry?"
    (over the opening whoosh), and the 70 ms function word "in".
  - Video 2: the 630 ms maximum comes from a wider retry window; with the standard 0.25 s window its worst word is
    80 ms off ("already").
- **Word error rate of the final mix** (43–51%) is pocketsphinx's open recognition with the music and effects underneath.
  The same lines on the clean voice scored 19–26% (`remotion/src/data/v*.json` → `asrCheck`). pocketsphinx is much
  weaker than Whisper, so these numbers are for comparing voices, not an absolute clarity score. See the README for why
  Whisper could not be used.
- **Hook.** The first word starts at 0.12 s in both videos. Frame strips of 0 / 0.4 / 0.8 / 1.2 / 1.5 s are in
  `review/v1-hook-strip.jpg` and `review/v2-hook-strip.jpg`:
  - Video 1: "Hungry?" fills the frame, then the 3D phone lands with the chat open.
  - Video 2: "Already" and the chat list stream in, then the gold "Alo King · New order" row lands at 1.1 s and
    "on WhatsApp." at 1.5 s. Its first version failed this check (2.3% of pixels changing) and was re-cut.
- **Cuts.** Video 1 has 12 shots (one every 2.1 s on average). Video 2 has 9 shots (every 2.8 s), and inside the longer
  shots the picture keeps changing on the words: ticket lines lighting up, Accept, then the prep-time pick, the dashboard
  tabs. The longest single shot in each video is the end card (4.3 s), held on purpose for the call to action.
- **Safe zone.** Captions are centred at y 1338 and at most two lines, so they never go below 1440 px (75%). Phone
  poses keep the phone between about 290 and 1240 px. Checked on every review frame (`review/*-sheet-safezone.jpg`).
