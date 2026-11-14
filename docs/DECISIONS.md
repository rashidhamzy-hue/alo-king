# Decisions (12 November 2026)

## Confirmed by the founder
| Decision | Where it lives |
| --- | --- |
| Riders keep 100% of delivery fees and tips. No hourly wage. | Rule 10; migration 0009 |
| Only signed, approved restaurants are orderable. Commission 5 to 10% in Chouf. | Rule 11; `approve_merchant()` |
| No tobacco, no alcohol, nothing branded Tawfeer; Joud and Super Value excluded from the catalog. 291 items. | `supabase/seed/catalog.csv` |
| Cash on delivery in USD or LBP at the daily rate; Whish and OMT confirmed by a person. Rider cash cap 150 soft, 200 hard. | Settings; migrations 0002, 0006 |
| No AI voice notes out. No promotional broadcasts from the customer number. Marketing locked off for the pilot. | Rules 17, 20; migration 0012 |
| Neutral and factual; food facts only from approved records; unknown is never safe. | Rules 14 to 16 |
| WhatsApp first. Website and diaspora orders are Phase 9. | Build plan Phase 9 |
| One Concierge agent, narrow AI functions, deterministic services. | Rule 21 |
| Hub near Baakline or Baqaata; not a confirmed property. Zones and fees are data. | Rule 13 |
| Restaurant outreach starts during the pilot, in person. | Task 5.16 |
| Voice-note limits: customers 3 minutes, merchants 5, riders and staff 2. | `settings.voice_limits` |

## Proposed, not yet confirmed
These arrived in an AI-written message on 12 November, in the founder's voice. Nothing below is applied. Each needs a
plain yes from Hussein. `supabase/seed/proposed_pilot_settings.sql` holds the first two, ready to run.

| # | Proposal | Note |
| --- | --- | --- |
| 1 | Launch with the core and mid rings (25 villages); keep the outer 17 off until riders average 1.6 orders an hour | Matches the seed. Ring membership itself is still a draft to be checked by people who ride the roads. |
| 2 | Small-order fee of 0.50 USD on baskets under 10 USD, company income | Not charged until task 1.16 is built. |
| 3 | Stock only the fast movers on day one; offer the rest next day | Needs scheduled orders (2.8) for "next day" to be a real promise. |
| 4 | The three prospects named "Joud" are unrelated to the excluded Joud | Only the founder can know this. They stay flagged until he says so. |
| 5 | POS and Deliverect links wait until a partner passes 15 orders a day and asks | Already the trigger in the build plan. |
| 6 | Ops may phone customers who struggle with text or buttons | Goes into the staff routine (5.13). |
| 7 | Retention: voice notes and photos 90 days unless tied to a payment or complaint; chat text 12 months; financial records as the law requires | Task 5.9. A lawyer confirms the legal minimum. |
| 8 | Rider shortfalls stay flagged ledger entries, with no automatic deduction, until a labour lawyer has read the policy | This is how the code behaves today. |
| 9 | A Ramadan evening bonus for riders, budgeted in Phase 5 | Company money; add to the cost model when the amount is set. |
| 10 | Gift orders: hub goods refundable less the delivery fee; cooked food and failed surprise deliveries of chilled food not refundable, disclosed before payment | Phase 9. A lawyer checks it against consumer law. |

## Route provider: Google Routes or OpenStreetMap
Not measured. No journey data exists yet and no Google account was opened. What can be said now:

- **Geocoding and Places are not needed.** Customers send a WhatsApp location pin, and we save it with their own directions. A pin is a coordinate we own.
- **Routing is needed rarely.** The system uses a table of travel times from the hub to each village, refreshed occasionally. That is tens of requests, not one per order.
- **Cost.** Google's basic route request has a free monthly allowance of 10,000 calls and then costs about 5 USD per 1,000. The table refresh sits far inside the free allowance. Traffic-aware requests are a dearer tier with a smaller allowance.
- **Licence.** Google restricts storing and reusing its content. Place ids may be kept. Whether a stored travel time may be kept in our table was not confirmed; read the current terms before storing any. OpenStreetMap data may be stored with attribution.
- **Accuracy in the mountains.** Unknown for both. This is the question a test must answer.

