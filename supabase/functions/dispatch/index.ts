// dispatch: merchant taps and commands, the outbox and ops alerts (DECISIONS §4, §13, §23, §30.3.5).
// Invoked by pg_cron through pg_net every 5 seconds when there is work (header x-dispatch-secret, checked
// with dispatch_secret_ok), and by whatsapp-webhook right after an intake (service-role bearer). Twilio
// posts call keypresses to ?route=twilio, checked by Twilio's signature. verify_jwt is off
// (supabase/config.toml): these checks are the authentication.
//
// Function secrets, synced by the deploy job from the GitHub secrets of the same name: KAPSO_API_KEY;
// optional SLACK_BOT_TOKEN (ops alerts and the console, §32.1), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM (voice layer), SENTRY_DSN (from SENTRY_DSN_FUNCTIONS); ADMIN_BASE_URL once the site exists.
// Customer bot (session 4): ANTHROPIC_API_KEY (turns), OPENAI_API_KEY (voice transcription only, §3),
// ORS_API_KEY (road routes for the delivery quote). Without a key that part is off, never faked.
// Meta catalogue (§39.12): optional META_CATALOG_TOKEN when Kapso's proxy cannot write catalogue items. GET
// ?route=catalog-image is public (Meta fetches product images) and redirects to the photo of an item that is in the catalogue (404 otherwise).

import {
  runDispatch,
  type KapsoBroadcast,
  type MenuModelCall,
  type SendResult,
} from "./handler.ts";
import {
  callScript,
  gatherTwiml,
  placeCall,
  sayTwiml,
  verifyTwilio,
  type TwilioConfig,
} from "../_shared/twilio.ts";
import { reportError } from "../_shared/sentry.ts";
import { slackPoster } from "../_shared/ops-notifier.ts";
import { restRpc } from "../_shared/rest-rpc.ts";
import { isSimNumber, simSinkSend } from "../_shared/sim-sink.ts";
import {
  chooseLiveProvider,
  fixtureProvider,
  orsProvider,
  restFixtureLookup,
  restRouteCache,
  roadRoutes,
  type LatLon,
  type RouteProvider,
} from "../_shared/routing.ts";
import { safeFetch } from "../_shared/safe-fetch.ts";
import type { ModelRequest, ModelResponse, Transcript } from "./customer/turn.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import type { CatalogApi, CatalogTransport } from "./catalog-sync.ts";
import { productHash, withContent, type DesiredProduct } from "../_shared/catalog.ts";
import { desiredCache } from "./desired-cache.ts";

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

/**
 * The smart-menu model (§18.3): config `ai_menu_model` (chosen by the handler, which reserves the call against the daily
 * AI budget first), one call per photo or PDF, JSON text back with the real usage.
 */
const menuModelCall: MenuModelCall = async (req) => {
  const msg = await anthropic!.messages.create(
    {
      model: req.model,
      max_tokens: 8000,
      system: req.system,
      messages: [{ role: "user", content: req.content as Anthropic.MessageParam["content"] }],
    },
    { timeout: 60_000 },
  );
  return {
    text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
  };
};

