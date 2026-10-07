// WhatsApp webhook entry point (Kapso). Configure the Kapso webhook URL as
//   https://tzugbbatfbvrfzxuacqx.supabase.co/functions/v1/whatsapp-webhook?forceFunctionRegion=eu-central-1
// with the webhook's secret stored as the function secret KAPSO_WEBHOOK_SECRET. verify_jwt is off
// (supabase/config.toml): the HMAC signature is the authentication.

import { makeHandler, type IntakeResult } from "./handler.ts";
import type { IntakeEvent } from "./intake.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function intake(events: IntakeEvent[]): Promise<IntakeResult[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/webhook_intake`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_provider: "kapso", p_events: events }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`webhook_intake returned ${res.status}`);
  }
  return (await res.json()) as IntakeResult[];
}

const handler = makeHandler({
  secret: Deno.env.get("KAPSO_WEBHOOK_SECRET") || undefined,
  intake,
  log: (msg, fields) => console.log(JSON.stringify({ fn: "whatsapp-webhook", msg, ...fields })),
});

Deno.serve(handler);
