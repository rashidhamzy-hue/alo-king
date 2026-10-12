// Builds Kapso-shaped webhook deliveries (the v2 payload whatsapp-webhook and dispatch read) and signs them with
// the webhook's HMAC-SHA256, exactly as Kapso does. Nothing here talks to Kapso.
import { createHmac, randomUUID } from "node:crypto";

export type Inbound =
  | { type: "text"; text: string }
  | { type: "button"; id: string; title: string }
  | { type: "list"; id: string; title: string }
  | { type: "location"; lat: number; lon: number; name?: string }
  | { type: "voice"; transcript: string };

export function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** E.164 with a leading plus -> the digits WhatsApp puts in `from`. */
const digits = (phone: string) => phone.replace(/^\+/, "");

export function inboundPayload(opts: {
  phone: string;
  phoneNumberId: string;
  name?: string;
  message: Inbound;
  now?: Date;
}): Record<string, unknown> {
  const { phone, phoneNumberId, message: m } = opts;
  const id = `wamid.SIM${randomUUID().replace(/-/g, "")}`;
  const base: Record<string, unknown> = {
    id,
    from: digits(phone),
    timestamp: String(Math.floor((opts.now ?? new Date()).getTime() / 1000)),
    kapso: { direction: "inbound", origin: "cloud_api", has_media: false },
  };
  let message: Record<string, unknown>;
  switch (m.type) {
    case "text":
      message = { ...base, type: "text", text: { body: m.text } };
      break;
    case "button":
      message = {
        ...base,
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: m.id, title: m.title } },
      };
      break;
    case "list":
      message = {
        ...base,
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: m.id, title: m.title } },
      };
      break;
    case "location":
      message = {
        ...base,
        type: "location",
        location: { latitude: m.lat, longitude: m.lon, ...(m.name ? { name: m.name } : {}) },
      };
      break;
    case "voice":
      message = {
        ...base,
        type: "audio",
        audio: { id: `sim-audio-${id}`, mime_type: "audio/ogg; codecs=opus", voice: true },
        kapso: {
          direction: "inbound",
          origin: "cloud_api",
          has_media: true,
          // The stub carries Kapso's own transcript; the media URL does not exist, so only the transcript path runs.
          media_url: null,
          transcript: { text: m.transcript },
        },
      };
      break;
  }
  return {
    message,
    conversation: {
      id: `sim-conv-${digits(phone)}`,
      phone_number: phone,
      phone_number_id: phoneNumberId,
      contact_name: opts.name ?? null,
    },
    is_new_conversation: false,
    phone_number_id: phoneNumberId,
  };
}

/** Posts one signed delivery. Resolves with the HTTP status and a short body; the secret is never logged. */
export async function deliver(
  url: string,
  secret: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: string }> {
  const body = JSON.stringify(payload);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": sign(secret, body),
      "x-webhook-event": "whatsapp.message.received",
      "x-idempotency-key": randomUUID(),
    },
    body,
  });
  return { status: res.status, body: (await res.text()).slice(0, 300) };
}