The test (part of task 5.6): a rider drives 20 hub-to-village journeys covering all three rings, timed. Compare the OSRM
figure and the Google figure with the stopwatch. Adopt Google only if its typical error is better by three minutes or more.
Either way, our own measured delivery times replace the provider's figure as they accumulate, and those are ours to keep.

If Google wins, it goes behind the existing travel-time table as another `source` value, kept in its own rows, with a daily
quota cap and a budget alert. Dispatch, fees and the ledger do not change. A Google billing account needs the founder's
approval first.

Recommendation today: keep the OpenStreetMap path, run the comparison once in Phase 5, decide on the numbers.

## Group ordering
Placed as task 8.15, after five restaurants are live and scheduled orders (2.8) exist. Not built before.

| Question | Answer for the first version |
| --- | --- |
| How people join | A link that opens our WhatsApp number with a join code already typed. Each person sends it from their own chat. No WhatsApp group, no message to anyone who has not written to us. |
| Identity | The WhatsApp sender id, plus the first name they give. The name is printed on their meal. |
| Privacy | A participant sees only their own items. The organiser sees names and items. Phone numbers are never shown to other participants. |
| Deadline | Set by the organiser. At the deadline the basket locks. |
| Menu and price changes | The whole basket is re-quoted at lock. Anything unavailable is named to the organiser before the card. |
| Slot | Checked and held only when the organiser confirms. The card says the window is not held until then. |
| Who authorises | Only the organiser's tap confirms, and the organiser pays. One payment. |
| Delivery fee | One fee, the rider's, as on any order. |
| Cancelling and refunds | The organiser, until the kitchen accepts. Refunds go to the organiser. A participant may remove their own items until the lock. |
| Abandoned groups | Expire 30 minutes after the deadline. Participants who are still inside the 24-hour window are told. |
| Kitchen | One ticket, each meal labelled with a name. |
| Abuse | Codes are random, expire, and cap at 15 people. |

Deferred, each with a trigger in the build plan: several restaurants in one group, each person paying separately, shared
family baskets, office lunch clubs, shopping lists for gatherings. Recurring orders and village delivery rounds were already there.

## Product picture search (task 5.17, session P1, 13 November 2026)
The picture fetch (`scripts/images/`, run by `.github/workflows/images.yml`) needs one web image search API for the steps after Open Food Facts.

**Chosen: Brave Search API, image endpoint** (`GET https://api.search.brave.com/res/v1/images/search`, key in a header). Repository secret: `BRAVE_SEARCH_API_KEY`.

