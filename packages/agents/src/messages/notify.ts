// M1 (G1-23): a message that code or staff start, outside the customer's own turn. It goes in the customer's language as a free
// service message; when the 24-hour window has closed (can_send: window_closed_use_template), the same event's approved utility
// template goes instead, under its own stable key. Not approved yet: nothing is sent and the refusal is returned, as before M1.
// The templates are in templates/templates.json and wa_templates (0121); their names follow 0093: ak_<event>[_en|_fr]_v1.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Outbound } from "@ak/wa/kapso";
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import { messages } from "./index";
import type { Lang, Messages } from "./types";

/** The code-started customer events that have a utility template (0121). */
export type TemplateEvent = "shelf_changes" | "substitute_question" | "order_delayed" | "delivery_called_off" | "kept_order_open" | "on_the_way" | "rider_at_door"
  /** FD2: what staff found when they called the place (0250). No template yet: inside the 24-hour window only (a food order is minutes old). */
  | "food_accepted" | "food_item_missing" | "food_closed" | "food_price";

export interface Built {
  /** The free message, inside the 24-hour window. */
  msg: Outbound;
  /** The template's {{1}}, {{2}}, ... in order, in the customer's language. */
  params: string[];
  /** Quick-reply payloads for the template's buttons, in order (the same ids the free message's buttons carry). */
  payloads?: string[];
}

/** template_approved (0121): the template may be sent, approved AND utility (template_sendable). */
interface Reach { to: string | null; lang: Lang; template: string | null; template_approved: boolean; template_status?: string | null; template_category?: string | null }

/**
 * A code-started message that could not go: outside the 24-hour window, and no template that may be sent (none, not approved yet,
 * or filed by Meta as anything but utility). Recorded in agent_runs, reason template_not_utility, so nothing is dropped in silence.
 */
export async function logTemplateSkip(db: SupabaseClient, s: { partyId: string; orderId?: string | null; event: string; template: string | null; status: string | null; category: string | null }): Promise<void> {
  await db.from("agent_runs").insert({ agent: "compliance_gateway", order_id: s.orderId ?? null, outcome: "skipped",
    trace: { reason: "template_not_utility", event: s.event, template: s.template, template_status: s.status, template_category: s.category, party_id: s.partyId } });
}

/** The template message for an event, as Meta takes it: body parameters, then one payload per quick-reply button. */
export function templateMessage(name: string, lang: Lang, b: Pick<Built, "params" | "payloads">): Outbound {
  return { type: "template", template: { name, language: { code: lang }, components: [
    ...(b.params.length ? [{ type: "body", parameters: b.params.map((text) => ({ type: "text", text })) }] : []),
    ...(b.payloads ?? []).map((payload, index) => ({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] })),
  ] } };
}

/**
 * Sends one code-started message to a customer, on the customer line (invariant 9). customer_reach (0121) gives the address, the
 * customer's language (0093's customer_language) and the event's template in that language with its approval. Fail closed: a
 * refusal is returned, never retried here; an outbox failure throws, as every send does.
 */
/**
 * CX1: at most four messages started by code per order (settings.message_budget, claim_order_message, 0143). A message about an order
 * claims its place first; one the customer must act on or must know always goes, anything else only under the budget. A refusal is
 * recorded (agent_runs, reason over_budget), so nothing is dropped in silence. Fail closed: an error claiming means nothing is sent.
 */
export async function claimOrderMessage(db: SupabaseClient, orderId: string, kind: string, key: string, partyId?: string | null): Promise<boolean> {
  const { data, error } = await db.rpc("claim_order_message", { p_order: orderId, p_kind: kind, p_key: key });
  if (error) throw new Error(`claim_order_message: ${error.message}`);
  const c = data as { allowed: boolean; again?: boolean } | null;
  if (c?.allowed) return true;
  if (!c?.again) await db.from("agent_runs").insert({ agent: "compliance_gateway", order_id: orderId, outcome: "skipped",
    trace: { reason: "over_budget", event: kind, key, party_id: partyId ?? null } });
  return false;
}

export async function sendCodeStarted(deps: { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult> }, partyId: string,
                                      event: TemplateEvent, build: (m: Messages, lang: Lang) => Built, dedupeKey: string, orderId?: string): Promise<SendResult> {
  if (orderId && !(await claimOrderMessage(deps.db, orderId, event, dedupeKey, partyId))) return { ok: false, refused: "over_budget" };
  const { data, error } = await deps.db.rpc("customer_reach", { p_party: partyId, p_event: event });
  if (error) throw new Error(`customer_reach: ${error.message}`);
  const reach = data as Reach | null;
  if (!reach?.to) return { ok: false, refused: "no_address" };
  const lang = reach.lang ?? "ar";
  const b = build(messages(lang), lang);
  const r = await deps.send({ line: "customer", partyId, to: reach.to, msg: b.msg, category: "service", orderId, dedupeKey });
  if (r.ok || r.refused !== "window_closed_use_template") return r;
  // Outside the window. A template goes only when it may be sent (approved AND utility); otherwise skipped, and recorded.
  if (!reach.template || !reach.template_approved) {
    await logTemplateSkip(deps.db, { partyId, orderId, event, template: reach.template, status: reach.template_status ?? null, category: reach.template_category ?? null });
    return { ok: false, refused: "template_not_utility" };
  }
  return deps.send({ line: "customer", partyId, to: reach.to, msg: templateMessage(reach.template, lang, b), category: "utility", orderId, dedupeKey: `${dedupeKey}:tpl` });
}
