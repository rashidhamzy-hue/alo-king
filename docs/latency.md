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
select kind,
  count() n,
  quantile(0.5)(toFloat64OrZero(JSONExtractString(event_message, 'turn_timing', 'total_ms'))) total_p50,
  quantile(0.95)(toFloat64OrZero(JSONExtractString(event_message, 'turn_timing', 'total_ms'))) total_p95
from logs
where source = 'function_logs' and event_message like '%turn_timing%'
group by kind
```

(Extract nested fields with `JSONExtractRaw`/`JSONExtractFloat(event_message, 'turn_timing', 'db', 'ms')` for the per-stage columns.)
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