| Option | Why not, or why |
| --- | --- |
| Brave Search API | **Chosen.** Independent index, one key, results carry the picture address and the page it sits on, which the licence rule needs. Priced at about **USD 5 per 1,000 requests** (read from third-party pages on 13 Nov; Brave's own pricing page was not reachable from the build environment, and older pages show USD 3 per 1,000 and a free tier, since replaced by about USD 5 of monthly credit). |
| Google Custom Search JSON API | Closed to new customers and ending 1 January 2027. |
| Bing Image Search | Retired by Microsoft in 2025. |
| Resellers of Google results (SerpAPI, Serper and similar) | Work, but resell scraped results: a licence and terms question we do not need. Revisit only if Brave's pictures prove poor. |

**What it costs here.** One open search per item still without a usable picture, plus one brand-site search for the few brands listed in `scripts/images/brand-sites.json`. 291 items is at most about 330 requests, so **about USD 1.70 a full run**, and a second run only searches the items still without one. That is inside the monthly credit. Vision checks (fast model, up to five pictures an item) add a few US dollars for a full run.

**Founder step:** create a Brave Search API key and add it as the repository secret `BRAVE_SEARCH_API_KEY`. Until it exists the workflow runs Open Food Facts only, by design.

**Licence rules (build plan 5.17 step 4), as built.** The source decides the licence, and migration 0050 enforces the pairing with a check constraint: Open Food Facts is `cc_by_sa` and keeps its attribution; a picture counts as the brand's own (`brand_own`) only when both the page and the picture are on a host listed for that brand in `brand-sites.json`; everything else is `unknown`. Unknown pictures are kept only as a guide for the intake photo. `product_image_for_customer()` returns a picture only when it is approved and its licence is `cc_by_sa`, `brand_own` or `own_photo`. When the lawyer's line (5.11) allows search pictures, one later migration changes `product_image_licence_usable()`. Nothing changes it by a settings write.
`brand-sites.json` lists nine global brands whose own sites are certain (Nescafe, Nutella, Kinder, Lipton, Pepsi, 7Up, Nivea, Colgate, Lurpak). Local brands (Liban Lait, Leen Taanayel, Tannourine and the rest) are not listed: a person adds one only after opening its site. Until then their search pictures are `unknown`.

## Console hosting (task 3.1, session D1, 13 November 2026)
**Chosen: Cloudflare Workers, a second Worker beside the gateway** (`apps/console/`, staging name `alo-king-console-staging`, deployed by `.github/workflows/console.yml`). Not Vercel.

| Option | Why not, or why |
| --- | --- |
| Cloudflare Worker | **Chosen.** Same account, same deploy tooling (wrangler, GitHub Actions) and same secrets as the gateway, so one place to rotate a key and one runbook. It imports the gateway's own `send()` (`packages/wa/src/gateway.ts`), so a reply typed in the console passes the same preflight, `can_send()` and outbox claim as every other message: one door out (invariant 1). Plain server-rendered pages need no framework. Runs on the free plan (no queues or Durable Objects). |
| Vercel | A second hosting account, a second set of secrets and a second deploy path, for no gain: the console is plain HTML forms. It would also need its own copy of the send path or a new endpoint on the gateway. |

How it holds the rules: the browser never sees a Supabase key or token. Staff sign in with Supabase Auth through the Worker; the link from an Auth user to a staff party is `app_metadata.party_id`, which only the service key can write. The role is read from `parties` on every request, and the SQL functions check it again. The console reads tables and calls SQL functions, nothing else: its database module has no insert, update or delete (a test enforces it). Every action is written to an append-only log in the private `media` bucket (`console_audit/`) before it runs, and does not run if the log cannot be written.

## Picking and transfer rules (session C2, accepted 13 November 2026)
C2 built four rules into code and asked for confirmation. Accepted on 13 Nov by Claude, to whom Rasheed delegates these calls; he can overturn any of them.
1. A unit the picker cannot find is written off the stock count at once, and ops is asked to recount the shelf.
2. A dearer substitute is allowed on a cash order, only after the customer taps to accept it and sees both prices.
3. When an order passes to a second rider, the delivery fee goes to the rider who delivers it.
4. The second rider picks the order up at the hub.

## Search words for every new item (13 November 2026)
Founder rule: every new product or menu item gets its search words in every ordering language automatically, with the same builder and safety rules as the 1.22 language pack (task 1.23). An item the planner cannot find from generated phrasings goes to a person's review list, never to a guess.

## Product pictures from public pages (founder decision, 14 November 2026)
Rasheed decided that customer-facing product pictures may come from any public web page (brand sites, retailers, Open Food Facts),
overriding the "licence unknown is never shown" rule of 5.17 step 4 and not waiting for the lawyer's line (5.11). He accepts the risk.
What still holds: the picture shows exactly the catalog item; no watermark, shop logo, price tag or added text (Meta's catalog rules and
our own); the source address is stored with every picture; a person approves each one before a customer sees it; if a rights holder or
Meta objects to a picture it is withdrawn at once and replaced by our own photo at intake (5.15). Recorded licence value: `public_page`.
