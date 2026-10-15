# Alo King marketing videos

**New (15 October 2026): the investor and partner explainer** is in [`investor/`](investor/README.md): one 16:9 video,
about 5 minutes, covering how Alo King works end to end. The two Reels below were the first test. Their MP4s were removed
from the branch at the owner's request to save space; their scripts, code, review frames and check results stay here, and
`node remotion/render.mjs video` plus `audio/mix.py v1 v2` rebuild them.

## The Reels (first test)

Two English Reels for Instagram and Facebook: 1080×1920, 30 fps, H.264 + AAC, 25 seconds each. They were built with free
tools only: no paid APIs, no keys, no Higgsfield, ElevenLabs or Canva. Nothing here touches the app. Everything lives in
`marketing/videos/` on branch `marketing/videos-test`, cut from `rebuild/lebanon`.

| File | For | What it says |
|---|---|---|
| [`video1-customers.mp4`](video1-customers.mp4) | customers | Order by typing, voice note or tapping in WhatsApp; check and confirm the basket in the chat; pay and track in the same thread; Send Home for family in Lebanon from abroad. Ends on "Order on WhatsApp". |
| [`video2-merchants.mp4`](video2-merchants.mp4) | merchants | Customers already live on WhatsApp; orders arrive as clean tickets; accept with one tap and set prep time; no new app for customers; one place for orders, menu and hours. Ends on "Claim your shop". |

- Scripts, and every claim traced to `docs/decisions/DECISIONS.md` (plus what was cut and why): [`scripts/SCRIPTS.md`](scripts/SCRIPTS.md)
- Voice selection table and samples: [`voice/SELECTION.md`](voice/SELECTION.md), `voice/samples/`
- Review frames (five per video, with safe-zone sheets): `review/`
- Stage 4 checks (loudness, true peak, caption sync, hook, cuts): [`VERIFY.md`](VERIFY.md), `verify.json`

## Results (stage 4)
| | Video 1, customers | Video 2, merchants |
|---|---|---|
| Format | H.264 High, yuv420p, 1080×1920, 30 fps, 25.0 s; AAC 48 kHz stereo | same |
| Loudness / true peak | -14.2 LUFS / -5.1 dBTP | -14.2 LUFS / -4.9 dBTP |
| Caption sync (final mix) | mean 25 ms, p95 96 ms | mean 23 ms, p95 40 ms |
| Hook | voice at 0.12 s; "Hungry?" fills the frame, then the 3D phone lands with the chat open by 1.2 s | voice at 0.12 s; chat list streams in, then the "new order" row lands at 1.1 s |
| Cuts | 12 shots, average 2.1 s | 9 shots, average 2.8 s, with in-shot changes on the words |

All five stages are done. Each stage was committed and pushed as it finished.

## Before posting (from the decisions)
- **Paid ads wait for the §1 gate:** 15 merchants live and 14 days of the four reliability numbers. Organic posting is
  the owner's call.
- **Video 1, scene 8 (Send Home)** describes a feature that switches on when Tap approves the SARL and the lawyer's
  letter covers collection (§22.6). Hold video 1 until then, or cut that scene (see `scripts/SCRIPTS.md`).
- **No link or number on the end cards.** `aloking.com` isn't bought yet (#74), and the customer and merchant WhatsApp
  numbers don't exist yet. Put the link in the post caption once it exists.

## How it's made
1. **Scripts** (`scripts/video1.json`, `video2.json`): one line of voice-over per scene, checked against DECISIONS.md.
2. **Voice** (`voice/`): Kokoro-82M on CPU. Phonemes come from misaki's US lexicons with no espeak (GPL); see below.
   Each line is synthesised separately, trimmed and placed on a 25 s timeline. Word timestamps come from pocketsphinx
   forced alignment. Output: `remotion/src/data/v1.json` and `v2.json` (lines, words, scene cuts).
