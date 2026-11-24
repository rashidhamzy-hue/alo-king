// Kapso webhook contract (payload v2) and the thin send client.
// Source of truth: https://docs.kapso.ai/docs/platform/webhooks/message-events
import { z } from "zod";
import { GraphApiError, WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import { cutChars } from "./contract";

export type Line = "customer" | "ops";

export const KapsoMessage = z.object({
  id: z.string(),                                   // wamid
  timestamp: z.string(),                            // unix epoch, as a string
  type: z.string(),                                 // text | audio | image | location | interactive | ...
  from: z.string().optional(),                      // NOT guaranteed: Meta is moving to BSUIDs
  from_user_id: z.string().nullable().optional(),   // BSUID
  from_parent_user_id: z.string().nullable().optional(),
  username: z.string().nullable().optional(),       // real payloads send null, not an absent key (fixtures, 4.1)
  text: z.object({ body: z.string() }).optional(),
  audio: z.object({ id: z.string() }).passthrough().optional(),
  image: z.object({ id: z.string(), caption: z.string().optional() }).passthrough().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() }).optional(),
  interactive: z.object({
    type: z.string(),                               // button_reply | list_reply
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
  }).passthrough().optional(),
  kapso: z.object({
    direction: z.string(),
    status: z.string().optional(),
    origin: z.string().optional(),                  // cloud_api | business_app | history_sync
    has_media: z.boolean().optional(),
    content: z.string().optional(),
    media_url: z.string().optional(),
    media_data: z.object({ url: z.string(), filename: z.string().optional(), content_type: z.string().optional(), byte_size: z.number().optional() }).optional(),
    transcript: z.object({ text: z.string() }).optional(),   // Kapso's built-in transcription of audio
  }).passthrough(),
}).passthrough();

export const KapsoReceived = z.object({
  message: KapsoMessage,
  conversation: z.object({
    id: z.string(),
    contact_name: z.string().nullable().optional(),
    phone_number: z.string().nullable().optional(), // not guaranteed either
    business_scoped_user_id: z.string().nullable().optional(),
    phone_number_id: z.string().optional(),
  }).passthrough(),
  is_new_conversation: z.boolean().optional(),
  phone_number_id: z.string(),
}).passthrough();
export type KapsoReceived = z.infer<typeof KapsoReceived>;

/** Buffered webhooks wrap events as { batch: true, data: [...] }. Always return an array. */
export function unwrap(body: unknown): unknown[] {
  if (body && typeof body === "object" && (body as { batch?: boolean }).batch === true) {
    return ((body as { data?: unknown[] }).data ?? []);
  }
  return [body];
}

/** Stable identity for a sender: BSUID first, phone second. */
export function senderKey(e: KapsoReceived): { waUserId?: string; phone?: string } {
  const waUserId = e.message.from_user_id || e.conversation.business_scoped_user_id || undefined;
  const phone = e.message.from ?? e.conversation.phone_number ?? undefined;
  return { waUserId: waUserId ?? undefined, phone: phone ? normalisePhone(phone) : undefined };
}

export function normalisePhone(p: string): string {
  const digits = p.replace(/[^\d]/g, "");
  return "+" + digits;
}

/** HMAC-SHA256 of the raw body with the webhook secret, hex, in X-Webhook-Signature. */
export async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = signature.replace(/^sha256=/, "").toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---------- outbound message shapes (Meta Cloud API format, proxied by Kapso) ----------
export type Outbound =
  | { type: "text"; text: { body: string } }
  | { type: "interactive"; interactive: Record<string, unknown> }
  | { type: "template"; template: { name: string; language: { code: string }; components?: unknown[] } }
  | { type: "location"; location: { latitude: number; longitude: number; name?: string; address?: string } };

// CAT2: every builder cuts by characters (never half an emoji) to the limits Kapso's schema states (contract.ts, LIMITS).
export const buttons = (body: string, items: { id: string; title: string }[]): Outbound => ({
  type: "interactive",
  interactive: { type: "button", body: { text: body },
    action: { buttons: items.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: cutChars(b.title, 20) } })) } },
});

export const list = (body: string, button: string, rows: { id: string; title: string; description?: string }[]): Outbound => ({
  type: "interactive",
  interactive: { type: "list", body: { text: body },
    action: { button: cutChars(button, 20), sections: [{ title: "Options", rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: cutChars(r.title, 24),
      ...(r.description ? { description: cutChars(r.description, 72) } : {}) })) }] } },
});

/** CAT2: a button that opens a link (Kapso's cta_url: name "cta_url", parameters display_text and url). */
export const ctaUrl = (body: string, label: string, url: string): Outbound => ({
  type: "interactive",
  interactive: { type: "cta_url", body: { text: body }, action: { name: "cta_url", parameters: { display_text: cutChars(label, 20), url } } },
});

export const askLocation = (body: string): Outbound => ({
  type: "interactive",
  interactive: { type: "location_request_message", body: { text: body }, action: { name: "send_location" } },
});

/**
 * A send Kapso or Meta refused, with the official SDK's retry hint (task 4.13).
 *  - `retry`, `retry_after`, `refresh_token`: something outside this message is wrong for now; the turn retries.
 *  - `do_not_retry`, `fix_and_retry`: this exact message will never go out as it is (outside the 24-hour window,
 *    recipient cannot receive, bad parameter). Retrying the turn would only fail again, so the gateway records it and moves on.
 * HTTP 402 is Kapso's "credits exhausted" and is always treated as retry: the message must go out once credits are added.
 */
