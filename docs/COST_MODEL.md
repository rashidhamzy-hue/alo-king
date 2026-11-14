# Cost model (revised by session S1, 14 November 2026)

The editable model is **`data/cost_model.csv`**: open it in Excel, LibreOffice or Google Sheets, change any input in column B
(or a volume in the "Orders per day" row) and every figure recalculates. This page explains it and records the results at
today's inputs. All amounts in US dollars. "Placeholder" means nobody has confirmed the figure: the model's shape is sound, its
answers are only as good as those inputs. It replaces the snapshot of 12 November.

## 1. Rules the model follows
- Riders keep 100% of delivery fees and tips. Alo King pays no wage. A free or rewarded delivery is therefore paid by Alo King to the rider.
- Alo King's income is dark-store margin, contracted vendor commission, and the small-order fee when it is switched on.
- Vendors are restaurants, cafes, bakeries and similar; groceries come only from our dark store. At launch there are no vendors.

## 2. What changed since 12 November, and why
| Item | Was | Now | Source |
| --- | --- | --- | --- |
| AI per order | $0.012 | **$0.004** | Measured: $0.0019 per probe order on staging (`ai_cost_daily`, 13 and 14 Nov); doubled because real customers ask more questions than the probe |
| Billable messages per order | 10 | **14** | Measured on staging, 7 to 14 Nov: 204 outbound messages for 14 orders, both lines |
| Meta price per message | $0.0091 | **$0.0105** | Published rate cards for "Rest of Middle East" disagree (0.0091 or 0.0105); the higher is used until the first bill (RESEARCH_REGISTER e) |
| Free messages | 2,000 a month | 2,000 a month (1,000 per number, two numbers) | Meta, since 1 October 2026 |
| Kapso | $35 | $35 up to 100,000 messages a month; $0.002 a message above; the $299 plan from about 230,000 | Kapso's published prices |
| Supabase | $30 | $25 plus about $100 for point-in-time recovery | Assumption, not re-checked; recovery is required before real money |
| Nightly evals, intake research | none | about $46 a month | SYSTEM_PLAN sections 4 and 6 |

## 3. Cost per operation
| Operation | Cost | Basis |
| --- | --- | --- |
| One reply, card or status message | $0.0105 | Meta; the first 2,000 service messages a month are free |
| One Concierge turn, card path (one model call) | about $0.0006 | Measured |
| One Concierge turn, ask path (two calls) | about $0.0015 | Estimate from four times the output tokens |
| One voice note transcribed (30 seconds) | about $0.0033 | About $0.40 an hour |
| One payment screenshot read | about $0.002 | One vision call (estimate) |
| One label photo read at intake | about $0.003 | One vision call (estimate) |
| One new product researched and proposed | about $0.05 | Web search call, up to five picture checks, search words (estimate) |
| One supplier invoice read | about $0.01 | One vision call, about 30 lines (estimate) |
| One full live eval run | $3.00 | Measured (B4) |
| One nightly smoke eval (150 cases) | $0.45 | Scaled |
| One card payment of an average order | about $0.53 | 3% of $17.75 (assumption until a contract) |

## 4. Per order type, at today's inputs
Basket $16; dark-store margin 20%; commission 7.5%; shrink 2%; cash loss 0.5%; packaging $0.15.

| | Dark-store order | Vendor order |
| --- | --- | --- |
| Income | 3.20 (margin) | 1.20 (commission) |
| Shrink, cash loss, packaging | -0.55 | -0.08 |
| Messages, AI, speech | -0.08 at 10 a day, -0.15 from 100 a day | the same, plus 4 messages (-0.04) |
| **Leaves, before fixed costs** | **about 2.50** | **about 0.93** |
| The rider receives (not company money) | 1.75 fee + 0.50 tip | the same, or the vendor's driver keeps the fee |

A vendor order leaves a little over a third of what a grocery order leaves. Vendors bring volume and reasons to order;
the dark store pays the bills.

