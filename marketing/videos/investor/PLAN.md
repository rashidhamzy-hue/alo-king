# Investor and partner explainer: plan

The owner's brief (15 October 2026):
- one full explainer for investors and partners, as long as it needs to be;
- the real WhatsApp colours and layout;
- Whish checkout or cash on delivery, Send Home, the drivers' intelligent system, the AI brain, memory, agents, the
  merchants engine, merchant claiming, the database, smart menus and catalogues;
- why this replaces ordinary delivery apps, and what makes Alo King different;
- a slower voice, and "Alo" said and written as Lebanese answer the phone: **ألو**.

Rules kept from the Reels:
- Every claim comes from `docs/decisions/DECISIONS.md` or from `docs/decisions/HANDOFF.md`, which says what is built.
- Free tools only, the same Kokoro voice pipeline, and the same checks.

## Format (decided)
- **16:9, 1920×1080, 30 fps, about 4½ minutes.** Investors watch on a laptop, in an email or inside a deck. A vertical
  Reel wastes most of a laptop screen, and an explainer needs room for a diagram beside the phone.
- **Chapters:** a numbered title card for each of the 11 parts (the content is a sequence, so numbering fits). The
  voice pauses longer between chapters.
- **Captions:** word-highlighted at the bottom (44 px), for viewers who watch muted in an inbox.
- **File:** H.264/AAC, encoded to stay under 50 MB so it fits in GitHub and in email links. The two Reels' MP4s are
  removed from the branch.

## Voice (decided)
- **Same voice** (`bm_george`, chosen by the objective test), read at **0.90×**. The Reels ran at 1.01× and 1.14×,
  which the owner found fast. Lines are separated by 0.45 s and chapters by 1.1 s.
- **"Alo"** is phonemised as Lebanese **ʔalˈoː**: a short "a" and a pure, long "o", stressed on the second syllable,
  like picking up the phone. The English diphthong "oʊ" is not used. On screen the brand is always shown with **ألو**.

## Visual system
- **Brand frame:** night (ink `#17131A`, Crown Gold `#F4B63C`), the Chouf contour lines and the hand-drawn crown. This
  is the customer side of the design system; the merchant chapter switches to day (cream and paper), as on the website.
- **WhatsApp screens in WhatsApp's own light theme:**
  - chat colours: header `#008069`, wallpaper `#EFEAE2` with a faint doodle pattern, sent bubbles `#D9FDD3` and received
    `#FFFFFF`, both with tails;
  - small details: grey time `#667781`, blue double ticks `#53BDEB`, a green `#00A884` mic button, and the date pill;
  - interactive messages: reply buttons under the bubble, a "View menu" list button and a list sheet.

  No WhatsApp logo or artwork is used (trademark). The doodles are drawn from our own icons.
- **3D phone:** the Three.js phone from the Reels, with the HTML chat mapped onto the glass.
- **Diagrams:** nodes and paths that draw themselves as the voice names them:
  - the brain and its tools;
  - the escalation timeline;
  - the dispatch map, on the real 61-village Shouf zone from `src/design/chouf-map.generated.ts` and `public/chouf-map.svg`;
  - the database stack;
  - the revenue streams.
- **Grid:** 120 px margins, two columns (story on the left, phone or map on the right), captions in a band at
  y 960–1030. Type: Plus Jakarta Sans 800 for display, IBM Plex Sans Arabic for Arabic.

## Script (voice, by chapter) and sources
| # | Chapter | Picture | Sources |
|---|---|---|---|
| 0 | **Alo** (cold open) | A WhatsApp call rings; "ألو" lights up like a shop sign; it becomes the Alo King crown | §37.1 |
| 1 | **Why not another app** | A family chat list full of voice notes and Arabizi; an app download and sign-up struck through; "22–30%" taken from a receipt; a village shop with only a phone | §15.2, §29.1, §23, §37.1 |
| 2 | **One chat, one brain** | Customer, AI and server as three nodes: "the AI interprets, the server decides" | CLAUDE.md, §3 |
| 3 | **The customer** | 3D phone in real WhatsApp colours: typed order, voice note, list menu, four languages, catalogue search, basket card in USD and LBP, Confirm, then Cash on delivery or Whish checkout, then accepted, on the way (live location), delivered | §3, §13, §20.1, §27.3, §29.3, §30.1, §34, §39.6 |
| 4 | **Send Home** | Arcs from the diaspora (France, Canada, the Gulf, Australia, the US, West Africa) to the Shouf; the sender's gift card; the recipient's message | §22, §22.3, §22.6 |
| 5 | **The brain, memory and agents** | Zero-AI path against one-call path; typed tools that read the database; the "what I remember" card with delete; the merchant copilot ("خلصت الكنافة" → confirm); the learning loop | §4, §18.2, §32.4, §39.6, §39.7; HANDOFF session 4, 5c |
| 6 | **The merchants engine** | Day tone. "Not on Alo King yet" cards and "Ask them to join"; claim code; draft menu approved section by section; one order fanned out to WhatsApp, portal, printer, call and POS; escalation at 15, 45 and 75 s; $1 flat against 22–30% | §18, §23, §29.1, §39.3, §39.4; HANDOFF session 3, 5 |
| 7 | **Drivers and the dispatch brain** | The Shouf map: merchant, idle drivers, the road-time choice, batching, the 15-second check; the driver's WhatsApp job card; proof of delivery; landmarks learned | §21, §27, §28, §32.2 |
| 8 | **The database** | One database in Frankfurt: places, dishes, versioned menus, orders, the append-only ledger in USD and LBP, memory | §3, §16, §20.3, §32.3; HANDOFF sessions 1, 2, D |
| 9 | **The business model** | Revenue cards from the dated launch price table; about $0.15 variable cost per order | §6, §20.4, §29.1 |
| 10 | **Where we are** | The lit Shouf map; 314 merchants in 12 villages, about 60 delivered-to places; built and tested end to end by the simulator; the launch gates | §1, §36, §38, §39.2; HANDOFF D, E, F, 11-lite |
| 11 | **Close** | "Lebanon already answers with ألو." Crown and wordmark. "Let's talk." | |

## Claims handled with care
- **Whish checkout:** shown as a product feature, as the owner asked. Chapter 10 says online payment switches on
  with the lawyer's letter (§20.1), so investors aren't misled.
- **Send Home:** card payments through Tap switch on when Tap approves (§22.6). Chapter 10 says so in one line.
- **Prices shown:** only the dated launch prices in §20.4 and §29.1, plus one worked example ("on a $20 order"),
  labelled as an example.
- **Numbers:** from DECISIONS or HANDOFF only: 314 merchants, 12 shop villages, 61 boundary places, 203 dishes,
  about 2,200 places, 4 languages, 11 of 11 simulator scenarios, $0.15 cost, and 15/45/75 s escalation.
- **Not claimed:** user, order or revenue numbers (there are none yet), ratings, delivery-time promises, and named
  competitors ("delivery apps" only).
- **No contact details on the end card:** the domain and numbers don't exist yet. The owner adds a contact line
  when sharing.

## Build and checks
1. `investor/script.json`, with a claims table (this file).
2. Voice-over at 0.90× with word alignment; captions and cues read the same timeline as the Reels did.
3. Remotion composition `Investor` (16:9). Review frames: one per chapter. Fix anything off before the full render.
4. Full render, sound (the same synthesiser, with a longer bed that rises in sections), loudness to -14 LUFS,
   true peak under -1 dBTP, a size cap under 50 MB, and the checks in `audio/verify.py`.
5. Push the MP4, the frames and the README.
