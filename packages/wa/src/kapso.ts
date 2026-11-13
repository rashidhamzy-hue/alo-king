// Kapso webhook contract (payload v2) and the thin send client.
// Source of truth: https://docs.kapso.ai/docs/platform/webhooks/message-events
import { z } from "zod";

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

export const buttons = (body: string, items: { id: string; title: string }[]): Outbound => ({
  type: "interactive",
  interactive: { type: "button", body: { text: body },
    action: { buttons: items.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
});

export const list = (body: string, button: string, rows: { id: string; title: string; description?: string }[]): Outbound => ({
  type: "interactive",
  interactive: { type: "list", body: { text: body },
    action: { button: button.slice(0, 20), sections: [{ title: "Options", rows: rows.slice(0, 10).map((r) => ({ ...r, title: r.title.slice(0, 24) })) }] } },
});

export const askLocation = (body: string): Outbound => ({
  type: "interactive",
  interactive: { type: "location_request_message", body: { text: body }, action: { name: "send_location" } },
});

export async function kapsoSend(env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string }, phoneNumberId: string, to: string, msg: Outbound): Promise<string> {
  const res = await fetch(`${env.KAPSO_BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "X-API-Key": env.KAPSO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...msg }),
  });
  if (!res.ok) throw new Error(`KAPSO_SEND_${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { messages?: { id: string }[] };
  return json.messages?.[0]?.id ?? "";
}
