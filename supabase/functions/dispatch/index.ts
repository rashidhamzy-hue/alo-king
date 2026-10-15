// dispatch: merchant taps and commands, the outbox and ops alerts (DECISIONS §4, §13, §23, §30.3.5).
// Invoked by pg_cron through pg_net every 5 seconds when there is work (header x-dispatch-secret, checked
// with dispatch_secret_ok), and by whatsapp-webhook right after an intake (service-role bearer). Twilio
// posts call keypresses to ?route=twilio, checked by Twilio's signature. verify_jwt is off
// (supabase/config.toml): these checks are the authentication.
//
// Function secrets, synced by the deploy job from the GitHub secrets of the same name: KAPSO_API_KEY;
// optional TELEGRAM_BOT_TOKEN and TELEGRAM_OPS_CHAT_ID (ops alerts), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM (voice layer), SENTRY_DSN (from SENTRY_DSN_FUNCTIONS); ADMIN_BASE_URL once the site exists.
// Customer bot (session 4): ANTHROPIC_API_KEY (turns), OPENAI_API_KEY (voice transcription only, §3),
// ORS_API_KEY (road routes for the delivery quote). Without a key that part is off, never faked.

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
import { restRpc } from "../_shared/rest-rpc.ts";
import { isSimNumber, simSinkSend } from "../_shared/sim-sink.ts";
import { orsProvider, restRouteCache, roadRoutes } from "../_shared/routing.ts";
import { safeFetch } from "../_shared/safe-fetch.ts";
import type { ModelRequest, ModelResponse, Transcript } from "./customer/turn.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

// Kapso is reached only here (CLAUDE.md); never from configuration or message content.
const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";
// A send that has not answered by then is retried by the outbox (a stalled request never holds the worker).
const KAPSO_TIMEOUT_MS = 15_000;

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

// ---- Customer bot adapters --------------------------------------------------------------------------------
const anthropicKey = env("ANTHROPIC_API_KEY");
const openaiKey = env("OPENAI_API_KEY");
const orsKey = env("ORS_API_KEY");
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey, maxRetries: 0 }) : null;

async function callModel(req: ModelRequest): Promise<ModelResponse> {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    // The system prompt and the tool list never change between turns: cached (§6 cost model).
    system: [
      { type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } },
    ],
    tools: req.tools as Anthropic.Tool[],
    tool_choice: { type: "auto" as const },
    messages: req.messages,
  };
  let msg: Anthropic.Message;
  try {
    msg = await anthropic!.messages.create(body, { timeout: req.timeoutMs });
  } catch (e) {
    // A model that does not take strict tool schemas gets the same tools without the flag; the server
    // validates every input either way (turn.ts validate()). tools.test.ts keeps the schemas valid; this
    // only covers a rule the API adds later.
    if (e instanceof Anthropic.BadRequestError && /strict|schema|enum|tools\./i.test(e.message)) {
      const tools = (req.tools as Record<string, unknown>[]).map(
        ({ strict: _s, ...t }) => t,
      ) as unknown as Anthropic.Tool[];
      msg = await anthropic!.messages.create({ ...body, tools }, { timeout: req.timeoutMs });
    } else throw e;
  }
  return {
    content: msg.content.flatMap((b): ModelResponse["content"] =>
      b.type === "text"
        ? [{ type: "text", text: b.text }]
        : b.type === "tool_use"
          ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }]
          : [],
    ),
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
    stop_reason: msg.stop_reason,
  };
}

async function transcribe(
  audio: Uint8Array,
  mime: string,
  prompt: string,
  model: string,
): Promise<Transcript> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: mime }),
    mime.includes("ogg") ? "voice.ogg" : "voice.audio",
  );
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("response_format", "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`openai transcription ${res.status}`);
  const j = await res.json();
  return {
    text: String(j.text ?? ""),
    seconds: j.usage?.seconds ?? j.duration ?? null,
    model,
    inputTokens: j.usage?.input_tokens,
    outputTokens: j.usage?.output_tokens,
  };
}

/**
 * Inbound media (voice notes), at most maxBytes. The Kapso key is sent only to api.kapso.ai, never to the
 * host of a redirect or of a signed media URL (review of #110); one redirect is followed, without the key.
 */
