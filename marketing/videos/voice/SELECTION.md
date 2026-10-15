# Voice selection

All 17 script lines (both videos) synthesised with each Kokoro voice at speed 1.0, then transcribed back with pocketsphinx and force-aligned. Method and weights: `select_voice.py`. Samples (first three lines of video 1): `samples/<voice>.opus`.

| Rank | Voice | Word error rate | Words/s | Rate CV | Loudness SD (dB) | Clarity | Steadiness | Score |
|---|---|---|---|---|---|---|---|---|
| 1 | `bm_george` | 25.8% (31/120) | 2.76 | 0.152 | 0.37 | 0.742 | 0.665 | **0.719** |
| 2 | `af_heart` | 26.7% (32/120) | 3.43 | 0.183 | 0.59 | 0.733 | 0.585 | **0.689** |
| 3 | `am_michael` | 30.8% (37/120) | 3.09 | 0.168 | 0.7 | 0.692 | 0.607 | **0.666** |
| 4 | `af_sarah` | 30.0% (36/120) | 3.47 | 0.187 | 0.67 | 0.700 | 0.571 | **0.661** |
| 5 | `af_aoede` | 32.5% (39/120) | 3.75 | 0.164 | 0.55 | 0.675 | 0.625 | **0.660** |
| 6 | `am_fenrir` | 33.3% (40/120) | 3.78 | 0.182 | 0.54 | 0.667 | 0.591 | **0.644** |
| 7 | `af_bella` | 34.2% (41/120) | 3.42 | 0.208 | 0.56 | 0.658 | 0.537 | **0.622** |
| 8 | `am_puck` | 37.5% (45/120) | 3.96 | 0.168 | 0.64 | 0.625 | 0.611 | **0.621** |
| 9 | `af_nicole` | 33.3% (40/120) | 2.41 | 0.231 | 0.76 | 0.667 | 0.474 | **0.609** |
| 10 | `bf_emma` | 55.8% (67/120) | 3.39 | 0.165 | 0.48 | 0.442 | 0.630 | **0.498** |

**Winner: `bm_george`.**
