# Stage 4 verification

Produced by `audio/verify.py` on the final MP4s (raw numbers in `verify.json`).

| File | Format | Loudness (target -14 LUFS, TP < -1 dBTP) | Caption sync (caption start vs. word re-aligned on the final mix; pass: p95 ≤ 100 ms) | Word error rate of the final mix (pocketsphinx) | Hook | Cuts |
|---|---|---|---|---|---|---|
| video1-customers.mp4 | h264 High 1080x1920 30/1 yuv420p; aac 48000 Hz 2 ch; 25.0 s | -14.2 LUFS, -5.1 dBTP ✅ | mean 25.1 ms, p95 96.0 ms, max 310.0 ms (57 words) ✅ | 50.9% | first word 0.12 s, change 0.065 ✅ | 12 shots, mean 2.08 s, longest 4.27 s |
