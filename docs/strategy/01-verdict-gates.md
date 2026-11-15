# Alo King strategy, part 1: verdict, blind spots, gates, decisions

Planning chat, 15 November 2026 (Fable 5.2). Read-only audit of `main` at 711c2ca and of staging (Supabase, Cloudflare, Sentry, Kapso). Founder accepted this part on 15 November; his changes are marked.

## Verdict
The engine is ahead of the business: 126 tables, 452 database functions, 135 test files; no company, hub, supplier costs, riders, Lebanese number or production environment. All 42 staging orders are the automatic probe. The next phase builds less and proves more.

**Strong:** money, stock and order state owned by the database; one door out with a send claim; no anonymous table access and 13 functions for the website role; a 990-case language gate with zero wrong products; honest documents.

**Weak:** the hand-off lock is still on `main` (`turn.ts`: nine failure kinds silence the bot until a console release); nobody is woken (push off, Sentry on the gateway only, by email; `agent_handoff` is not a high-priority push kind); three templates moved to marketing by Meta; 0 approved pictures; no cart or WhatsApp button on the site; unread Arabic; every account is personal and shared with other businesses.

**Missing:** production, backups and a tried restore; real margin, hub, rider terms, travel times; cold chain, purchase orders, lots and expiry rules, proof of delivery, weighed items; a funding figure.

## Blind spots, ranked
| # | Blind spot | Decision |
|---|---|---|
| 1 | Margin is a guess (break-even 31 orders a day at 20%, 45 at 15%) | Real costs for the 60 fastest items before more features |
| 2 | The competitor is the village shop (phone, credit, trust); Peep Peep already serves Chouf restaurants | Lead with ordering for family from abroad, late hours, clear prices, voice notes |
| 3 | Send Home waits on a card gateway it may not need | Launch it with Whish or OMT transfer proof during the pilot (confirm in part 3) |
| 4 | Riders cannot live on a cold start | Fixed delivery rounds per village, on-demand in the core ring, an eight-week capped guarantee (approved) |
| 5 | No company, so no verification, merchant account or bank | The SARL and the written equity split are the critical path |
| 6 | No stop conditions | The gates below |
| 7 | Every reply costs money since 1 October 2026 | Message budget per order (target 8, measured 14); pickers on the console; a light rider page later |
| 8 | Power cuts and chilled food | **Founder, 15 Nov: chilled stays.** Generator subscription, a UPS, a twice-daily temperature log, insulated bags. Frozen waits |
| 9 | Weighed items change the total after confirmation | Fixed packs only at launch |
| 10 | Substitute question at the shelf depends on a fragile template | Ask the preference once at checkout |
| 11 | One WhatsApp account, one provider, an unverified portfolio (250 customers a day for business-started messages) | Website as a real second door; a direct-to-Meta fallback behind the gateway; verify under the SARL |
| 12 | Staff fraud paths (picker-recorded missing items and automatic credit) | Monthly cap per customer, a count per picker, Hussein's account before the test |
| 13 | VAT registration at LBP 5 billion turnover (about four months at break-even) | Accountant now; tax recorded per line from day one |
| 14 | Security and snow pauses | One switch to pause a village |
| 15 | Founder is the single point of failure | A paper fallback and a trained second person |
| 16-21 | Water gallons, gas, daily bread; pickup at the hub; "which note will you pay with?"; QR magnets and bag stickers; holiday timing (20 Dec to 5 Jan, Ramadan mid-February); trademark and handles | In the journeys and the session plan |

## Stop conditions (accepted)
1. Before opening stock is bought: blended margin of at least 15%, the SARL filed, the hub with backup power and a temperature log.
2. After the shadow run (7 days, 100 orders): any day not closing to zero unexplained, or any stranded customer, means no paid pilot.
3. Week 8 of the paid pilot: under 15 orders a day, or 30-day repeat under 30%, or rider net earnings under $2.50 an hour: the on-demand dark store stops; Alo King continues as Send Home plus fixed rounds.

## Founder decisions, 15 November
- The hand-off fix runs first, ahead of T1.
- Repository stays public until the build ends, then private (last step of the plan). No paid plans. Secrets only in Cloudflare and Supabase; fake seed and test data; a check that blocks secrets and real phone numbers; exposed webhook secrets rotated.
- Production stays on the current Cloudflare account ($5 plan); a separate account later.
- Old Supabase project: export what is needed, delete this week (grace period ends 24 November).
- Rider guarantee for eight weeks: yes, capped, company money.
- Chilled goods stay (row 8).
- Open: the capital figure (line-by-line estimate once supplier costs are in) and the SARL status.
- Added to later parts: rider insurance and legal status, hub permits, USD and LBP price display rules, data protection, security of cash at the hub.
