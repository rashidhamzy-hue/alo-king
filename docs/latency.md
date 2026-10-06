# Latency measurements and per-stage timing

`kapso-brain` writes one JSON log line per inbound event (numbers only, no content, no phone):

```json
{"turn_timing":{"kind":"tap","receive_lag_ms":6000,"total_ms":2900,"first_send_ms":2100,"model_calls":0,
 "db":{"ms":1400,"n":9},"model":{"ms":0,"n":0},"send":{"ms":900,"n":1},"transcribe":{"ms":0,"n":0}}}
```

| Field | Meaning |
|---|---|
| `receive_lag_ms` | WhatsApp's message timestamp (1 s resolution) to our handler starting: Meta -> Kapso -> **Kapso's buffer window** -> our function. Includes a little clock skew. |
| `total_ms` | handler start to finish (the customer sees the first reply at `first_send_ms`). |
| `first_send_ms` | time to the first outgoing WhatsApp message of the turn. |
| `db` / `model` / `send` / `transcribe` | summed call time and call count per stage. Calls that overlap (Promise.all) are summed, so a stage can exceed `total_ms`. |
| `kind` | `tap`, `text`, `voice`, `location`, `other`. |

Dry runs (`kapso-brain-test`) return the same objects as `timings` in the response, and `tests/harness.ts` keeps them on each `Turn`.

## p50 / p95 from the logs

Supabase logs, `query_logs` or the dashboard (24 h window at a time):

```sql
select JSONExtractString(event_message, 'turn_timing', 'kind') as kind,
  count() as n,
  quantile(0.5)(JSONExtractFloat(event_message, 'turn_timing', 'total_ms')) as total_p50,
  quantile(0.95)(JSONExtractFloat(event_message, 'turn_timing', 'total_ms')) as total_p95,
  quantile(0.5)(JSONExtractFloat(event_message, 'turn_timing', 'db', 'ms')) as db_p50,
  quantile(0.5)(JSONExtractFloat(event_message, 'turn_timing', 'model', 'ms')) as model_p50,
  quantile(0.5)(JSONExtractFloat(event_message, 'turn_timing', 'send', 'ms')) as send_p50,
  quantile(0.5)(JSONExtractFloat(event_message, 'turn_timing', 'receive_lag_ms')) as receive_p50
from logs
where source = 'function_logs' and event_message like '%turn_timing%'
group by kind
```

