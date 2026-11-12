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