3. **Picture** (`remotion/`): Remotion 4 with React and TypeScript.
   - **Phone:** built from Three.js primitives through `@remotion/three` (an extruded rounded-rectangle body with a
     bevel, glass face, side buttons and camera ring, lit by Three's procedural `RoomEnvironment`).
   - **Chat screen:** real HTML (WhatsApp-style bubbles, voice note, list sheet, branded basket card, status updates),
     pinned to the phone's glass with a per-frame homography (`lib/homography.ts`), so it stays sharp at any angle.
   - **Motion and text:** spring-eased phone poses per scene, kinetic type, Lucide icons, and word-highlighted captions
     timed from the alignment.
   - **Cues:** every visual event and sound cue is anchored to a spoken word in `src/data/cues.json`. The picture and the
     mixer read the same file, so they can't drift.
4. **Sound** (`audio/mix.py`): whooshes, pops, taps, ticks, a chime and a thermal-printer burst, all synthesised with
   numpy/scipy. The music bed is a soft pad, a plucked arpeggio and a quiet pulse; D minor at night (video 1), F major by
   day (video 2), 100 BPM. The bed ducks up to 7 dB under the voice and lifts on the end card. Balance in the pre-mix:
   voice -19.6 LUFS, effects about 12 LU under, music about 19 LU under. Then a measured gain into a look-ahead limiter,
   iterated to -14 LUFS, and AAC 192k muxed onto the H.264 picture.
5. **Checks** (`audio/verify.py`): see [`VERIFY.md`](VERIFY.md).

### Rebuild
```bash
cd marketing/videos
MODELS=/tmp/alo-voice-models voice/fetch_models.sh          # Kokoro weights, voices, vocab and lexicons from npm/PyPI (325 MB, not committed)
python3 -m venv .venv && .venv/bin/pip install numpy scipy soundfile onnxruntime pocketsphinx
MODELS=/tmp/alo-voice-models .venv/bin/python voice/select_voice.py      # optional: re-run the voice choice (≈5 min)
MODELS=/tmp/alo-voice-models .venv/bin/python voice/build_voiceover.py   # voice.wav + timelines
cd remotion && npm ci && node render.mjs frames && node render.mjs video && cd ..   # review frames, silent picture (set REMOTION_BROWSER if not in this sandbox)
.venv/bin/python audio/mix.py && .venv/bin/python audio/verify.py        # final MP4s + VERIFY.md
```

## Decisions (made without asking, per the brief)
- **Source files.** The brief names `claude/HANDOFF-2026-10-07.md` and `claude/DECISIONS-LEBANON-REBUILD-2026-10.md`.
  Those are the claude.ai project copies; in the repo they are `docs/decisions/HANDOFF.md` and
  `docs/decisions/DECISIONS.md` (HANDOFF line 3 says so). I used the repo copies on `rebuild/lebanon` as of 15 October 2026.
- **Branch.** `marketing/videos-test` from `origin/rebuild/lebanon`, as asked. No PR: it's a test branch with no app
  change, and CLAUDE.md's automerge flow is for app work.
- **Skills.** I installed `frontend-design` (from `anthropics/skills`, Apache-2.0) and the 12 `remotion-dev/skills`
  agent skills at user level (`~/.claude/skills/`), not in the repo's `.claude/skills/`, so this branch changes nothing
  outside `marketing/videos/`.
- **Brand.** From the repo's design system (`src/design/`):
  - colours: ink `#17131A`, Crown Gold `#F4B63C`, cream `#FFF9F0`, paper `#FFFDF8`;
  - the hand-drawn crown (copied from `Crown.tsx`), the Chouf contour lines (copied from `contours.generated.ts`) and the
    site's chat-bubble language (customer bubbles gold with ink text);
  - type: Plus Jakarta Sans 800 set tight, and IBM Plex Sans Arabic.

  Its own rule decides the tones: customers live at night (video 1 is ink and gold), businesses work by day (video 2 is
  cream and paper with the ink "counter" panel). Gold is never text on cream (§5). On cream it is only a fill with ink
  on it, as in the active caption word and the crown disc.
- **Grid and type scale** (`remotion/src/brand/tokens.ts`): 80 px side margins, safe band from 269 px (14%) to 1440 px
  (75%), captions centred at y 1338. Type scale: 300 / 132 / 96 / 64 (captions) / 44 px. Three spring presets for
  every entrance.
- **Captions:** 64 px, weight 800. Pages are phrases of up to 4 words, split evenly so no page strands a single word.
  Exactly one word is lit (gold pill, ink text) at a time.
- **Voice.** `bm_george` won the objective test: lowest word error rate (25.8%) and the steadiest delivery out of 10
  Kokoro voices, scored on all 17 script lines. Clarity was close to `af_heart` (31 against 32 errors in 120 words), so
  steadiness decided it. Read speed is 1.01× in video 1 and 1.14× in video 2 (fitted so the voice ends at 23.1 s and the
  end card holds for 1.9 s). Caveat: pocketsphinx is a US English recogniser, which may slightly favour or penalise
  accents, and both British voices were among the candidates.
- **Prices and payment on screen.** The basket card shows items and quantities only, plus "Total shown in USD and LBP,
  rate locked on the order" (§13, CLAUDE.md dual currency). No amounts. The pay step shows cash on delivery in USD or
  LBP (§1, §34 step 8) and nothing about Whish or cards. Prep-time chips (10/20/30 min) are the merchant's own choice
  in the UI, not a delivery promise.
- **Example content** is generic and claim-free: dishes (shawarma, manakish, ayran), the "Mom · Baakline" address-book
  example (§22.2 #11), order code A27, and chat names like "Family" and "Football Sunday". No real merchant is named,
  and no brand-name drink (the §37.3 "pepsi" example became "ayran").
- **No WhatsApp logo** (trademark): generic bubbles, the design system's `--wa` green on the mic button and online dot,
  and the word "WhatsApp" only to name the channel.

## Skipped or changed, and why
| Asked for | What happened | Why |
|---|---|---|
| faster-whisper for voice choice and word timestamps | **pocketsphinx 5** (BSD-2, US English model inside the wheel): open recognition for the clarity score, forced alignment for word timestamps | Failed twice, so per the brief I took the simpler free alternative: faster-whisper's models (Hugging Face) and OpenAI's Whisper weights (`openaipublic.azureedge.net`) are both blocked here. Forced alignment of the known script is the more exact source of caption timing anyway. |
| Kokoro-82M from the official source | Same weights from npm mirrors (`kokoro-fp32a/b/c-shards`, Apache-2.0), joined back into one file; voices from the official `kokoro-js` npm package | Hugging Face is blocked here. The joined file is exactly the official fp32 export's size (325,532,232 bytes). Its SHA-256 is pinned in `voice/fetch_models.sh`; I couldn't compare it with Hugging Face's hash from here. ONNX holds no executable code, and the speech it produces passed the recognition check. |
| Kokoro's usual phonemizer | misaki lexicon lookup only, plus a short override table (`WhatsApp`, `Arabizi`, `Alo`) | Both misaki's and kokoro-onnx's fallback is espeak-ng, which is GPL-3.0 and outside the MIT/Apache/OFL/CC0/ISC rule. All 120 script words are covered without it. |
| Piper as fallback | Not needed | Kokoro worked. Also: Piper's voices are on Hugging Face (blocked here), and `piper-tts` ≥ 1.3 is GPL-3.0 (1.2.0 was MIT), so it would need care. |
| Generative image/video model (optional) | Skipped | None that is Apache/MIT/CC0 and fast on a 4-core CPU was reachable: model hubs are blocked, and the brief's "no stock look" and §37.2 ("no stock photos of people") point to illustrated UI anyway. |
| Blender hero shot (optional) | Skipped | Not installed, and blender.org is blocked. The Three.js phone already covers the 3D hero. |
| `npx skills add remotion-dev/skills` | Cloned over git and copied to `~/.claude/skills/` | github.com HTTP downloads are blocked here, but `git` over GitHub works. |
| Google Fonts (Remotion's `@remotion/google-fonts`) | `@fontsource` packages from npm, loaded with `@remotion/fonts` | fonts.gstatic.com is blocked here. Local files also make renders deterministic. |
| Remotion's `@remotion/transitions` | Not used; cuts and moves are springs written by hand | Its npm license field is "UNLICENSED", so I left it out. |
| Remotion's own Chrome download | Playwright's `chromium_headless_shell-1194` with ANGLE/SwiftShader (`swangle`) for WebGL | Already in the sandbox, and it works. The full Chromium binary no longer supports the old headless mode. |

## Licenses
Everything that ends up in the videos, or produced them, is listed here.

| Item | Version / source | License | Role |
|---|---|---|---|
| Remotion (`remotion`, `@remotion/cli`, renderer, bundler) | 4.0.535, npm | Remotion License, free tier (see below) | rendering |
| `@remotion/three`, `@remotion/fonts` | 4.0.535, npm | MIT | 3D canvas, font loading |
| three | 0.186.1 | MIT | phone geometry, materials, `RoomEnvironment` |
| @react-three/fiber | 9.8.2 | MIT | React renderer for Three |
| react, react-dom | 19.2.0 | MIT | |
| lucide-react | 1.57.0 | ISC | icons |
| Plus Jakarta Sans (`@fontsource/plus-jakarta-sans`) | 5.3.0 | OFL-1.1 (text in `remotion/public/fonts/`) | Latin type |
| IBM Plex Sans Arabic (`@fontsource/ibm-plex-sans-arabic`) | 5.3.0 | OFL-1.1 (text in `remotion/public/fonts/`) | Arabic type |
| Roboto (`@fontsource/roboto`) | 5.2.8 | OFL-1.1 (text in `remotion/public/fonts/`) | WhatsApp screens in the investor explainer |
| TypeScript | 5.9.3 | Apache-2.0 | build |
| Kokoro-82M v1.0 ONNX weights (fp32) | npm `kokoro-fp32a/b/c-shards` 1.0.0 | Apache-2.0 | voice model |
| Kokoro voice tensors (`bm_george` used; 10 tested) | npm `kokoro-js` 1.2.1 (hexgrad, Xenova) | Apache-2.0 | voice |
| Kokoro phoneme vocabulary (`config.json`) | PyPI `kokoro-onnx` 0.6.1 wheel, data file only | MIT (package); Apache-2.0 (Kokoro config) | voice |
| misaki US lexicons (`us_gold.json`, `us_silver.json`) | PyPI `misaki` 0.7.4 wheel, data files only | Apache-2.0 | phonemes |
| onnxruntime | 1.31.0, PyPI | MIT | voice inference |
| pocketsphinx (with its bundled US English model) | 5.1.1, PyPI | BSD-2-Clause | recognition and alignment (fallback for faster-whisper) |
| numpy, scipy, soundfile | 2.5.4, 1.18.1, 0.14.0 | BSD-3-Clause | audio synthesis and I/O |
| Sound effects and music | made in `audio/mix.py` | ours (no samples used) | sound |
| Crown, contour lines, colours | this repo, `src/design/` | the repo's own brand assets | brand |
| frontend-design skill | `anthropics/skills` | Apache-2.0 | design guidance (not shipped) |
| Remotion agent skills | `remotion-dev/skills` | per repo | guidance (not shipped) |
| Encoders: ffmpeg 6.1.1 (Ubuntu) and Remotion's bundled ffmpeg/x264 | system / npm | LGPL/GPL tools | encoding only; no part of them is in the videos |

BSD-2/BSD-3 (pocketsphinx, numpy, scipy, soundfile) are permissive licenses that allow commercial use, in the same family
as MIT and ISC. The encoders are GPL/LGPL programs that are run, not distributed. Their output (the MP4s) carries no GPL
obligation. Swapping them for OpenH264 (BSD) is possible if wanted.

### Remotion license (checked 15 October 2026)
I read this from `LICENSE.md` inside the `remotion@4.0.535` npm package (remotion.dev itself is blocked here).

- **Free License:** covers "a for-profit organization with up to 3 employees" (also individuals and non-profits) and
  allows use "non-commercially or commercially for the purpose of creating videos". A Company License is needed only
  above that size.
- **Alo King qualifies.** It has three partners (Rasheed, Bassem, Firas; DECISIONS §7), and the owner confirmed on
  15 October 2026 that it will never have more than three owners. If it ever *employs* more than three people, check
  the terms again (the free tier counts employees).
- **Remotion 5.** The file says the license "will slightly change" in 5.0. These videos pin 4.0.535.
- **Open-source status.** Remotion is source-available, not OSI open source. It is the one exception to the
  MIT/Apache/OFL/CC0/ISC rule, accepted because the brief names Remotion.