// ---- Broadcasts (§39.8): Kapso's broadcast API, reference gokapso/whatsapp-broadcasts-example ---------------------------
const KAPSO_PLATFORM = "https://api.kapso.ai/platform/v1/whatsapp";
async function kapsoPlatform(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${KAPSO_PLATFORM}${path}`, {
    method: "POST",
    headers: { "X-API-Key": kapsoKey!, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`kapso ${res.status} ${JSON.stringify(j?.error ?? {}).slice(0, 160)}`);
  return j;
}
const kapsoBroadcast: KapsoBroadcast | null = kapsoKey
  ? {
      create: async (name, phoneNumberId, templateId) => {
        const j = await kapsoPlatform("/broadcasts", {
          whatsapp_broadcast: {
            name,
            phone_number_id: phoneNumberId,
            whatsapp_template_id: templateId,
          },
        });
        const id = j?.data?.id;
        if (typeof id !== "string") throw new Error("kapso broadcast: no id");
        return id;
      },
      addRecipients: async (id, recipients) => {
        await kapsoPlatform(`/broadcasts/${encodeURIComponent(id)}/recipients`, {
          whatsapp_broadcast: { recipients },
        });
      },
      send: async (id) => {
        await kapsoPlatform(`/broadcasts/${encodeURIComponent(id)}/send`);
      },
    }
  : null;

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
const routeFixtures = fixtureProvider(restFixtureLookup({ supabaseUrl, serviceKey }));
/**
 * The provider for one checkout's live call (DECISIONS §39.15.1): a simulator number (+999) reads recorded routes
 * (config routing_provider_sim = fixture), a real phone reaches OpenRouteService with a short timeout and only when the
 * server's daily budget allows (routing_take). Without an ORS key: none, the quote keeps the shop → place distance.
 */
async function liveRouteProvider(
  phone: string | undefined,
  force: boolean,
): Promise<RouteProvider | null> {
  const cfg = await botConfig();
  return chooseLiveProvider({
    isSim: isSimNumber(phone),
    simMode: cfg.routing_provider_sim,
    ors: orsKey
      ? orsProvider({ apiKey: orsKey, timeoutMs: Number(cfg.route_live_timeout_ms ?? 2000) })
      : null,
    fixtures: routeFixtures,
    take: async (o: LatLon, d: LatLon) => {
      const t = await rpc("routing_take", {
        p_purpose: "checkout",
        p_origin_lat: o.lat,
        p_origin_lon: o.lon,
        p_dest_lat: d.lat,
        p_dest_lon: d.lon,
        p_force: force,
      }).catch(() => null);
      if (!t?.ok) log("routing not called", { reason: String(t?.reason ?? "rpc failed") });
      return t?.ok === true;
    },
  });
}

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
    "browse_categories_min_shops",
    "browse_first_section_items",
    "route_live_timeout_ms",
    "routing_provider_sim",
    "browse_min_catalog_items",
    "public_site_url",
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

// ---- Meta catalogue (§39.12) -------------------------------------------------------------------------------
// Items are written through Kapso's Meta proxy or, when kapso-catalog found that route closed, the Graph API with the
// META_CATALOG_TOKEN function secret (synced by the deploy job). Kapso only at https://api.kapso.ai.
const metaCatalogToken = env("META_CATALOG_TOKEN");
const GRAPH = "https://graph.facebook.com/v24.0";
async function catalogPost(
  transport: CatalogTransport,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const url = transport === "graph" ? `${GRAPH}${path}` : `${KAPSO_BASE}${path}`;
  const headers: Record<string, string> =
    transport === "graph"
      ? { authorization: `Bearer ${metaCatalogToken ?? ""}`, "content-type": "application/json" }
      : { "X-API-Key": kapsoKey ?? "", "content-type": "application/json" };
  if (transport === "graph" ? !metaCatalogToken : !kapsoKey)
    return { ok: false, status: 0, body: { error: `no credentials for the ${transport} route` } };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
/** GET through the same route as catalogPost (Graph with META_CATALOG_TOKEN, or Kapso's Meta proxy). */
async function catalogGet(
  transport: CatalogTransport,
  path: string,
): Promise<{ ok: boolean; status: number; body: any }> {
  const url = transport === "graph" ? `${GRAPH}${path}` : `${KAPSO_BASE}${path}`;
  const headers: Record<string, string> =
    transport === "graph"
      ? { authorization: `Bearer ${metaCatalogToken ?? ""}` }
      : { "X-API-Key": kapsoKey ?? "" };
  if (transport === "graph" ? !metaCatalogToken : !kapsoKey)
    return { ok: false, status: 0, body: { error: `no credentials for the ${transport} route` } };
  const res = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
// What Meta says about each product (§39.15.2). `errors` is asked for; if Meta refuses the field, the call is made once
// without it so the review status still arrives.
const STATUS_FIELDS = ["retailer_id", "review_status", "visibility", "availability", "errors"];
const catalogApi: CatalogApi = {
  batch: async (catalogId, transport, requests) => {
    const r = await catalogPost(transport, `/${encodeURIComponent(catalogId)}/items_batch`, {
      allow_upsert: true,
      item_type: "PRODUCT_ITEM",
      requests,
    });
    if (!r.ok)
      return {
        ok: false,
        error: `meta ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`,
      };
    // Per-item problems come back in validation_status: those items are recorded as not shown and sent again later.
    const refused: string[] = [];
    for (const v of r.body?.validation_status ?? [])
      if (v?.errors?.length && v?.retailer_id) {
        refused.push(String(v.retailer_id));
        if (refused.length <= 5)
          log("catalogue item refused", {
            item: String(v.retailer_id),
            error: JSON.stringify(v.errors).slice(0, 160),
          });
      }
    return { ok: true, refused };
  },
  productSet: async (catalogId, transport, body) => {
    const r = await catalogPost(transport, `/${encodeURIComponent(catalogId)}/product_sets`, body);
    if (r.ok && /^[0-9]{5,30}$/.test(String(r.body?.id ?? ""))) return String(r.body.id);
    // Meta's reason, never headers or tokens (the first sync on staging was refused without a word).
    const e = r.body?.error ?? r.body;
    log("catalogue product set refused", {
      status: r.status ?? 0,
      error: String(e?.error_user_msg ?? e?.message ?? JSON.stringify(e ?? {})).slice(0, 200),
      code: String(e?.code ?? ""),
    });
    return null;
  },
  status: async (catalogId, transport, q) => {
    const read = async (fields: string[]) => {
      const params = new URLSearchParams({
        fields: fields.join(","),
        limit: String(Math.min(Math.max(q.limit ?? 100, 1), 500)),
      });
      if (q.after) params.set("after", q.after);
      if (q.ids?.length) params.set("filter", JSON.stringify({ retailer_id: { is_any: q.ids } }));
      return catalogGet(transport, `/${encodeURIComponent(catalogId)}/products?${params}`);
    };
    let r = await read(STATUS_FIELDS);
    if (!r.ok && /errors/.test(JSON.stringify(r.body?.error ?? "")))
      r = await read(STATUS_FIELDS.filter((f) => f !== "errors"));
    if (!r.ok)
      return {
        ok: false,
        error: `meta ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`,
      };
    const rows = (Array.isArray(r.body?.data) ? r.body.data : []).filter(
      (x: any) => typeof x?.retailer_id === "string",
    );
    // A next page exists only when Meta gives a `next` link; the cursor alone is also present on the last page.
    const next = r.body?.paging?.next ? (r.body?.paging?.cursors?.after ?? null) : null;
    return { ok: true, rows, next };
  },
  imageUrl: (itemId, hash) =>
    `${supabaseUrl}/functions/v1/dispatch?route=catalog-image&i=${encodeURIComponent(itemId)}&v=${encodeURIComponent(hash)}`,
};

// Meta's crawl fetches a shop's images by the hundred before the sync records their hashes; each one used to compute the
// shop's whole desired catalogue and starved staging (LOG 2026-10-15). One computation per shop serves them all.
const desired = desiredCache<DesiredProduct>(
  async (vendorId) =>
    (
      ((await rpc("catalog_desired", { p_vendor_id: vendorId })) as DesiredProduct[] | null) ?? []
    ).map(withContent),
  productHash,
  {
    onError: (vendor, e) =>
      log("catalogue desired load failed", { vendor, error: String(e).slice(0, 200) }),
  },
);

/** A one-hour link to a photo in the private bucket menu-item-photos (an item's photo, a shop's cover); null on failure. */
async function photoUrl(path: string): Promise<string | null> {
  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/menu-item-photos/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 3600 }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const signed = res?.ok ? (await res.json().catch(() => ({})))?.signedURL : null;
  return typeof signed === "string"
    ? `${supabaseUrl}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`
    : null;
}

/**
 * GET ?route=catalog-image&i=<item>: the product image Meta fetches, a short-lived signed redirect to the item's own photo.
 * Only items in the catalogue are served (catalog_image answers nothing for any other id).
 */
async function catalogImage(url: URL): Promise<Response> {
  const id = url.searchParams.get("i") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("not found", { status: 404 });
  const d = await rpc("catalog_image", { p_item_id: id }).catch(() => null);
  // Only the version Meta was given is served (no other cache-buster): the hash recorded for the item, or
  // the one being sent right now (Meta may fetch the image before the sync records its new hash).
  if (!d) return new Response("not found", { status: 404 });
  const v = url.searchParams.get("v") ?? "";
  if (String(d.hash ?? "") !== v) {
    // Only a well-formed content hash is worth checking against the shop's desired catalogue (#183 review).
    if (!/^[0-9a-f]{8}$/.test(v)) return new Response("not found", { status: 404 });
    if (!(await desired.has(String(d.vendor_id), id, v)))
      return new Response("not found", { status: 404 });
  }
  // The item's own photo (menu_item_photos, DECISIONS §39.12, §39.13): never a shop or Google place photo, and nothing
  // drawn any more; the catalogue holds only items that have one.
  const signed = typeof d.photo === "string" && d.photo ? await photoUrl(d.photo) : null;
  return signed ? Response.redirect(signed, 302) : new Response("not found", { status: 404 });
}

// Ops alerts and the console go to Slack (§32.1): SLACK_BOT_TOKEN, synced by the deploy job once the owner installs the app.
const slackToken = env("SLACK_BOT_TOKEN");

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
  if (req.method === "GET" && url.searchParams.get("route") === "catalog-image") {
    try {
      return await catalogImage(url);
    } catch (e) {
      log("catalogue image failed", { error: String(e).slice(0, 160) });
      return new Response("unavailable", { status: 503 });
    }
  }
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
      menuModelCall: anthropic ? menuModelCall : null,
      kapsoBroadcast,
      fetchLink: (url: string) =>
        safeFetch(url, {
          maxBytes: 5_000_000,
          resolve: async (host) => {
            const [a, aaaa] = await Promise.all([
              Deno.resolveDns(host, "A").catch(() => [] as string[]),
              Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
            ]);
            if (!a.length && !aaaa.length) log("menu link: no DNS answer", { host });
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
      slack: slackToken ? slackPoster(slackToken) : null,
      catalog: catalogApi,
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
          photoUrl,
          route: async (
            o: { lat: number; lon: number },
            d: { lat: number; lon: number },
            opts?: { phone?: string; force?: boolean },
          ) =>
            (
              await roadRoutes(o, [d], {
                cache: routeCache,
                provider: await liveRouteProvider(opts?.phone, opts?.force === true),
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
            browseMinShops: Number(cfg.browse_categories_min_shops ?? 4),
            firstSectionItems: Number(cfg.browse_first_section_items ?? 6),
            browseMinCatalogItems: Number(cfg.browse_min_catalog_items ?? 6),
            // The public site (config public_site_url, §39.15.7); null until it has an address.
            siteUrl:
              typeof cfg.public_site_url === "string" &&
              /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/.test(cfg.public_site_url)
                ? cfg.public_site_url.replace(/\/+$/, "")
                : null,
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
