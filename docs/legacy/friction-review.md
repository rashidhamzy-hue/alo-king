# Friction review of the owner's own test conversations (flow item M8)

Source: the `conversations` table and Kapso's message log for the owner's test phone, 5 Oct 2026 (about 90 turns, 4 orders), plus production `turn_timing` logs. Quotes are shortened; no names or addresses are repeated here.

## Fixed in this change (clear bugs)

| # | What happened (time, Beirut) | Why it hurt | Fix |
|---|---|---|---|
| 1 | Numbered menu of a cafe titled "Popular right now" listed **Additional Bread $10.37, Al Kooz Bomb, All Kinds Bread, Almaza Beer**: alphabetical, and starting with an add-on (20:05). The reply "1, 2, 4, 10" then put the $10 bread and a beer in the basket. Another vendor's list led with "Add Cheese $9.17" and "Add Syrup $8.74"; "5 × Add Cheese $45.85" ended up in a basket (21:00). | A numbered list is only quick if the numbers are dishes. Add-ons look like dishes with silly prices. The "Popular" title was untrue when no dish is flagged popular. | Add-ons and extras ("Add …", "Additional …", "Extra …", an Extras / Add-ons section, Arabic "إضافة / زيادة") are never listed as numbered dishes (still orderable by name). The page is titled "Popular right now" only when popular dishes are on it, else "Menu" / "القائمة". |
| 2 | "1: 3 pieces 5: 2 pieces 9: 5 pieces 10: 4 pieces" (20:26) got the **same list re-sent with no explanation**. | A dead end: the customer typed a natural format and nothing happened. | "number: quantity" is understood ("1: 3 pieces 5: 2", "1: 2, 3: 1", Arabic digits and "قطع"), only when there are two or more pairs or a unit word, so "12:30" or "3:1" is never read as an order. |
| 3 | Tapping **Confirm Order** on a summary 52 minutes old answered "That order has expired or was already placed … start again" (17:09). | A dead end for someone who is ready to buy. | An expired, never-confirmed summary (under 24 h old) is rebuilt from its items with today's server-side prices and shown again with one line of explanation; the customer taps Confirm again. A summary that was already placed says so. Nothing is ever confirmed automatically. |
| 4 | After "Change Location" and sharing a pin, the saved landmark text was **replaced by "Village (map link)"**. Two later orders (a $149 order and a $16 order) went to the kitchen with no building or landmark, only a pin. The bot also asked for the landmark again before the next order (15:51). | The driver loses the landmark the customer typed; the customer is asked the same thing twice. | A shared pin in the same village now **adds** its map link to the landmark the customer already gave instead of replacing it. |
| 5 | "I want burgers" (18:44) answered "**Your basket is empty** 🧺 Tell me what you're craving…" followed by the burger card. | The model had called the basket tool on its own; the empty-basket text was glued to an unrelated answer. | The empty-basket message is sent only when the customer taps Basket; when the model checks by itself it stays silent. |

All five have unit tests (written first). Nothing touches prices (summaries are always rebuilt from the database), consent, or secrets.

## Not fixed: needs a decision or more work

| # | Finding | Why not fixed here |
|---|---|---|
| 6 | **All four test orders are still `pending`**: no kitchen accepted them. No vendor has a linked owner WhatsApp (0 of 816), so the customer gets "order received", then 90 seconds later "still being confirmed", and nothing more. | Operations, not code: a vendor must be onboarded and linked (or use the merchant app). Until then real orders will dead-end the same way. Consider telling the customer plainly when the vendor cannot be reached, or only offering vendors that can accept orders. Owner decision. |
| 7 | A village typed as text ("خريبة", "Khriebeh", 09:36) was searched as a dish: unrelated sweets, then the bot apologised for misreading ("I thought it was a dish"). The customer had to share a location. | Needs a village alias list (Arabic and Latin spellings) and fuzzy matching; a feature, not a one-line bug. Sharing the location works. |
| 8 | The name was asked up to four times in one session (11:15-12:23) because the customer answered other questions first. WhatsApp already knows the profile name. | Pre-filling from the WhatsApp profile name is a privacy and consent question (how that data is used); owner decision. |
| 9 | The consent prompts: an offers question right after "order received", and a privacy line on the first location share. | They touch consent; unchanged on purpose (see `docs/message-audit.md`). |
| 10 | Two taps on "categories" (18:45, 18:47) both showed the same list. | Cannot tell from the log whether the second tap was a no-op by design; reproduce on staging before changing. |

## Slow turns (production `turn_timing`, last 6 hours before the region pin took effect)
Taps: p50 4.5 s, p95 7.9 s (35 taps). Text: p50 5.6 s, p95 9.2 s (12 turns). That is the Tokyo database seen from a US-region function (`docs/latency.md`): the staging measurement with the function pinned to `ap-northeast-1` was a 0.27 s median tap. The owner has since added `forceFunctionRegion=ap-northeast-1` to the Kapso webhook URL; the capped live run re-measures it. The slowest customer-visible turns were the model-bound ones (up to about 17 s for a three-call turn).