## 5. By volume (dark store only, small-order fee off)
| Orders a day | 10 | 30 | 50 | 100 | 200 | 500 | 1,000 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Meta fees a month | 23 | 111 | 200 | 420 | 861 | 2,184 | 4,389 |
| Kapso a month | 35 | 35 | 35 | 35 | 63 | 299 | 299 |
| An order leaves | 2.57 | 2.52 | 2.51 | 2.51 | 2.50 | 2.50 | 2.50 |
| Pickers / ops leads | 1 / 1 | 1 / 1 | 1 / 1 | 2 / 1 | 3 / 2 | 7 / 4 | 13 / 7 |
| Fixed costs a month | 2,375 | 2,375 | 2,375 | 2,825 | 4,003 | 8,139 | 14,339 |
| **Profit a month** | **-1,605** | **-106** | **1,393** | **4,690** | **11,006** | **29,352** | **60,622** |
| Break-even orders a day at that staffing | 31 | 32 | 32 | 38 | 54 | 109 | 192 |
| Rider earnings per hour on shift | 1.13 | 3.38 | 4.50 | 4.50 | 4.50 | 4.50 | 4.50 |

**Break-even at launch staffing is about 32 grocery orders a day.** Below about 30 orders a day the riders also earn too little
to stay (under $3.40 an hour with 20 rider-hours on shift): rider-hours must follow demand, or a guarantee is needed.

Sensitivity (each alone, at launch staffing):
| Change | An order leaves | Break-even a day |
| --- | --- | --- |
| Small-order fee of $0.50 on 40% of orders | 2.72 | 30 |
| Margin 15% instead of 20% | 1.72 | 46 |
| Meta at $0.0091 instead of $0.0105 | 2.54 | 32 |
| 65% of orders from vendors | 1.47 (average) | 54 |

The margin is the number that matters: five points of margin move break-even by 14 orders a day. It is still a placeholder
until supplier costs are entered (Phase 5, tasks 5.3 and 2.7).

## 6. What every reward costs
| Reward | Cost | Reading |
| --- | --- | --- |
| First 3 deliveries free (founder idea) | $5.25 per new customer | Three later grocery orders pay it back; a customer who only ever orders those three costs $5.25 less what the orders leave. On vendor orders each free delivery turns $0.93 into a loss of $0.82 |
| First delivery free on a first basket | $1.75 once | The order still leaves about $0.75 |
| **Stamp card: every 10th paid order earns one delivery** | $0.175 an order if every reward is used | 7% of what a grocery order leaves. **Recommended first** |
| One delivery after 30 orders (founder idea) | $0.06 an order | Cheap, and too far away to change behaviour |
| Referral: one delivery each | $3.50 per new customer | After the friend's first paid order |
| 2% credit on every order | $0.32 an order | 13% of a grocery order's contribution; needs a balance liability |
| Combined order: extra pickup | $0.50 to the rider | Paid by the customer, not a company cost |

No reward before the pilot has measured repeat rate at 30 and 60 days, orders per active customer and what an order really leaves.

## 7. Formulas (as in the sheet)
- a dark-store order leaves = basket x margin - basket x shrink - basket x cash loss - packaging + small-order fee x share of small orders - technology per order
- a vendor order leaves = basket x commission - basket x cash loss - extra messages x Meta rate - technology per order
- technology per order = (max(0, messages - free messages) x Meta rate + orders x (AI + speech)) / orders
- fixed costs = rent x hubs + pickers x salary + ops leads x salary + marketing + Kapso + Supabase + recovery + Cloudflare + other
- break-even orders a day = fixed costs / (an average order leaves x 30)
- rider earnings per hour = orders x (fee + tip) / max(rider-hours on shift, orders / orders per rider-hour)

## 8. Not in the model
Working capital for opening stock and the riders' change float; the cost of building (Claude plan); card chargebacks; VAT
(accountant's questions in SYSTEM_PLAN); a rider guarantee; a second hub's rent beyond the simple "one hub per 250 orders a day" row.