async function fetchMedia(
  m: { url?: string | null; id?: string | null },
  phoneNumberId: string,
  maxBytes: number,
) {
  if (!kapsoKey) return null;
  const isKapso = (u: string) =>
    new URL(u).protocol === "https:" && new URL(u).host === "api.kapso.ai";
  let url = m.url && isKapso(m.url) ? m.url : null;
  if (!url && m.id) {
    const r = await fetch(
      `${KAPSO_BASE}/${encodeURIComponent(m.id)}?phone_number_id=${encodeURIComponent(phoneNumberId)}`,
      {
        headers: { "X-API-Key": kapsoKey },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!r.ok) return null;
    url = (await r.json())?.url ?? null;
  }
  if (!url || !url.startsWith("https://")) return null;
  let res = await fetch(url, {
    headers: isKapso(url) ? { "X-API-Key": kapsoKey } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location");
    await res.body?.cancel();
    if (!next) return null;
    const to = new URL(next, url);
    if (to.protocol !== "https:") return null;
    res = await fetch(to, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  }
  if (!res.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > maxBytes) return null;
  return { bytes, mime: res.headers.get("content-type")?.split(";")[0] || "audio/ogg" };
}

/** The smart-menu model (§18.3): config `ai_menu_model`, one call per photo or PDF, JSON text back. */
async function menuModel(
  req: Parameters<import("../_shared/menu-draft.ts").MenuModel>[0],
): Promise<string> {
  const model = String((await rpc("config_value", { p_key: "ai_menu_model" })) ?? "");
  if (!model) throw new Error("ai_menu_model is not configured");
  const msg = await anthropic!.messages.create(
    {
      model,
      max_tokens: 8000,
      system: req.system,
      messages: [{ role: "user", content: req.content as Anthropic.MessageParam["content"] }],
    },
    { timeout: 60_000 },
  );
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/**
 * Claim documents (§18.1 C-L): the WhatsApp media is copied into the private `claim-documents` bucket
 * (service role only), so the review and the audit of G and I outlive WhatsApp's media retention.
 * Images and PDFs up to 10 MB; anything else keeps the WhatsApp reference.
 */
async function storeDocument(
  phoneNumberId: string,
  media: { id: string; url: string | null; mime: string },
  claimId: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(claimId)) return null;
  const file = await fetchMedia({ url: media.url, id: media.id }, phoneNumberId, 10_000_000);
  if (!file) return null;
  const mime = file.mime || media.mime;
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/png"
        ? "png"
        : mime.startsWith("image/")
          ? "jpg"
          : null;
  if (!ext) return null;
  const path = `${claimId}/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/claim-documents/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceKey}`, "content-type": mime },
    body: file.bytes,
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok ? `storage:claim-documents/${path}` : null;
}

const routeCache = restRouteCache({ supabaseUrl, serviceKey });
const routeProvider = orsKey ? orsProvider({ apiKey: orsKey }) : null;

let configCache: { at: number; v: Record<string, unknown> } | null = null;
async function botConfig() {
  if (configCache && Date.now() - configCache.at < 60_000) return configCache.v;
  const keys = [
    "ai_customer_model",
    "ai_escalation_model",
    "ai_transcription_model",
    "ai_turn_max_calls",
    "ai_turn_max_ms",
    "ai_low_confidence_handoff",
    "ai_free_text_enabled",
    "ai_voice_enabled",
    "ai_merchant_text_enabled",
    "ai_merchant_model",
  ];
  const vals = await Promise.all(keys.map((k) => rpc("config_value", { p_key: k })));
  const v = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  configCache = { at: Date.now(), v };
  return v;
}

const log = (msg: string, fields?: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify({ fn: "dispatch", msg, ...fields }));

// Every request has a deadline; a stalled read or idempotent write is retried once (rest-rpc.ts, #139).
const rpc = restRpc({ url: supabaseUrl, key: serviceKey, log });

async function whatsapp(
  phoneNumberId: string,
  payload: Record<string, unknown>,
): Promise<SendResult> {
  // Simulator numbers (+999, DECISIONS §36): recorded, never sent; refused when the sink is off (_shared/sim-sink.ts).
  if (isSimNumber(payload.to)) return simSinkSend(rpc, phoneNumberId, payload);
  if (!kapsoKey) return { ok: false, retry: false, error: "KAPSO_API_KEY not set" };
  try {
    const res = await fetch(`${KAPSO_BASE}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { "X-API-Key": kapsoKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
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

// ---- Visual order card (§32.5) ------------------------------------------------------------------------
// The SVG from order-card-image.ts is rendered with resvg (WebAssembly, pinned) and the bundled Noto fonts
// (supabase/functions/_shared/fonts, OFL), then uploaded to WhatsApp media through Kapso; the message
// carries the media id, so no order data sits behind a public URL.
// The npm file of @resvg/resvg-wasm 2.6.2 served by jsDelivr, checked against its SHA-256 before use.
const RESVG_WASM = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const RESVG_WASM_SHA256 = "22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70";
const CARD_FONTS = [
  "NotoNaskhArabic-Regular",
  "NotoNaskhArabic-Bold",
  "NotoSans-Regular",
  "NotoSans-Bold",
];
let cardRenderer: Promise<Uint8Array[]> | null = null;
function cardFonts(): Promise<Uint8Array[]> {
  cardRenderer ??= (async () => {
    const res = await fetch(RESVG_WASM, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`resvg wasm ${res.status}`);
    const wasm = new Uint8Array(await res.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", wasm)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== RESVG_WASM_SHA256) throw new Error("resvg wasm checksum mismatch");
    await initWasm(wasm);
    return Promise.all(
      CARD_FONTS.map((f) => Deno.readFile(new URL(`../_shared/fonts/${f}.ttf`, import.meta.url))),
    );
  })().catch((e) => {
    cardRenderer = null;
    throw e;
  });
  return cardRenderer;
}
async function orderCard(phoneNumberId: string, svg: string): Promise<string | null> {
  if (!kapsoKey) return null;
  const fontBuffers = await cardFonts();
  const png = new Resvg(svg, {
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Noto Sans" },
  })
    .render()
    .asPng();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/png");
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "order.png");
  const res = await fetch(`${KAPSO_BASE}/${encodeURIComponent(phoneNumberId)}/media`, {
    method: "POST",
    headers: { "X-API-Key": kapsoKey },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && typeof body?.id === "string" ? body.id : null;
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
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { ok: false, retry: true, error: "telegram: no answer" };
  await res.body?.cancel();
  return res.ok
    ? { ok: true }
    : { ok: false, retry: res.status >= 500, error: `telegram ${res.status}` };
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time equality on SHA-256 digests (lengths never leak). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let k = 0; k < x.length; k++) diff |= x[k] ^ y[k];
  return diff === 0;
}

async function authorised(req: Request): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && serviceKey && (await sameSecret(bearer, serviceKey))) return true;
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
    // A replayed or late keypress changes nothing once the order has left "placed".
    const card = await rpc("order_call_card", { p_order_id: order });
    if (card?.status !== "placed")
      return xml(sayTwiml("هالطلب انعالج من قبل. التفاصيل على واتساب."));
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
    return xml(gatherTwiml(callScript(card), signedUrl));
  } catch (e) {
    log("twilio keypress failed", { error: String(e).slice(0, 200) });
    return xml(sayTwiml("صار في مشكلة. شوف الطلب على واتساب."));
  }
}

Deno.serve(async (req) => {
  // An edge function lives at most 150 s (wall clock); a turn's lease ends just after (#139).
  const workerDeadline = new Date(Date.now() + 152_000);
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
      // Claim codes to landlines (§18.1 B): the same voice provider, saying the code twice.
      storeDocument,
      orderCard,
      menuModel: anthropic ? menuModel : null,
      fetchLink: (url: string) =>
        safeFetch(url, {
          maxBytes: 5_000_000,
          resolve: async (host) => {
            const [a, aaaa] = await Promise.all([
              Deno.resolveDns(host, "A").catch(() => [] as string[]),
              Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
            ]);
            return [...a, ...aaaa];
          },
        }),
      // The copilot's model reads what the merchant rules do not, once its eval passes (§32.4, §39.7).
      merchantCopilot: await (async () => {
        const cfg = await botConfig();
        return anthropic && cfg.ai_merchant_text_enabled === true
          ? { call: callModel, model: String(cfg.ai_merchant_model ?? "claude-haiku-4-5-20251001") }
          : null;
      })(),
      fetchMenuMedia: (phoneNumberId: string, x: { id: string; url: string | null }) =>
        fetchMedia(x, phoneNumberId, 5_000_000),
      voiceCode: twilio ? (to, script) => placeCall(twilio, to, sayTwiml(script)) : null,
      telegram: telegramToken && telegramChat ? telegram : null,
      adminUrl: env("ADMIN_BASE_URL"),
      log,
      budgetMs: 20_000,
      workerDeadline,
      customer: await (async () => {
        const cfg = await botConfig();
        const sender = (await rpc("whatsapp_sender", { p_audience: "customer" })) ?? "";
        return {
          model: anthropic ? callModel : null,
          transcribe: openaiKey ? transcribe : null,
          fetchMedia: (m: { url?: string | null; id?: string | null }) =>
            fetchMedia(m, sender, 5_000_000),
          route: async (o: { lat: number; lon: number }, d: { lat: number; lon: number }) =>
            (
              await roadRoutes(o, [d], {
                cache: routeCache,
                provider: routeProvider,
                log: (msg, f) => log(msg, f as Record<string, string>),
              })
            )[0],
          config: {
            customerModel: String(cfg.ai_customer_model ?? "claude-haiku-4-5-20251001"),
            escalationModel: String(cfg.ai_escalation_model ?? "claude-sonnet-5-5"),
            transcriptionModel: String(cfg.ai_transcription_model ?? "gpt-4o-transcribe"),
            maxCalls: Number(cfg.ai_turn_max_calls ?? 2),
            turnMs: Number(cfg.ai_turn_max_ms ?? 8000),
            lowConfidenceHandoff: Number(cfg.ai_low_confidence_handoff ?? 2),
            voiceMaxBytes: 5_000_000,
            // Off until the evals pass (DECISIONS §32.4); a missing row counts as off.
            freeText: cfg.ai_free_text_enabled === true,
            voice: cfg.ai_voice_enabled === true,
            joinFunctionUrl: supabaseUrl
              ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/site-claim`
              : null,
          },
        };
      })(),
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
