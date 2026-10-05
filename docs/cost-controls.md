# AI cost controls (kapso-brain)

| What | Where | Notes |
|---|---|---|
| Per-call usage log | table `ai_call_log` | One row per Anthropic call from `kapso-brain` (customer and owner bots): model, input/output/cache-read/cache-write tokens, estimated USD, day (Asia/Beirut). **No message content.** Customer calls carry the phone; confirming an order stamps that customer's un-attributed calls with `order_id`. |
| Reports | views `ai_cost_daily`, `ai_cost_per_order` | Service role / SQL editor only (RLS on, no anon/authenticated grants). Cost per confirmed order = `ai_cost_per_order.est_usd`. |
| Prices | `usage.ts` | USD per MTok (Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5; cache read 0.1x, 5-minute cache write 1.25x). Unknown models are priced at the dearest known rate so spend is never under-counted. Update the table when the model or prices change. |
| Prompt caching | `llmLoop` | Tools (breakpoint on the last tool) and the static system prompt are cached; the per-customer profile / owner language line sits after the breakpoint. `usage.cache_read_input_tokens` shows hits. If the API rejects `cache_control` the call is retried uncached. There is no static menu context in the prompt (menus come from tools), so nothing else to cache today. |
| Per-phone cap | secret `AI_CALLS_PER_PHONE_HOUR` (default 40) | Anthropic calls (one chat turn is usually 1-3) per customer phone in a rolling hour. Over the cap: that customer gets a short message plus buttons (basket, location, reorder); taps keep working. |
| Daily budget | secret `DAILY_AI_BUDGET_USD` (default 5) | Estimated spend today (Asia/Beirut) across `ai_call_log`. At or over budget: **all customers** go button-only until tomorrow, and `ADMIN_WHATSAPP_PHONE` gets one WhatsApp alert per day (`ai_budget_alerts`; delivery needs the admin's 24h window open, otherwise it is logged and the dashboard/SQL view is the fallback). The owner ("Alo King Business") bot is logged but never blocked, so merchants can still run their business. |

Fail-open: if the guard's own queries fail, the bot answers normally and logs the error.

Not covered yet: `demo-chat` (public website demo; only a per-instance IP rate limit) and `merchant-ai` (dashboard AI; per-vendor daily counter in `ai_usage`) call Anthropic outside this log and budget; Whisper transcription is billed separately by OpenAI.
