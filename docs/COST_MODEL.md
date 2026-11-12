# Cost model (snapshot, 12 November 2026)

A summary so the repository is self-contained. The founder keeps a live spreadsheet with the same formulas.
All amounts in US dollars. Everything marked (placeholder) is an assumption nobody has confirmed.

## Rules the model follows
- Riders keep 100% of delivery fees and tips. Alo King pays no wage. Rider cost to the company is zero unless a guarantee is introduced.
- Alo King's income is dark-store margin plus contracted restaurant commission. Nothing else.
- Only onboarded restaurants take orders, so commission applies to every restaurant order. There are none yet: launch income is groceries.

## Inputs
| Input | Value | Status |
| --- | --- | --- |
| Basket, grocery and restaurant | 16 | placeholder |
| Dark-store gross margin | 20% | placeholder; needs supplier costs |
| Restaurant commission | 7.5% | founder: 5-10% in Chouf, per contract |
| Average delivery fee (rider's) | 1.75 | draft zone fees 1.00 / 1.50 / 2.50 |
| Average tip (rider's) | 0.50 | placeholder |
| Restaurant share of orders | 65% | placeholder; zero until a partner signs |
| Rider-hours on shift per day | 20 | placeholder |
| Packaging per grocery order | 0.15 | estimate |
| Shrink, share of grocery basket | 2% | estimate |
| Cash loss and failed deliveries, share of basket | 0.5% | estimate |
| Rent 400, power and refrigeration 300, ops lead 700, picker 450, marketing 200, misc 100 (per month) | 2,150 | placeholder |
| One picker per 80 orders a day; one ops lead per 150 | | placeholder |

## Technology
Subscriptions at launch, per month: Kapso Pro 25, Supabase 30, Cloudflare Workers Paid 5, Anthropic fixed jobs 10, domain 3, two +961 lines 10. Total about 83.
At 300 orders a day: about 272, plus Kapso overage.
Per order: Meta message fees about 0.07-0.09 (10 billed messages at 0.0091 after 2,000 free a month; verify on the first real bill).
Checked 12 November 2026 against published summaries of Meta's 1 October 2026 rate card: free-form replies are billed at the utility rate
after 1,000 free per number per month, utility templates are billed from the first one, Lebanon is priced as "Rest of Middle East".
The 0.0091 utility figure is from one secondary source; the first bill decides (build plan 4.4, 4.12). A marketing template is about 0.039, which we do not send.
Also per order:
AI about 0.012, speech-to-text about 0.001. All-in tech: 0.13 to 0.18 an order.

## Results
| | 30/day | 60/day | 100/day | 300/day |
| --- | --- | --- | --- | --- |
| Restaurant order leaves | 1.04 | 1.03 | 1.02 | 0.99 |
| Grocery order leaves | 2.57 | 2.56 | 2.55 | 2.52 |
| Fixed costs per month | 2,233 | 2,233 | 2,683 | 4,472 |
| Profit per month | -818 | 578 | 1,990 | 9,260 |
| Break-even orders per day | 47 | 48 | 57 | 98 |
| Rider earnings per hour on shift | 2.70 | 3.60 | 4.50 | 4.95 |

Groceries only (no restaurants), launch staffing: break-even is about 29 orders a day.
Rider earnings per hour is the figure to watch: riders who earn too little leave, and the profit line does not show it.
A guarantee of 3 an hour costs nothing at 100 orders a day and about 7.50 a day at 30.

## Formulas
- grocery order leaves = basket x margin - tech - basket x cash loss - packaging - basket x shrink
- restaurant order leaves = basket x commission - tech - basket x cash loss
- rider earnings per hour = orders x (fee + tip) / max(rider-hours on shift, orders / orders per rider-hour)
- break-even orders per day = fixed costs per month / (average order leaves x 30)

## Small-order fee (supported, not yet decided)
Company income, separate from the rider's delivery fee. Off until the founder sets it (build plan 1.16, 5.14).
Effect on the model: average order leaves += fee x share of orders below the threshold.
Illustration only: a fee of 0.50 on 40% of orders adds 0.20 an order, moving launch break-even from about 47 to about 42 orders a day.

## Not in this model yet
Card processor fees and chargebacks (Phase 9), working capital, and real cost of goods (measured from build plan task 2.7 onward).

## Rewards (not active; illustration for the decision after the pilot)
A free delivery is never free: the rider is still paid the fee, so Alo King pays it. With the inputs above (fee 1.75; a grocery order leaves 2.57; a restaurant order leaves about 1.02):
| Design | Cost | Reading |
| --- | --- | --- |
| First 5 deliveries free | up to 8.75 per new customer | Five grocery orders leave 12.85, so it pays only if the customer would not have ordered anyway and keeps ordering. On restaurant orders each free delivery loses about 0.73. |
| First delivery free on a grocery basket of 15 or more | 1.75 once | The order still leaves about 0.82. |
| Every 10th paid order earns one delivery | 0.175 an order if every reward is used | 7% of what a grocery order leaves; 17% of a restaurant order. |
| 2% credit on every order | 0.32 an order | 12% of a grocery order's contribution, 31% of a restaurant order's. Needs a balance liability. |
| One delivery at 30 orders | 0.06 an order | Cheap, and too far away to change behaviour. |
All of these rest on placeholder inputs. What the pilot must measure first: repeat rate at 30 and 60 days, orders per active customer per month, and what an order really leaves.
