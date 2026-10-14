// WhatsApp webhook entry point (Kapso). Configure the Kapso webhook URL as
//   https://tzugbbatfbvrfzxuacqx.supabase.co/functions/v1/whatsapp-webhook?forceFunctionRegion=eu-central-1
// with the webhook's secret stored as the function secret KAPSO_WEBHOOK_SECRET. verify_jwt is off
// (supabase/config.toml): the HMAC signature is the authentication.

import { makeHandler, type IntakeResult } from "./handler.ts";
import type { IntakeEvent } from "./intake.ts";
import { restRpc } from "../_shared/rest-rpc.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// webhook_intake deduplicates on the event key, so a stalled call (#139) is retried once on a new request (6 s
// each, inside Kapso's delivery timeout); if both stall the delivery fails with a 500 and Kapso redelivers.
const rpc = restRpc({
  url: supabaseUrl,
  key: serviceKey,
  timeoutMs: 6000,
  log: (msg, fields) => console.log(JSON.stringify({ fn: "whatsapp-webhook", msg, ...fields })),
});

async function intake(events: IntakeEvent[]): Promise<IntakeResult[]> {
  const results = ((await rpc("webhook_intake", { p_provider: "kapso", p_events: events })) ??
    []) as IntakeResult[];
  if (results.some((r) => !r.duplicate)) kickDispatch();
  return results;
}

// Phase two starts at once instead of at the next 5-second tick (§4 button latency). Fire and forget:
// the acknowledgement to Kapso never waits for it, and the tick picks up anything this misses.
function kickDispatch() {
  const p = fetch(`${supabaseUrl}/functions/v1/dispatch`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: "{}",
  })
    .then((r) => r.body?.cancel())
    .catch(() => {});
  (
    globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }
  ).EdgeRuntime?.waitUntil?.(p);
}

const handler = makeHandler({
  secret: Deno.env.get("KAPSO_WEBHOOK_SECRET") || undefined,
  e2eSecret: Deno.env.get("E2E_WEBHOOK_SECRET") || undefined,
  intake,
  log: (msg, fields) => console.log(JSON.stringify({ fn: "whatsapp-webhook", msg, ...fields })),
});

Deno.serve(handler);
