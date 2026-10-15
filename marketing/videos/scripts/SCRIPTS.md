# Reel scripts and claims check

Two English Reels for Instagram and Facebook, 1080×1920, 30 fps, about 25 seconds each.
Source of truth: `docs/decisions/DECISIONS.md` (the brief's `claude/DECISIONS-LEBANON-REBUILD-2026-10.md` is the same file;
`HANDOFF.md` says so on line 3). Every spoken or on-screen claim below is traced to a section. Anything without a section was cut.

The machine-readable copy of each script (the text the voice reads, one line per scene) is `video1.json` and `video2.json`
in this folder. If you edit a line here, edit it there too.

## Video 1: customers ("Just WhatsApp it")

Tone: night (ink #17131A, Crown Gold light), the customer side of the design system (§37.2, `src/design/README.md`).

| # | Voice-over | On screen | Claim | Source |
|---|---|---|---|---|
| 1 | Hungry? Just WhatsApp it. | 3D phone swings in; "Just WhatsApp it." | Ordering happens in WhatsApp | §37.1 "Every page leads to one action, Order on WhatsApp"; CLAUDE.md "WhatsApp-native" |
| 2 | Type your order, | Customer bubble types "2 shawarma w pepsi"; word "Type." | Order by typing free text | §3, §29.3 "free text or voice for open requests"; the example text is §37.3 item 3 |
| 3 | send a voice note, | Voice-note bubble with a moving waveform; "Talk." | Order by voice note | §29.3, §30.1 item 6, §32.4 |
| 4 | or tap through the menu. | List message with menu sections, a tap; "Tap." | Button and list ordering | §34 "fully button-driven ordering path", §29.3 "buttons for 1-3 choices, lists for 4-10" |
| 5 | In Arabic, English, French or Arabizi. | The three §37.3 examples flip: "بدي ٢ شاورما", "2 shawarma w pepsi", "deux manakish zaatar" | Four ordering languages | §0 "French added as a fourth ordering language (with Arabic, English and Arabizi)", §22.2 #15 |
| 6 | Check your basket, then confirm it right in the chat. | Branded basket card (items, quantities) with a gold Confirm button | Customer sees the basket and taps Confirm | §32.4 "Every order still ends with the customer seeing the basket and tapping Confirm"; §34 steps 7-9 |
| 7 | Pay and track your order in the same thread. | Pay choice in the chat ("Cash on delivery"), then status bubbles "Accepted", "On the way", "Delivered" | Payment choice and status updates inside the chat | §1 and §20.1 (cash on delivery), §34 step 8 (cash currency chosen in chat) and steps 10-12 (status messages), §27.3 (accepted, on the way, delivered) |
| 8 | Living abroad? Send Home lets you order for family in Lebanon. | "Send Home" card: sender abroad, recipient "Mom · Baakline" | Diaspora orders for family in Lebanon | §22 "Lebanese abroad order on WhatsApp for family in Lebanon and pay by card"; "Mom – Baakline" is the §22.2 #11 example |
| 9 | Alo King. Order on WhatsApp. | Crown, wordmark, "Order on WhatsApp" button | Brand and call to action | §37.1, §37.3 item 1 |

## Video 2: merchants ("Orders, on the counter")

Tone: day (cream #FFF9F0 and paper #FFFDF8 with ink type; gold only as a fill), the business side of the design system, with
the ink "counter" panel where the work happens (`src/design/README.md`).

| # | Voice-over | On screen | Claim | Source |
|---|---|---|---|---|
| 1 | Your customers already live on WhatsApp. | Chats stack up fast; "Your customers live here." | Lebanese customers order on WhatsApp | §15.2 "Lebanese households order these on WhatsApp"; §27.1 "the most trusted tracking a Lebanese customer knows" |
| 2 | Now they can order from you, right there. | 3D phone: a customer order lands in the chat | Customers order from the merchant through WhatsApp | §23.1, §37.1 |
| 3 | Every order arrives as a clean ticket: | Paper ticket slides up with the perforated edge (the design system's receipt) | Order ticket / order card | §23.1 "Order card with Accept / Reject / prep time buttons"; kitchen printer "Ticket prints automatically in Arabic and English" |
| 4 | items, options and notes, ready for the kitchen. | Ticket lines highlight: items, option, kitchen note | Ticket contents | §12 `item_options` "kitchen note"; §22.2 #17 "printed on the merchant ticket" |
| 5 | Accept with one tap, and set your prep time. | Order card: Accept, Reject, prep-time chips; Accept pressed | One-tap accept with prep time | §23.1 "accept or reject with prep time" |
| 6 | No new app for your customers to download. | A download icon struck through; the chat stays | No app for customers | §37.1 "No app store badges, no sign-up walls"; §39.10 W2 "there is no app to download (ordering is WhatsApp only)" |
| 7 | One place to see everything: orders, menu and hours. | The ink counter panel: orders, menu, hours | Merchant dashboard / portal | §24.2 merchant dashboard "(orders, menu, hours, delivery settings, ...)"; §23.1 portal is the default channel |
| 8 | Alo King. Claim your shop and get listed. | Crown, wordmark, "Claim your shop" button | Claim / registration call to action | §18, §24.3 "Search, then verify"; `src/design/README.md` "One action per page: Claim your shop on the business side" |

## Claims considered and cut

| Cut claim | Why |
|---|---|
| "$1 per order. Not 30%." and the savings calculator | The fee is in the decisions (§20.4, §29.1, §37.3) but varies by business type, is free for the first 30 days, lives in a dated price table and can change without code. A Reel can't carry those conditions, and the brief asked for no fees unless needed. Left out. |
| Delivery fee bands ($2 to $6), the COD cap, Send Home's $1.50 fee | These are in the decisions but the brief says no prices or fees unless needed. Not needed. |
| "Ali is 3 minutes away" (the §37.3 web demo line) | It's a delivery time. Replaced with status words only: accepted, on the way, delivered. |
| Any ETA, "fast", "in minutes", "30-minute delivery" | No delivery-time promise exists in the decisions (§27.5 ETA ranges are computed per order). |
| Whish, Tap, cards and payment links by name | Online collection waits for the lawyer's letter (§20.1) and Tap's approval (§22.6). The pilot is cash on delivery (§1). The video says "pay ... in the same thread" and shows "Cash on delivery" only. |
| "Live in the Shouf" / "Now open" | The pilot isn't open yet (§1 gate, §38). No launch date or area claim. |
| Ratings, review counts, "trusted by N shops", order counts | Forbidden: §5, §30.5, §37.3 item 7 ("No invented reviews, ratings or order counts"). |
| "Menu from a photo in seconds" | Supported in principle (§18.3), but it needs API credit (§32.7) and "seconds" isn't in the decisions. Not needed for the brief. |
| A website address or phone number on the end card | `aloking.com` isn't bought yet (§19, #74) and the customer and merchant numbers don't exist yet (§3, §38.6). The end cards carry the action ("Order on WhatsApp", "Claim your shop") with no address. Add the link in the caption when it exists. |
| The WhatsApp logo | Trademark. The chat UI is WhatsApp-style (generic bubbles, green accent `--wa` from the design tokens) and the word "WhatsApp" is used only to name the channel. |

## Publishing conditions, from the decisions

- Paid customer ads wait for the §1 gate: 15 merchants live plus 14 days of the four reliability numbers. Video 1 is ready
  for that day. Organic posting is the owner's call.
- Send Home (video 1, scene 8) switches on when Tap approves the SARL and the lawyer's letter covers collection (§22.6).
  Until then, either hold video 1 or post the cut without scene 8 (`npm run render:v1-nosendhome` builds that cut).
