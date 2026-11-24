# CAT2: the catalogue message refused, and the customer got silence (24 November 2026)

Session CAT2. Decisions: `docs/DECISIONS.md`, "CAT2, the catalogue message refused, 24 November 2026" (rows 1 to 9). **No migration.**
Pull requests [#168](https://github.com/rashidhamzy-hue/alo-king/pull/168) and [#169](https://github.com/rashidhamzy-hue/alo-king/pull/169),
each merged with CI green. No new agent (invariant 21); no write by a model; no new outbound type (invariant 2: `cta_url` is an
`interactive`); every send still through the gateway's one door; Kabsi not touched.

## What happened
Staging, 24 Nov 04:22 UTC: the founder (a tester) wrote «الكتالوج». The turn ended "answered" with nothing sent. Kapso's external API log:
both sends (the catalogue's button offered with a tester's first reply, and the catalogue asked for) were refused by Kapso's Meta proxy,
**422 {"error":"Invalid message payload"}**, as on 23 Nov 16:35. Our `catalog_message` had no `action.parameters`. The gateway recorded each
refusal as permanent (`kapso_…`) and the turn carried on with nothing to say. VOICE1 had reported the button as sent: its scripted tester
was a probe party, whose sends stop at the gateway (`probe_sink`) and never meet Kapso.

## Built
1. **The thumbnail** (`catalog-messages.ts` `thumbnailFrom`): every catalogue message carries `action.parameters.thumbnail_product_retailer_id`,
   a SKU from `catalog_feed` with its feed JPEG that can be ordered (`settings.catalog.thumbnail_sku` if set and it qualifies; else the
   category's first, else the catalogue's first). Nothing qualifies: no catalogue message, the words to type instead.
2. **Never silent** (`gateway.ts` `replaceRefused`): an interactive message refused by our shape check or by Kapso/Meta for good raises
   **Sentry `reply_refused`** (line, interactive type, reason, Kapso's status and error; never a number or words) and goes again through the
   same door (preflight, `can_send()`, an outbox claim under `<key>:alt<n>`): the caller's fallback (the catalogue: a `cta_url` button
   «افتح الكتالوج» to `https://wa.me/c/<number>`, then the same as text) or the message's own words with each choice on its own line.
   A refusal by `can_send()` or for the 24-hour window is never replaced (#169). «الكتالوج» answered by code sends the words to type if
   nothing at all went out. The link's number is data (`catalog.catalog_link`, else `catalog.product_link`'s number).
3. **The contract** (`packages/wa/src/contract.ts`): Kapso's OpenAPI shapes (read 24 Nov) for button, list, cta_url, catalog_message,
   product, product_list, location_request_message. `preflight()` refuses a shape that fails it; builders cut by characters (never half an
   emoji), a list row's description to 72.
4. **The live check** (`catalog-check` workflow): «الكتالوج» enters the staging Worker; with `tester`, the reply goes to the tester who wrote
   in the last 23 hours (no number is an input or printed); without, to a fiction-range scripted tester (+44 7700 900147).
5. Messages `catalogLink` in Arabic, English and French (CX2 rules, snapshots).

## Tested (free)
- `packages/wa/test/contract.test.ts` (24 tests): Kapso's own example of each of the seven types passes the check; each builder's output
  passes and keeps Kapso's keys; the 23/24 Nov payload is refused (`catalog_thumbnail`); ten refused shapes; emoji-safe cuts; the gateway:
  Kapso 422 → `reply_refused` (no number, no words) → `cta_url`; the button refused too → text with the link; buttons with no caller words →
  the choices as text; a refused shape never reaches Kapso; STOP / gate / the 24-hour window → nothing replaced, no alarm.
- `packages/agents/test/catalog-cat2.test.ts` (6): the thumbnail rules and the link from data.
- `test/db/voice1-places.test.ts`: the thumbnail on the welcome's button; «الكتالوج» refused by Kapso → the link button in Arabic, the
  turn answered with something sent; both refused → the English text with the link.
- `npm run typecheck && npm test`: CI green on #168 (run 45338023181) and #169 (run 45344297953). Locally 3652 passed; the seven
  `test/pg` suites need pgvector, which this container lacks (green in CI).
- Personal-data guard and gitleaks passed every commit.

## Live on staging
- Merged and deployed: #168 (deploy-staging 45340351683) and #169 (deploy-staging 45346852168), both green from `main`.
- **catalog-check run 45343575813** (fiction-range tester): Kapso refused every send with 422 "outside the 24-hour window" (Kapso keeps
  its own window). It showed the Worker's side working (thumbnail AK-0020; catalogue → link button → text) and that window refusals were
  being replaced: fixed by #169.
- **catalog-check run 45349743428** (the tester whose window was open: the founder): **Kapso accepted the catalogue message** (no 422) and
  passed it to Meta; **Meta refused it, 400 / 131009 "Products not found in FB Catalog"** for AK-0020. The fallback went out: **Kapso
  external API log 07:41:25 UTC, `POST …/messages` 200, the `cta_url` «افتح الكتالوج» → `https://wa.me/c/12036602328`**. So the founder
  got the catalogue's link instead of silence.
- **What this means**: the shape is now right for Kapso and for Meta; Meta does not find our SKUs in the catalogue connected to the number.
  Every real cart Kapso holds (October, from the founder) came from catalogue **1684040949979106** with UUID product ids, not from
  `1178584524839853` (`Alo King Chouf (staging)`, ids `AK-…`). Either the number is still connected to the old catalogue, or the new one has
  not ingested the `AK-` items. Kapso's proxy cannot read either (TEST1 decision 15). **Founder action u** (STATUS) settles it; until then the
  "View catalog" message is refused by Meta and the customer gets the link button, which opens whatever catalogue is connected.

## Kapso's log, 17 to 24 November (every non-success)
- The three `catalog_message` 422s (23 Nov 16:35; 24 Nov 04:22, twice): fixed (thumbnail).
- 131009 on read receipts for scripted fake message ids (`wamid.TEST1…`, `wamid.VOICE1…`): expected, harmless.
- Thirty days of 422s: the same three. No other refused send.
- This session's own: the check runs above (422 window to the fiction number; 131009 "Products not found" for AK-0020).

## What only a live account can prove
- Meta's "View catalog" message on a phone: needs action u first.
- The founder's check: write «الكتالوج» to the test number.
