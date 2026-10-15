# Alo King marketing Reels (test)

Two English Reels for Instagram and Facebook, 1080×1920, 30 fps, H.264/AAC, about 25 seconds each, built with free and
open-source tools only. Nothing here touches the app: everything lives in `marketing/videos/` on branch
`marketing/videos-test` (cut from `rebuild/lebanon`).

- `video1-customers.mp4`: order by typing, voice note or tapping; basket confirmed in the chat; pay and track in the same
  thread; Send Home from abroad.
- `video2-merchants.mp4`: customers already live on WhatsApp; orders arrive as clean tickets; no new app for customers; one
  place to see everything; call to action to claim the shop.

Scripts and the line-by-line claims check against `docs/decisions/DECISIONS.md`: [`scripts/SCRIPTS.md`](scripts/SCRIPTS.md).

## Status by stage
1. Scripts and claims check: done (see `scripts/SCRIPTS.md`).
2. Voice selection: in progress.
3. Review frames: pending.
4. Full render and checks: pending.
5. MP4s and this README: pending.

## Decisions (made without asking, per the brief)
- **Source files.** The brief names `claude/HANDOFF-2026-10-07.md` and `claude/DECISIONS-LEBANON-REBUILD-2026-10.md`. Those
  are the claude.ai project copies; in the repo they are `docs/decisions/HANDOFF.md` and `docs/decisions/DECISIONS.md`
  (HANDOFF line 3 says so). Used the repo copies on `rebuild/lebanon` as of 15 October 2026.
- **Branch.** `marketing/videos-test` from `origin/rebuild/lebanon`, as the brief asks. No PR is opened: this is a test
  branch with no app change, and CLAUDE.md's automerge flow is for app work.
- **Skills.** `frontend-design` (from `anthropics/skills`, Apache-2.0) and the `remotion-dev/skills` agent skills were
  installed at user level (`~/.claude/skills/`), not into the repo's `.claude/skills/`, so the commit touches nothing outside
  `marketing/videos/`.
- **Brand.** Taken from the repo (`src/design/`): ink `#17131A`, Crown Gold `#F4B63C`, cream `#FFF9F0`, paper `#FFFDF8`,
  the hand-drawn crown (`src/design/Crown.tsx`), Plus Jakarta Sans. Customers live at night (video 1 is ink and gold);
  businesses work by day (video 2 is cream and paper with the ink "counter" panel). Gold is never text on cream (§5).

## Sandbox check (15 October 2026)
| Tool or source | Works? | Notes |
|---|---|---|
| Node 22, pnpm 10, npm 10, Python 3.13, ffmpeg 6.1 | yes | |
| npm registry, PyPI, Ubuntu apt | yes | |
| `git` over github.com | yes | used to fetch the two skill repos |
| github.com over HTTPS (release downloads, codeload) | no (proxy 403) | |
| Hugging Face (Kokoro, Piper voices, faster-whisper models) | no (proxy 403) | |
| OpenAI Whisper weights (`openaipublic.azureedge.net`) | no | |
| Google Fonts, remotion.dev, Blender downloads | no | fonts come from `@fontsource` on npm; Remotion's license read from the npm package |
| Chromium (Playwright build in `/opt/pw-browsers`) | yes | used as Remotion's browser |
| Blender | not installed | |

## Licenses (every asset, font, model and library)
Filled in as each piece is added; the full table is at the end of stage 5.

| Item | Source | License |
|---|---|---|
| Remotion 4.0.535 (`remotion`, `@remotion/*`) | npm | Remotion License, free tier. See below. |
| Kokoro-82M v1.0 ONNX weights (fp32) | npm `kokoro-fp32a/b/c-shards` 1.0.0 (a mirror of the onnx-community export, joined back into one 325,532,232-byte file, SHA-256 `8fbea51e…a34cb`) | Apache-2.0 |
| Kokoro voice style tensors (28 English voices) | npm `kokoro-js` 1.2.1 (hexgrad, Xenova) | Apache-2.0 |
| Kokoro phoneme vocabulary (`config.json`) | PyPI `kokoro-onnx` 0.6.1 wheel (data file only; its espeak-based phonemizer is not used) | MIT (package), Apache-2.0 (Kokoro config) |
| misaki US English lexicons (`us_gold.json`, `us_silver.json`) | PyPI `misaki` 0.7.4 wheel (data files only; no espeak fallback) | Apache-2.0 |
| onnxruntime 1.31 | PyPI | MIT |
| frontend-design skill | `anthropics/skills` | Apache-2.0 |
| Remotion agent skills | `remotion-dev/skills` | per repo (instructions only, not shipped) |

### Remotion license (checked 15 October 2026)
Read from `LICENSE.md` inside the `remotion@4.0.535` npm package (remotion.dev itself is blocked here). The **Free License**
covers "a for-profit organization with up to 3 employees" (also individuals and non-profits) and allows use "non-commercially
or commercially for the purpose of creating videos". A Company License is needed only above that size. Alo King has three
partners (Rasheed, Bassem, Firas; §7) and no employees yet, so it qualifies **as long as the company stays at 3 people or
fewer**. When it hires a fourth person, buy a Company License at remotion.pro before rendering more videos. The file also says
the license "will slightly change" in Remotion 5.0; these videos pin 4.0.535. Remotion is source-available, not OSI open
source: it is the one exception to the MIT/Apache/OFL/CC0/ISC rule, accepted because the brief asks for Remotion by name.
