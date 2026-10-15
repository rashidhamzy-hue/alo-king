# Stage 4 verification

Produced by `audio/verify.py` on the final MP4s (raw numbers in `verify.json`).

| File | Format | Loudness (target -14 LUFS, TP < -1 dBTP) | Caption sync (caption start vs. word re-aligned on the final mix; pass: p95 ≤ 100 ms) | Word error rate of the final mix (pocketsphinx) | Hook | Cuts |
|---|---|---|---|---|---|---|
| investor/alo-king-investor-explainer.mp4 | h264 High 1920x1080 30/1 yuv420p; aac 48000 Hz 2 ch; 294.37 s | -14.2 LUFS, -4.9 dBTP ✅ | mean 12.4 ms, p95 40.0 ms, max 320.0 ms (638 words) ✅ | 35.3% | first word 1.3 s, change 0.025 ❌ | 40 shots, mean 7.36 s, longest 10.77 s |
