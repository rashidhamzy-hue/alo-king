# Webhook authentication (kapso-brain)

`kapso-brain` is called by Kapso's `whatsapp.message.received` webhook. Until now the only credential was a shared secret in the URL (`?key=…`). A secret in a URL is written into Kapso's delivery logs and anything that logs URLs, so the endpoint now accepts better credentials. **Secrets never appear in this repo, in logs, in PRs or in chat.**

## Accepted credentials (any one is enough; checked in constant time)

| Order | Credential | Where it comes from | Secret in the URL? |
|---|---|---|---|
| 1 | `X-Webhook-Signature`: lowercase hex HMAC-SHA256 of the **raw request body** | Kapso signs every delivery with the webhook's `secret_key` | no, and the secret never travels |
| 2 | `x-webhook-secret` header equal to the shared secret | a custom header on the Kapso webhook | no |
| 3 | `?key=` equal to the shared secret (**legacy**) | the current webhook URL | yes |

Supabase secrets read by the function: `KAPSO_WEBHOOK_SECRET` (shared secret, methods 2 and 3) and `KAPSO_WEBHOOK_SIGNING_SECRET` (signature, method 1). If neither is set the endpoint is open, as before.

**`?key=` keeps working until you confirm the new method**, then it is removed (a one-line change plus editing the URL in Kapso). During the transition an invalid or missing signature does not block a valid `?key=`.

## Switching over (owner steps; run these yourself so the value never passes through chat)

1. Generate a value locally (for example `openssl rand -hex 32`). Do not paste it anywhere except the two places below, and paste it with no leading or trailing space or newline (the function trims it, Kapso may not).
2. Supabase → Edge Functions → Secrets: set `KAPSO_WEBHOOK_SIGNING_SECRET` to that value.
3. Kapso → the webhook for the production number → set **Secret key** to the same value (Kapso then signs deliveries with it). Leave the URL as it is for now.
4. Send a test message and check which method was used (the function logs only the method name, never a secret):
   ```sql
   select event_message from function_logs
   where event_message like '%webhook_auth%' order by timestamp desc limit 20
   ```
   Each line reads `{"webhook_auth":{"method":"..."}}`. You want `signature`. `query` means Kapso is still sending only the URL key (or the two secrets differ).
5. Tell us "the signature works": we remove `?key=` support from the code, you remove `?key=…` from the Kapso webhook URL, and you **rotate** `KAPSO_WEBHOOK_SECRET` (the old value has been visible in Kapso's delivery logs).

If you also set `forceFunctionRegion=ap-northeast-1` on the URL (see `docs/latency.md`), do it in the same edit.

Known limits: Kapso's signature covers the body only (no timestamp), so a captured signed delivery could be replayed; the body is read before it is verified (Supabase platform limits apply).
