// Readers for the Kapso webhook events that are not customer messages (task 4.1).
// Each one is checked against test/fixtures/kapso/: real Kapso message objects for statuses, Kapso's documented
// payloads for the contact events (no real one has arrived yet). Pure functions: index.ts applies the result through SQL.
import { z } from "zod";
import { unwrap } from "./kapso";

const Status = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  recipient_user_id: z.string().optional(),
  pricing: z.object({ type: z.string().optional(), category: z.string().optional(), billable: z.boolean().optional(), pricing_model: z.string().optional() }).passthrough().optional(),
  errors: z.array(z.object({ code: z.union([z.number(), z.string()]).optional(), title: z.string().optional() }).passthrough()).optional(),
}).passthrough();

const StatusEvent = z.object({
  message: z.object({ id: z.string(), kapso: z.object({ status: z.string().optional(), statuses: z.array(Status).optional() }).passthrough().optional() }).passthrough(),
}).passthrough();

export interface StatusUpdate {
  wamid: string;
  status: string;                                   // sent | delivered | read | failed
  /** What Meta says it bills for this message. Present on most statuses since 2025; absent on some failures. */
  pricing?: { billable: boolean | null; category: string | null; type: string | null };
  error?: { code: string; title: string | null };
}

/** whatsapp.message.sent / delivered / read / failed. The newest entry in kapso.statuses is the truth; the event name is the fallback. */
export function parseStatusEvent(event: string, item: unknown): StatusUpdate | null {
  const p = StatusEvent.safeParse(item);
  if (!p.success) return null;
  const m = p.data.message;
  const statuses = m.kapso?.statuses ?? [];
  const last = statuses[statuses.length - 1];
  const withPrice = [...statuses].reverse().find((s) => s.pricing);
  const failed = statuses.find((s) => s.status === "failed" && s.errors?.length);
  const status = last?.status ?? m.kapso?.status ?? event.split(".").pop() ?? "unknown";
  return {
    wamid: m.id,
    status,
    pricing: withPrice?.pricing ? { billable: withPrice.pricing.billable ?? null, category: withPrice.pricing.category ?? null, type: withPrice.pricing.type ?? null } : undefined,
    error: failed?.errors?.[0] ? { code: String(failed.errors[0].code ?? "unknown"), title: failed.errors[0].title ?? null } : undefined,
  };
}

const Contact = z.object({
  wa_id: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  business_scoped_user_id: z.string().nullable().optional(),
}).passthrough();

const PreferenceEvent = z.object({
  contact: Contact,
  marketing_preference: z.object({ status: z.string(), sequence: z.number().nullable().optional(), occurred_at: z.string().nullable().optional() }).passthrough(),
}).passthrough();

export interface PreferenceChange { waUserId: string | null; phone: string | null; status: "stopped" | "resumed"; sequence: number | null }

/** whatsapp.contact.marketing_preference_changed. `status` is stopped or resumed; anything else is not a change we act on. */
export function parsePreferenceEvent(item: unknown): PreferenceChange | null {
  const p = PreferenceEvent.safeParse(item);
  if (!p.success) return null;
  const s = p.data.marketing_preference.status.toLowerCase();
  if (s !== "stopped" && s !== "resumed") return null;
  const c = p.data.contact;
  const phone = c.wa_id ?? c.phone_number ?? null;
  return { waUserId: c.business_scoped_user_id ?? null, phone: phone ? "+" + phone.replace(/[^\d]/g, "") : null, status: s, sequence: p.data.marketing_preference.sequence ?? null };
}

const IdentityEvent = z.object({
  contact: Contact,
  previous: z.object({ business_scoped_user_id: z.string().nullable().optional() }).passthrough().nullable().optional(),
}).passthrough();

export interface IdentityChange { newId: string; oldId: string | null; phone: string | null }

/** whatsapp.contact.identity_changed: the contact now has a new business-scoped user id. */
export function parseIdentityEvent(item: unknown): IdentityChange | null {
  const p = IdentityEvent.safeParse(item);
  if (!p.success || !p.data.contact.business_scoped_user_id) return null;
  const phone = p.data.contact.wa_id ?? p.data.contact.phone_number ?? null;
  return { newId: p.data.contact.business_scoped_user_id, oldId: p.data.previous?.business_scoped_user_id ?? null, phone: phone ? "+" + phone.replace(/[^\d]/g, "") : null };
}

/**
 * Is this webhook for the number the route belongs to (G1-15)? Every item of a message event (received, sent, delivered, read,
 * failed) must carry a `phone_number_id`, and it must be `expected`: a payload that says nothing is refused, not waved through.
 * Other events (contact changes) carry no number in Kapso's documented shape: if one does, it must match. Returns the answer
 * to send with the 400, or null when the event may go on. Checks every item of a batch, not only the first.
 */
export function lineProblem(event: string, body: unknown, expected: string): "wrong line" | "no phone_number_id" | null {
  const isMessage = event.startsWith("whatsapp.message.");
  for (const item of unwrap(body)) {
    const id = (item as { phone_number_id?: unknown } | null)?.phone_number_id;
    if (id === undefined || id === null || id === "") { if (isMessage) return "no phone_number_id"; continue; }
    if (String(id) !== expected) return "wrong line";
  }
  return null;
}
