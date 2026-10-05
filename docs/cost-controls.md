# AI cost controls (kapso-brain)

| What | Where | Notes |
|---|---|---|
| Per-call usage log | table `ai_call_log` | One row per Anthropic call from `kapso-brain` (customer and owner bots): model, input/output/cache-read/cache-write tokens, estimated USD, day (Asia/Beirut). **No message content.** Customer calls carry the phone; confirming an order stamps that customer's un-attributed calls with `order_id`. |
| Reports | views `ai_cost_daily`, `ai_cost_per_order` | Service role / SQL editor only (RLS on, no anon/authenticated grants). Cost per confirmed order = `ai_cost_per_order.est_usd`. |
| Prices | `usage.ts` | USD per MTok (Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5; cache read 0.1x, 5-minute cache write 1.25x). Unknown models are priced at the dearest known rate so spend is never under-counted. Update the table when the model or prices change. |
| Prompt caching | `llmLoop` | Tools (breakpoint on the last tool) and the static system prompt are cached; the per-customer profile / owner language line sits after the breakpoint. `usage.cache_read_input_tokens` shows hits. If the API rejects `cache_control` the call is retried uncached. There is no static menu context in the prompt (menus come from tools), so nothing else to cache today. |
| Per-phone cap | secret `AI_CALLS_PER_PHONE_HOUR` (default 20) | Anthropic calls (one chat turn is usually 1-3) per customer phone in a rolling hour. Over the cap: that customer gets a short message plus buttons (basket, location, reorder); taps keep working. |
| Daily budget | secret `DAILY_AI_BUDGET_USD` (default 5) | Estimated spend today (Asia/Beirut) across `ai_call_log`. At or over budget: **all customers** go button-only until tomorrow, and `ADMIN_WHATSAPP_PHONE` gets one WhatsApp alert per day (`ai_budget_alerts`; delivery needs the admin's 24h window open, otherwise it is logged and the dashboard/SQL view is the fallback). The owner ("Alo King Business") bot is logged but never blocked, so merchants can still run their business. |

Button-only mode keeps working without the model: taps (Confirm, basket, menu, reorder, location), STOP/opt-out and typed cancel; a plain typed "yes" confirms when exactly one summary is waiting. Still needing the model (so replaced by the button message): free-text ordering, Change Order, checkout with an incomplete profile, and first-time greetings.

Attribution: confirming an order stamps that customer's un-attributed calls from the last 24 hours (with multi-vendor checkout the first confirm takes them). `ai_call_log` holds customer phones: rows older than 90 days are deleted by the scheduled `order-watchdog` job. The budget is a soft cap (concurrent requests can overshoot by about one burst) and also counts owner-bot spend, which is never blocked.

Fail-open: if the guard's own queries fail, the bot answers normally and logs the error.

Not covered yet: `demo-chat` (public website demo; only a per-instance IP rate limit) and `merchant-ai` (dashboard AI; per-vendor daily counter in `ai_usage`) call Anthropic outside this log and budget; Whisper transcription is billed separately by OpenAI.

## Cheap router (flow item 5, off by default)
`CHEAP_ROUTER_ENABLED=true` (Supabase secret; anything else = off) sends clearly informational turns (greetings, thanks, "what's good", menu, hours, delivery info, in English / Arabic / Arabizi) to `CHEAP_MODEL` (default `claude-haiku-4-5-20251001`) with read-only tools only (search, vendor info, offer cards, menu, show basket). Orders, basket changes, confirm/cancel, complaints, anything with a number, anything while a summary is waiting, and replayed voice notes always use the main model. If the small model decides the turn needs more it calls `needs_full_assistant` before sending anything and the main model answers instead. Usage is logged per call with the model that served it (Haiku priced in `usage.ts`). Prompt caching rarely applies to Haiku (4096-token minimum).

## Live measurements (capped run, 5 Oct 2026, staging + one production customer)
- **Caching works live.** Sonnet 5.5: the static prefix (tools + system prompt) is **4,062 tokens**, written once and read on every later call (also seen on a real production customer: 4,062 cache-read tokens on all 5 calls). About 44% of prompt tokens in the run were cache reads.
- **Haiku 4.5 will not cache this prefix**: its minimum cacheable prompt is 4,096 tokens and the prefix is 4,062 (a different, smaller tool set for the cheap router is smaller still). Don't expect cache savings on Haiku turns.
- **The cost driver is uncached input, not the prefix**: calls carry 1k-10k uncached tokens (chat history plus `search_menu` results), and a Sonnet turn takes 3-4 model calls (search, offers, ...). Levers, in order: shorter `search_menu` results, a smaller history window, fewer tool round-trips per turn.
- Measured: roughly $0.04 per confirmed order (mixed Haiku/Sonnet test conversations), $0.03-0.13 per conversation; a Sonnet turn with three offer cards cost about $0.03-0.04.
- **Haiku 4.5 as the main model failed free-text ordering** (it did not resolve the vendor id and asked the customer which vendor). Keep Haiku for the cheap router's informational turns only.
