# Alo King explainer for investors and partners

**[`alo-king-investor-explainer.mp4`](alo-king-investor-explainer.mp4)**: 1920×1080, 30 fps, 4 min 54 s, H.264 + AAC,
37.9 MB. In English, with word-highlighted captions so it works muted. The plan and the claims table are in
[`PLAN.md`](PLAN.md), the voice script in [`script.json`](script.json), the checks in [`VERIFY.md`](VERIFY.md), and one
frame per chapter in `review/`.

## What it covers (11 chapters)
| # | Chapter | What the viewer sees |
|---|---|---|
| 0 | ألو | A WhatsApp-style call rings, "ألو" lights up like a shop sign, and it turns into the Alo King crown |
| 1 | Why not another app | Lebanese families' WhatsApp chats (voice notes, Arabizi, water and gas); the app download and sign-up wall; 22–30% commission on a $20 receipt; village shops with only a phone |
| 2 | One chat, one brain | Customer talks → AI understands → server decides prices, payments, order states |
| 3 | The customer | On a 3D phone in WhatsApp's own colours and layout: typed order, voice note, list menu, four languages mixed, one catalogue search, the basket at $12.50 = 1,118,750 LBP (locked rate), Confirm, cash on delivery or Whish checkout, accepted, the driver's live location |
| 4 | Send Home | Arcs from the diaspora to Lebanon; a scheduled birthday gift with a note, in both time zones; "on its way to Mom" |
| 5 | The brain, memory, agents | Zero-AI path for taps against one model call for free text; typed tools so the AI never invents a price; "what I remember" with one-tap delete; the merchant copilot ("خلصت الكنافة" → confirm); the learning loop for voice |
| 6 | The merchants engine | By day: every shop pre-listed with "Ask them to join"; claim by code; one order fanned out to WhatsApp, portal, printer, call, POS; 15 / 45 / 75 s escalation; $1 flat against 22–30% |
| 7 | Drivers and dispatch | Three delivery modes behind one adapter; the dispatch brain on the real Shouf map; drivers working from WhatsApp and a live link; the map learning landmarks and door points |
| 8 | The database | One source of truth: 2,000+ places, 203 dishes, versioned menus, a race-tested order engine, the append-only ledger in USD and LBP |
| 9 | The business model | Launch prices from the dated price table ($1 order fee, $0.08 broadcast message, $0.40 sponsored order, $1.50 Send Home) and about $0.15 variable cost per order |
| 10 | Where we are | 314 merchants, 12 shop villages, 61 villages in the delivery zone (lit on the real map); what is built; the simulator passing 11/11; what comes next |
| 11 | Close | ألو → Alo King. "Let's talk." |

## Before sharing
- **Contact line:** the end card says "Let's talk." with no contact details, because the domain and numbers don't exist
  yet. Put your email or number in the message that carries the video.
- **Online payments are on the roadmap, not live.** Whish and card checkout appear as product features; chapter 10
  says online payments come after the lawyer's sign-off (DECISIONS §20.1), and Send Home card payments need Tap's
  approval (§22.6).
- **Numbers:** every number is from DECISIONS or HANDOFF as of 15 October 2026. Re-check them before sharing a later
  copy: 314 merchants, 61 places, 11/11 scenarios, the launch prices.

## How it differs from the Reels (owner's notes, 15 October)
- **Voice:** slower, 0.90× instead of 1.01× and 1.14×, with 0.45 s between lines and 1.1 s between chapters. Same
  objectively chosen voice (`bm_george`).
- **"Alo" pronunciation:** said as Lebanese pick up the phone: **ألو**, phonemes `ʔalˈoː` (a short a, a pure long o,
  stressed at the end, not the English "oh" diphthong). It is shown in Arabic at the open and the close.
- **Real WhatsApp look:**
  - colours: green header `#008069`, beige wallpaper `#EFEAE2` with doodles, light-green sent bubbles `#D9FDD3` with
    tails, white received bubbles, blue ticks `#53BDEB`, the green mic button;
  - layout: the date pill, reply buttons, the "View menu" list sheet, the chat list and the call screen;
  - Roboto, Android's own typeface (OFL-1.1).

  No WhatsApp logo or artwork is used (trademark), and the doodles are our own shapes.
- **Format:** 16:9 instead of 9:16, because investors watch on laptops, in emails and in decks.

## Checks (stage 4)
| Check | Result |
|---|---|
| Format | H.264 High, yuv420p, 1920×1080, 30 fps; AAC 48 kHz stereo; 294.4 s; 37.9 MB (two-pass, capped under 40 MB) |
| Loudness | -14.2 LUFS integrated, true peak -4.9 dBTP ✅ |
| Caption sync on the final mix | mean 12 ms, p95 40 ms over 638 words ✅ |
| Clarity (pocketsphinx, final mix) | 35% word error rate. Clean voice: 23%. Pocketsphinx is a weak recogniser, so this is a relative number, not a clarity score. |
| Hook | ❌ by the Reels' rule (5% of pixels changing within 1.5 s): 2.5%. The video opens on a ringing call (the sound and the pulsing call screen), and the first word comes at 1.3 s. For a Reel that would be too slow; for an explainer sent to investors, the ring is the intended open. To meet the Reel rule, "ألو" could come in at 0.5 s; that takes a 70-minute re-render. |
| Pace | 40 voice lines with a picture change on every line (mean 7.4 s), plus timed beats inside each line: words springing in, chips lighting up, messages arriving |

**Known nit:** in a few chapter-3 shots, the top edge of the tilted phone touches the chapter progress dots in the
top-right corner. Fixing it needs a full re-render.

## Rebuild
```bash
cd marketing/videos
MODELS=/tmp/alo-voice-models .venv/bin/python voice/build_voiceover.py investor   # voice + remotion/src/data/inv.json
cd remotion && node render.mjs frames inv && node render.mjs video inv && cd ..    # about 70 minutes on 4 CPU cores
.venv/bin/python audio/mix.py inv && .venv/bin/python audio/verify.py inv
```
The tools, models, fonts and licenses are the ones listed in the main README. Additions: Roboto (`@fontsource/roboto`,
OFL-1.1), and the Shouf zone map from `src/design/chouf-map.generated.ts` and `public/chouf-map.svg` (the repo's own data).