This is the ClickHouse dialect of the MCP `query_logs` tool (the dashboard's log explorer uses BigQuery SQL instead: `JSON_VALUE` / `APPROX_QUANTILES`). `db` counts every supabase-js request (PostgREST and RPC); `send` and `transcribe` measure time to response headers; `first_send_ms` is marked when the send call returns, successful or not.
Model calls per turn and cost per order come from `ai_call_log` (`ai_cost_per_order`).

## Baseline (5 Oct 2026, before any change)

Real production traffic is tiny (2 customers, 2 real orders, 1 real customer with model calls in `ai_call_log`), so these numbers are indicative, not statistics. Sources: Kapso message log (inbound WhatsApp timestamp to our first outbound, 1 s resolution), Kapso webhook delivery log, Supabase function logs, `ai_call_log`.

| Stage | Measurement | p50 | p95 | n / source |
|---|---|---|---|---|
| **Receive** (WhatsApp timestamp to our handler) | Kapso webhook delivery vs message timestamp | **6-7 s** | n/a | 4 deliveries. The payload says `batch_info.window_ms: 5000`: Kapso's message buffer (default 5 s) holds every inbound message before delivering it. |
| Webhook ack (our function returns 200) | Kapso delivery log `response_time_ms` / function edge logs | 0.35 s | 0.96 s | 90 production invocations (the work continues in `waitUntil`) |
| **Button tap, no model call**, end to end (customer's tap to our first reply) | Kapso message log | **10 s** | 16 s | 18 real taps |
| **Free text**, end to end (to first reply) | Kapso message log | **13 s** | 24 s | 17 real texts |
| Free text, to the last message of the turn | Kapso message log | 14 s | 27 s | 17 |
| Model calls per customer turn | `ai_call_log` grouped by turn | 3.5 | 5 | 10 turns (mostly the capped staging run) |
| Model time per turn (first call to last call, includes tool/DB time between calls) | `ai_call_log` | 9.2 s | 18.1 s | 10 turns |
| Model cost per turn | `ai_call_log` | $0.024 | $0.065 | 10 turns, mean $0.028 |
| Cost per confirmed order (model only) | `ai_cost_per_order` | mean $0.039 | | 2 orders |
| Whole dry-run turn (db + model, sends skipped) | `kapso-brain-test` function logs | 4.8 s | 21.3 s | 635 requests (test traffic) |

**Reading:** a tap needs no model at all and still takes about 10 s. About 6-7 s of that is Kapso's 5 s buffer window before our function is even called, so roughly 3-4 s is ours (sequential database round trips plus the Kapso send). A free-text turn adds 3-5 model calls (about 9 s). Database vs send time inside the handler cannot be separated from existing logs; the `turn_timing` line added with this document records it from now on.

## Where the seconds go (live run, 5 Oct 2026, staging, after items 0-6)

Per-turn `turn_timing` from the capped live run (19 turns; dry run, so sends are not timed; handler time excludes Kapso's buffer window). **Database round trips dominate everything**:

| Turn | model calls | db queries | db time | model time | handler total |
|---|---|---|---|---|---|
| tap: See Full Menu / More dishes | 0 | 9 | 4.8-5.9 s | 0 | 4.1-5.3 s |
| tap: Edit / basket line | 0 | 10 | 4.9-5.7 s | 0 | 4.7-5.0 s |
| numbered reply `1x2, 2` | 0 | 34 | 15.8 s | 0 | 15.2 s |
| typed `make it 3` | 0 | 18 | 8.3 s | 0 | 8.1 s |
| EN multi-item (3 dishes, deterministic) | 0 | 39 | 23.3 s (parallel overlap) | 0 | 12.5 s |
| free text that needed the model | 1-3 | 31-70 | 17-30 s | 3-8 s | 13-19 s |

About **0.45-0.65 s per database query** in these turns (tap rows: 9 queries in 4.8-5.9 s; the 34-query turn: 15.8 s), against a normal 10-50 ms. "db time" is summed over queries, so parallel queries can make it exceed the handler total. Cause: the project database is in **ap-northeast-1 (Tokyo)** while the function runs near the caller (production `kapso-brain` ran in us-west-2 / us-east-1; the live run's caller was us-east-1), so every query crosses an ocean. Diagnostic with **no model calls** (4 button taps, same phone, same code):

| | region | handler total | db queries | db time |
|---|---|---|---|---|
| default (nearest to caller) | us-east-1 | 2.5 / 3.7 / 4.4 s | 9 / 8 / 9 | 2.7 / 3.9 / 4.6 s |
| `?forceFunctionRegion=ap-northeast-1` | ap-northeast-1 | **0.50 / 0.37 / 0.43 s** | 9 / 8 / 9 | 0.55 / 0.42 / 0.48 s |

Pinning the function to the database's region cut a tap's handler time about **8x (2.5-4.4 s to 0.4-0.5 s)** in this diagnostic (3 taps per arm, one run, dry run so WhatsApp sends are not included): handler time is then well under the 1.5 s target, but this is a small sample and a real tap also pays the Kapso send. Supabase supports this for webhooks through the `forceFunctionRegion` query parameter (or the `x-region` header) on the invocation URL (Supabase docs, "Regional invocations"). Model calls (US) and WhatsApp sends (US) then cross the ocean instead, an extra delay we estimate (not measured here) at 0.15-0.3 s each; that is only a net win while a turn makes many more database queries (9-70) than model and send calls (1-3 each), which holds today. Set the parameter in the Kapso webhook URL (Kapso configuration), not in the repo, and keep the webhook secret out of the URL query string (use a header). Longer term, a database in a region near Kapso/Anthropic (and Lebanon) is the cleaner fix.


## Fewer round trips per message (T2, 5 Oct 2026)

The start of every inbound message used to run **6 sequential queries** before any branch logic: dedupe insert (`processed_messages`), handoff-reply lookup (`handoff_log`, taps carry a context id so it ran for every tap), vendor-owner lookup (`vendors`), customer upsert, `last_inbound_at` update, customer select. They now run as **one** database call, `bot_begin_turn` (migration `20261005180000_bot_begin_turn.sql`, service role only), with identical semantics: a duplicate message id stops everything; the customer is touched only for the same turns as before (not owners, not replies to a forwarded handoff message, not link codes, claim taps, STOP or voice-only messages); the language is set only when none is stored; it also reports whether a numbered list is live, so the "drop the list" delete only runs when there is one. Until the function is deployed the code falls back to the legacy queries, so deployment order does not matter (`turnstart.ts`, with tests that count round trips against a fake client).

Independent reads in the hot tap paths now share one round trip: `addLine` (vendor open, dish, existing basket; line lookup with the line count; basket update with the pending-summary expiry), `sendBasketCard` (lines with the vendor name) and `setLineQty`. A plain text turn also reuses the customer row from the start instead of re-reading it.

| Tap (queries / sequential round trips) | before (measured 5 Oct) | after (by construction) |
|---|---|---|
| start of any message | 6 / 6 | **1 / 1** |
| See Full Menu / More dishes | 9 / 9 | 4 / 3 (measured: 5) |
| basket / edit taps | 10-11 / 10-11 | 5-6 / 5-6 |

### Measured after T2 + T3 (5 Oct, staging `kapso-brain-test` v27, dry run, 19 turns per run, one run per region, about $0.05 each per the script's spend job)

Menu, More, Edit and basket-line taps made **5 queries** (the by-construction estimate of 4 missed one), "One more" 10, checkout/confirm 14-15; text turns 13-38 (the numbered reply and typed edits are the heavy ones and were not part of T2).

| Function region | Tap handler p50 / p95 | Tap wall (HTTP) p50 / p95 | Taps under 1.5 s handler |
|---|---|---|---|
| default (near the caller, DB is in Tokyo) | 2.7 s / 6.6 s | 3.6 s / 7.4 s | 1 of 10 |
| `forceFunctionRegion=ap-northeast-1` | **0.27 s / 0.93 s** | 1.1 s / 1.8 s | **10 of 10** |

Samples are small (10 taps per region), so p95 is effectively the maximum. Query count alone does not meet the 1.5 s target from a US-region function (about 0.5 s per round trip to Tokyo); pinning the region does. The region is set in the Kapso webhook URL (owner decision, not a secret). "Wall" is measured from the test machine over HTTP, so it includes this machine's network; it is not Kapso's 5 s buffer or real WhatsApp send time. Free text that resolved server-side made 0 model calls; the model-bound turns made 1-3 (mean 0.26 per turn over the run); cost per order about $0.006.

### Re-measured after M2-M9 (6 Oct 2026, staging v30, one capped run, $0.15 total of the $1.50 cap)
| Function region | Tap handler p50 / p95 | Tap over HTTP p50 / p95 | Taps under 1.5 s | Model calls per turn (mean / max) | Free-text handler p50 / p95 |
|---|---|---|---|---|---|
| pinned `ap-northeast-1` | **0.28 s / 0.89 s** | 1.1 s / 2.4 s | **10 of 10** | 0.26 / 3 | 1.5 s / 12.1 s (the 12 s tail is the three-call model-bound turn) |
| default region | 1.9 s / 5.2 s | 2.8 s / 6.1 s | 5 of 10 | 0.32 / 4 | 5.3 s / 20.8 s |

54 of 54 checks passed in the pinned run (taps under 1.5 s with no model call, resolvable free text in at most one call, cost per order about $0.006 of AI); in the default-region run the tap target missed on four taps and one model-bound turn used four calls (the cap in the script is three). The Kapso webhook URL already carries `forceFunctionRegion=ap-northeast-1` (owner change, 6 Oct 02:27 Beirut-3), so production now matches the pinned column.
