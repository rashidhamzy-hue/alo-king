// dispatch: merchant taps and commands, the outbox and ops alerts (DECISIONS §4, §13, §23, §30.3.5).
// Invoked by pg_cron through pg_net every 5 seconds when there is work (header x-dispatch-secret, checked
// with dispatch_secret_ok), and by whatsapp-webhook right after an intake (service-role bearer). Twilio
// posts call keypresses to ?route=twilio, checked by Twilio's signature. verify_jwt is off
// (supabase/config.toml): these checks are the authentication.
//
// Secrets (Supabase function secrets): KAPSO_API_KEY; optional TELEGRAM_BOT_TOKEN and TELEGRAM_OPS_CHAT_ID
// (ops alerts), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (voice layer), SENTRY_DSN, ADMIN_BASE_URL.

import { runDispatch, type SendResult } from "./handler.ts";
import {
  callScript,
  gatherTwiml,
  placeCall,
  sayTwiml,
  verifyTwilio,
  type TwilioConfig,
} from "../_shared/twilio.ts";
import { reportError } from "../_shared/sentry.ts";

// Kapso is reached only here (CLAUDE.md); never from configuration or message content.
const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

const env = (k: string) => Deno.env.get(k) || undefined;
const supabaseUrl = env("SUPABASE_URL") ?? "";
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const kapsoKey = env("KAPSO_API_KEY");
const sentryDsn = env("SENTRY_DSN");
const twilio: TwilioConfig | null =
  env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM")
    ? {
        accountSid: env("TWILIO_ACCOUNT_SID")!,
        authToken: env("TWILIO_AUTH_TOKEN")!,
        from: env("TWILIO_FROM")!,
      }
    : null;
const selfUrl = `${supabaseUrl}/functions/v1/dispatch`;

const log = (msg: string, fields?: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify({ fn: "dispatch", msg, ...fields }));

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
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function whatsapp(
  phoneNumberId: string,
  payload: Record<string, unknown>,
): Promise<SendResult> {
  if (!kapsoKey) return { ok: false, retry: false, error: "KAPSO_API_KEY not set" };
  try {
    const res = await fetch(`${KAPSO_BASE}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { "X-API-Key": kapsoKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: body?.messages?.[0]?.id };
    return {
      ok: false,
      retry: res.status >= 500 || res.status === 429,
      error: `kapso ${res.status} ${JSON.stringify(body?.error ?? {}).slice(0, 200)}`,
    };
  } catch (e) {
    return {
      ok: false,
      retry: true,
      error: `kapso network: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
    };
  }
}

const telegramToken = env("TELEGRAM_BOT_TOKEN");
const telegramChat = env("TELEGRAM_OPS_CHAT_ID");
async function telegram(text: string, url?: string): Promise<SendResult> {
  const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramChat,
      text,
      disable_web_page_preview: true,
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: "Open", url }]] } } : {}),
    }),
  });
  await res.body?.cancel();
  return res.ok
    ? { ok: true }
    : { ok: false, retry: res.status >= 500, error: `telegram ${res.status}` };
}

async function authorised(req: Request): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && serviceKey && bearer === serviceKey) return true;
  const secret = req.headers.get("x-dispatch-secret");
  if (!secret) return false;
  return (await rpc("dispatch_secret_ok", { p_secret: secret })) === true;
}

async function twilioKeypress(req: Request, url: URL): Promise<Response> {
  const form = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const order = url.searchParams.get("order") ?? "";
  const signedUrl = `${selfUrl}?route=twilio&order=${encodeURIComponent(order)}`;
  if (
    !twilio ||
    !(await verifyTwilio(twilio.authToken, signedUrl, form, req.headers.get("x-twilio-signature")))
  ) {
    return new Response("forbidden", { status: 403 });
  }
  const xml = (s: string) => new Response(s, { headers: { "content-type": "text/xml" } });
  try {
    await rpc("order_acknowledge", {
      p_order_id: order,
      p_channel: "call",
      p_member_id: null,
      p_provider_ref: form.CallSid ?? null,
    });
    if (form.Digits === "1") {
      await rpc("order_accept", {
        p_order_id: order,
        p_prep_minutes: null,
        p_member_id: null,
        p_channel: "call",
      });
      return xml(sayTwiml("تم قبول الطلب. التفاصيل على واتساب."));
    }
    if (form.Digits === "2") {
      await rpc("order_reject", {
        p_order_id: order,
        p_reason: "busy",
        p_note: null,
        p_member_id: null,
        p_channel: "call",
      });
      return xml(sayTwiml("تم رفض الطلب."));
    }
    const card = await rpc("order_call_card", { p_order_id: order });
    return xml(gatherTwiml(callScript(card), signedUrl));
  } catch (e) {
    log("twilio keypress failed", { error: String(e).slice(0, 200) });
    return xml(sayTwiml("صار في مشكلة. شوف الطلب على واتساب."));
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (url.searchParams.get("route") === "twilio") return twilioKeypress(req, url);
  if (!(await authorised(req))) return new Response("unauthorised", { status: 401 });
  try {
    const result = await runDispatch({
      rpc,
      whatsapp,
      call: twilio
        ? (to, card) =>
            placeCall(
              twilio,
              to,
              gatherTwiml(
                callScript(card),
                `${selfUrl}?route=twilio&order=${encodeURIComponent(card.order_id)}`,
              ),
            )
        : null,
      telegram: telegramToken && telegramChat ? telegram : null,
      adminUrl: env("ADMIN_BASE_URL"),
      log,
    });
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    log("dispatch failed", { error: String(e).slice(0, 300) });
    await reportError(sentryDsn, e, { fn: "dispatch" });
    return new Response(JSON.stringify({ error: "dispatch failed" }), { status: 500 });
  }
});
