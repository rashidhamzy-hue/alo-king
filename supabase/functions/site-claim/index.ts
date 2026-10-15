// site-claim: the website's claim, registration and driver forms (DECISIONS §18, §24.3, §37.4). The handler and its
// rules are in ../_shared/site-claim.ts; this file only wires the database, Kapso, Twilio and storage.
// verify_jwt is off (supabase/config.toml): visitors are anonymous. The authentication is the work itself: a claim code
// reaches only the shop's own number, documents are reviewed by a person, and every action is rate limited per visitor.
//
// Function secrets (synced by the deploy job from the GitHub secrets of the same name): KAPSO_API_KEY (the code by
// WhatsApp); optional TWILIO_* (the code by voice call to a landline) and SENTRY_DSN. Without Kapso or Twilio the code
// cannot be delivered and the claim moves to documents, exactly as in the WhatsApp onboarding.

import { makeHandler, visitorKeyFrom, type SendResult } from "../_shared/site-claim.ts";
import { claimCodeScript } from "../_shared/onboarding-cards.ts";
import { claimCodePayload } from "../_shared/claim-code.ts";
import { placeCall, sayTwiml, type TwilioConfig } from "../_shared/twilio.ts";
import { reportError } from "../_shared/sentry.ts";

// Kapso is reached only here and in dispatch (CLAUDE.md); never from configuration or request content.
const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

const env = (k: string) => Deno.env.get(k) || undefined;
const supabaseUrl = env("SUPABASE_URL") ?? "";
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const kapsoKey = env("KAPSO_API_KEY");
const sentryDsn = env("SENTRY_DSN");
const pepper = env("SITE_VISITOR_PEPPER") ?? serviceKey.slice(-16);
const twilio: TwilioConfig | null =
  env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM")
    ? {
        accountSid: env("TWILIO_ACCOUNT_SID")!,
        authToken: env("TWILIO_AUTH_TOKEN")!,
        from: env("TWILIO_FROM")!,
      }
    : null;

const log = (msg: string, fields?: Record<string, string>) =>
  console.log(JSON.stringify({ fn: "site-claim", msg, ...fields }));

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function whatsappCode(to: string, code: string): Promise<SendResult> {
  // A simulator number is never sent to Kapso (DECISIONS §36).
  if (/^\+?999[0-9]{6,12}$/.test(to)) return { ok: false, retry: false, error: "simulator number" };
  if (!kapsoKey) return { ok: false, retry: false, error: "KAPSO_API_KEY not set" };
  const sender = (await rpc("whatsapp_sender", { p_audience: "merchant" })) as string | null;
  if (!sender) return { ok: false, retry: false, error: "no sending number" };
  try {
    const res = await fetch(`${KAPSO_BASE}/${encodeURIComponent(sender)}/messages`, {
      method: "POST",
      headers: { "X-API-Key": kapsoKey, "content-type": "application/json" },
      body: JSON.stringify(await claimCodePayload(rpc, sender, to, code)),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: body?.messages?.[0]?.id };
    return { ok: false, retry: res.status >= 500, error: `kapso ${res.status}` };
  } catch (e) {
    return { ok: false, retry: true, error: `kapso network: ${String(e).slice(0, 80)}` };
  }
}

Deno.serve(
  makeHandler({
    rpc,
    whatsappCode,
    voiceCode: twilio ? (to, code) => placeCall(twilio, to, sayTwiml(claimCodeScript(code))) : null,
    storeDocument: async (path, bytes, mime) => {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/claim-documents/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${serviceKey}`, "content-type": mime },
        body: new Uint8Array(bytes),
      });
      await res.body?.cancel();
      return res.ok;
    },
    removeDocument: async (path) => {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/claim-documents/${path}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${serviceKey}` },
      });
      await res.body?.cancel();
    },
    log: (msg, fields) => {
      log(msg, fields);
      if (msg === "site-claim failed")
        void reportError(sentryDsn, new Error(fields?.error ?? msg), { fn: "site-claim" });
    },
    // The visitor key is an HMAC of their address (as the platform's edge saw it) with a secret pepper: counters and the
    // "Ask them to join" taps cannot be turned back into addresses, and no caller can choose its own key.
    visitorKey: (req) => visitorKeyFrom(req, pepper),
  }),
);
