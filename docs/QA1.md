# QA1: the whole system on staging, 17 November 2026

Session QA1 (Opus, high). Since 15 November about twenty sessions merged into each other (PD1, B1d, SR1, LB1, LD1, AR1, DS2, CFG1, SELL1,
LV1, UX2a, WEB2, UX2b, UX3). This file is the read-only audit, written before any fix, then what was fixed in the same pull request.
Every check reads **pass**, **fixed** (broken, now fixed here with a failing test first) or **open** (with the reason and who acts).

How it was done. Staging only, never a real customer's number. Orders were placed as the staging probe customer (`is_probe`, its messages
end at `can_send`'s `probe_sink` and never reach WhatsApp): a message in Kapso's own shape was stored in `wa_inbound_events` and the
gateway's minute cron delivered it exactly as a real webhook is delivered (`stale_inbound_events`), so the turn code, the outbox, the
cron and the database are the real ones; the probe riders tapped as they do every hour. The website and the console were driven by a
browser (Playwright, 390 px). The console was signed in with a QA-only staging admin (`qa1-check@example.com`, random password never
stored, blocked again at the end of the session, as the console's own smoke check does). The evidence queries are
`scripts/staging_evidence.sql`'s.

## 1. Staging itself

| Check | Result | Evidence |
| --- | --- | --- |
| Staging is at the last migration | **pass** | `schema_migrations` ends at 0234 (`join_decisions`); `deploy-staging` run 44146496785 on `main` (d26da23) green at 18:20 |
| The minute cron ran in the last hour without error | **pass** | `heartbeats.cron` beats every minute; Sentry monitor `gateway-cron-staging` status ok, last check-in 18:45 |
| Scheduled workflows | **pass** | `backup` (17 Nov, ran 09:25 for its 01:30 slot: GitHub's queue), `restore-check`, `usage-check`, `intake`: all green; none ran red in the last week |
| Sentry, last 24 hours | **pass** (two expected alarms) | Only `raiseAlarm` 06:00 (`heartbeat:inbound_silent`: nobody wrote overnight) and 09:00 (`heartbeat:probe_silent`, the probe stall below). No code error |
| The hourly probe order | **fixed** | No probe order since 16 Nov 06:52 (36 hours) and `probe_silent` open since 09:00. The probe's order text says «ربطة خبز الفورنو», which since B1c is asked «أي واحد بدك؟» with three `pick:` buttons; the probe tapped only the card and rider buttons, so it stopped there every hour. Fix: the probe taps the first product offered, as a person would (`packages/wa/src/probe.ts`; test `test/db/heartbeat.test.ts`, "answers the which-one question"). Takes effect at the next deploy of `main` |
| The `web` workflow, red on `main` since #109 (UX3's report) | **fixed** | Not a deploy fault: the Worker deploys and the pages answer. The live check `apps/web/scripts/smoke.sh` still looked for the words before LD1 ("not verified", "declared"), and since LD1 the first product of the first aisle says "Not confirmed yet". Run 44109738282: `FAIL: product page shows no fact status`. Fix: the check is `apps/web/scripts/fact-status.sh` and accepts LD1's words and every source's words; test `test/web/pages-web1.test.ts`, "the live smoke's fact-status check" (failed on `/p/AK-0020` before the fix). Green again at the next merge's `web` run |
| picomatch ignore (`osv-scanner.toml`) | **pass** | The one entry, GHSA-fc5q-39xc-vjpf, expires 2026-12-17 (held by `test/ci/osv-ignore.test.ts`). No fixed release exists on 17 Nov: the latest are 4.0.7 (24 Aug 2026) and 2.3.2, the versions installed, so there is nothing to upgrade to. The next session after 17 Dec, or the first to see a fixed picomatch, upgrades and deletes the entry |

## 2. Every page at 390 px, Arabic and English (a script, not by hand)

`scripts/qa/pages.mjs` loads each page in a fresh browser (an empty cache, so the weight is a first visit's), at 390 px, in Arabic and in
English, and records the HTTP status, any page or console error, sideways scroll, and the bytes of everything but pictures (the page, its
stylesheets, scripts and fonts). Run it again with:
`node scripts/qa/pages.mjs --web <site> --console <console>` (the console part signs in only with `QA_CONSOLE_EMAIL` and
`QA_CONSOLE_PASSWORD` in the environment).

| Site | Loads | Result |
| --- | --- | --- |
| Website: home, search, basket, checkout, sign-in, orders, account, How it works, privacy, terms, Food list, a Food place, its remove page, join as a rider, for vendors, offline, an aisle, a product (18 pages × 2 languages) | 36 | **pass**: all 200, no error, no sideways scroll; every page under 100 KB on a first visit. Heaviest: the Arabic aisle (`/c/fruits_vegetables`) 95.6 KB, the English aisle 89.5 KB; the rest 31 to 83 KB |
| Console: all 41 pages of the navigation, signed in as an admin (Today, Inbox, Orders, Pick, Rider jobs, Stock, Approve, Capture, More, Approvals, Auto approvals, Cases, Catalog, Day close, Day open, Exceptions, Food facts, FX, Intake, Label queue, Listings, Merchants, Money, Cash drops, Names, Payments, Pictures, Readiness, Receiving, Refunds, Returns, Rider incidents, Riders, Applicants, Search words, Settings, Staff, Templates, Windows, Zones, Install) | 82 | **pass**: all 200, no error, no sideways scroll, none bounced to sign-in |

QA1-TODO-REST