export class KapsoSendError extends Error {
  constructor(readonly httpStatus: number, readonly code: string, readonly retry: string, readonly retryAfterMs: number | undefined, detail: string) {
    super(`KAPSO_SEND_${httpStatus}: ${code} ${detail}`.slice(0, 400));
    this.name = "KapsoSendError";
  }
  /** True when retrying the same message cannot succeed. */
  get permanent(): boolean { return this.httpStatus !== 402 && (this.retry === "do_not_retry" || this.retry === "fix_and_retry"); }
}

/** The official Kapso client over our configured base URL ("https://api.kapso.ai/meta/whatsapp/v24.0" is base + Graph version). */
export function kapsoClient(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, fetchImpl: typeof fetch = (...a) => fetch(...a)): WhatsAppClient {
  const m = env.KAPSO_BASE_URL.replace(/\/+$/, "").match(/^(.*)\/(v\d+\.\d+)$/);
  return new WhatsAppClient({ kapsoApiKey: env.KAPSO_API_KEY, baseUrl: m ? m[1] : env.KAPSO_BASE_URL, graphVersion: m ? m[2] : "v24.0", fetch: edgeFetch(fetchImpl) });
}

/**
 * The SDK asks fetch for redirect: "error". Cloudflare's runtime refuses that value outright ("won't be implemented ... use
 * manual"), so on the Worker every send threw before leaving. Found by the workerd end-to-end test (4.5); Node accepts it,
 * which is why the unit tests passed. Same meaning here: no redirect is followed, and a redirect is an error.
 */
export function edgeFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await inner(input, init?.redirect === "error" ? { ...init, redirect: "manual" } : init);
    if (res.status >= 300 && res.status < 400) throw new Error(`KAPSO_REDIRECT_${res.status}: refusing to follow`);
    return res;
  };
}

/** Only packages/wa/src/gateway.ts may call this (invariant 1; CI checks it). The payload is ours, unchanged: the SDK only carries it. */
export async function kapsoSend(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, phoneNumberId: string, to: string, msg: Outbound): Promise<string> {
  try {
    let res = (await kapsoClient(env).messages.sendRaw({ phoneNumberId, payload: { messaging_product: "whatsapp", recipient_type: "individual", to, ...msg } })) as unknown;
    // The SDK parses JSON only when the response says application/json; otherwise it returns the text. Read the id either way:
    // without it, the outbox and the message log lose track of a message that did go out.
    if (typeof res === "string") { try { res = JSON.parse(res); } catch { res = {}; } }
    return (res as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id ?? "";
  } catch (err) {
    if (err instanceof GraphApiError) throw new KapsoSendError(err.httpStatus, String(err.apiCode ?? err.code), err.retry.action, err.retry.retryAfterMs, err.message);
    throw err;
  }
}

/**
 * WhatsApp's typing indicator on the message being answered (1.8; G1-24). It marks that message read and shows "typing" until a
 * reply goes out or about 25 seconds pass. It sends no message, so it is not a second door out; it is still a call to Kapso, so it
 * lives here with the others and nowhere else. The caller never waits on it for anything that matters (turn.ts swallows a failure).
 */
export async function showTyping(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, phoneNumberId: string, messageId: string): Promise<unknown> {
  return kapsoClient(env).messages.markRead({ phoneNumberId, messageId, typingIndicator: { type: "text" } });
}

/** Meta's review status for our templates (APPROVED, PENDING, REJECTED, PAUSED, ...), read through Kapso. Reading only: no message is sent. */
/** Meta's review status and its current category (M1: Meta may re-file a utility template as marketing) for our templates. */
export async function templateStatuses(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, wabaId: string, names: string[]): Promise<{ name: string; status: string; category: string | null }[]> {
  const res = (await kapsoClient(env).templates.list({ businessAccountId: wabaId, limit: 100 })) as { data?: { name?: string; status?: string; category?: string }[] };
  const want = new Set(names);
  return (res.data ?? []).filter((t) => t.name && t.status && want.has(t.name))
    .map((t) => ({ name: t.name!, status: t.status!.toLowerCase(), category: t.category ? t.category.toLowerCase() : null }));
}

/** Kapso's platform API (not the Meta proxy), read-only. Same API key; base is the origin of KAPSO_BASE_URL. */
async function kapsoPlatformGet<T>(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, path: string): Promise<T> {
  const res = await fetch(`${new URL(env.KAPSO_BASE_URL).origin}/platform/v1${path}`, { headers: { "X-API-Key": env.KAPSO_API_KEY } });
  if (!res.ok) throw new Error(`KAPSO_PLATFORM_${res.status} ${path}`);
  return (await res.json()) as T;
}

/** Quality rating and status of our numbers (4.10). Kapso has no webhook for quality changes; this is polled once a day. */
export async function numberHealth(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, ids: string[]): Promise<{ id: string; quality_rating: string | null; status: string | null }[]> {
  const r = await kapsoPlatformGet<{ data?: { phone_number_id?: string; id?: string; quality_rating?: string | null; status?: string | null }[] }>(env, "/whatsapp/phone_numbers?per_page=100");
  return (r.data ?? []).map((n) => ({ id: String(n.phone_number_id ?? n.id), quality_rating: n.quality_rating ?? null, status: n.status ?? null })).filter((n) => ids.includes(n.id));
}

/** Whether Kapso has paused paid messages on the account (credits exhausted and the like). Kapso's API shows no balance figure. */
export async function fundingState(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, wabaId: string): Promise<{ status: string | null; paused: boolean; reasons: string[] }> {
  const r = await kapsoPlatformGet<{ data?: { status?: string; paid_messages?: { paused?: boolean; reasons?: unknown[] } } }>(env, `/whatsapp/accounts/${wabaId}/funding`);
  return { status: r.data?.status ?? null, paused: !!r.data?.paid_messages?.paused, reasons: (r.data?.paid_messages?.reasons ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x))) };
}
