// The Compliance Gateway. Nothing else in the codebase may call kapsoSend.
// It refuses anything that could get a number restricted, and it keeps the message bill predictable.
import type { SupabaseClient } from "@supabase/supabase-js";
import { kapsoSend, KapsoSendError, type Line, type Outbound } from "./kapso";
import * as Sentry from "@sentry/cloudflare";
import { checkModelText } from "@ak/agents/output-guard";

export type Category = "service" | "utility" | "marketing";
export interface SendRequest {
  line: Line;
  partyId: string;
  to: string;                 // phone or BSUID, as Kapso accepts it
  msg: Outbound;
  category: Category;
  orderId?: string;
  campaignId?: string;        // required for marketing; the campaign must be approved by a human
  /** Required. Stable for the thing being said: (turn, message index) for replies, (event, time bucket) for cron
   *  reminders. A retry finds the message already sent and does not send it twice. No key, no send. */
  dedupeKey: string;
  /** Set by the tools that send text the model wrote. The gateway checks it again (B2's 1.5 and 1.10 guard, second lock).
   *  approvedFacts: food-fact attributes a tool returned an approved record for in this turn. */
  /** The tool results behind the words (B1a): a search ran this turn, the basket was changed this turn. */
  /** PD1 (e): the names returned this turn, the customer's words, the approved records by product and whether the catalogue is connected. */
  authored?: { by: "model"; approvedFacts?: string[]; catalogueSearched?: boolean; basketChanged?: boolean;
               products?: { id: string; names: string[] }[]; customerWords?: string; approvedByProduct?: Record<string, string[]>; catalogueReady?: boolean };
}
export type SendResult = { ok: true; wamid: string } | { ok: false; refused: string };

const ALLOWED_TYPES = new Set(["text", "interactive", "template", "location"]);

/** Pilot lock, in code. Promotional sends are refused here before the database is even asked.
 *  Lifting it takes a reviewed code change AND a reviewed migration (0012 holds the database half). */
export const PILOT_MARKETING_LOCK = true;
const CLAIM_TIMEOUT_MS = 5000;

/** The outbox could not confirm that this message is ours to send. Nothing was sent; the turn retries. */
export class OutboxUnavailable extends Error {
  constructor(why: string) { super(`OUTBOX_UNAVAILABLE ${why}`); this.name = "OutboxUnavailable"; }
}
/** Kapso did not take the message this time, for a reason that can pass. Nothing was sent; the outbox row is marked failed, so the retry may send. */
export class SendNotDelivered extends OutboxUnavailable {
  constructor(readonly cause: unknown) { super(`send not delivered: ${String(cause).slice(0, 200)}`); }
}
const withTimeout = <T>(p: PromiseLike<T>, ms: number): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export function preflight(req: SendRequest): string | null {
  const type = (req.msg as { type: string }).type;
  if (!ALLOWED_TYPES.has(type)) return "type_not_allowed";            // no audio, ever: no AI voice notes
  if (req.category === "marketing" && PILOT_MARKETING_LOCK) return "marketing_locked_pilot";
  if (req.authored?.by === "model") {
    const m = req.msg as { text?: { body?: string }; interactive?: { body?: { text?: string } } };
    const a = req.authored;
    const v = checkModelText(m.text?.body ?? m.interactive?.body?.text ?? "", { approvedFacts: new Set(a.approvedFacts ?? []),
      catalogueSearched: !!a.catalogueSearched, basketChanged: !!a.basketChanged, products: a.products ?? [], customerWords: a.customerWords ?? "",
      ...(a.approvedByProduct ? { approvedByProduct: new Map(Object.entries(a.approvedByProduct).map(([k, x]) => [k, new Set(x)])) } : {}),
      ...(a.catalogueReady !== undefined ? { catalogueReady: a.catalogueReady } : {}) });
    if (v) return `model_text_${v.code}`;
  }
  if (typeof req.dedupeKey !== "string" || req.dedupeKey.length < 3) return "missing_dedupe_key";   // every send goes through the outbox claim
  if (type === "location" && req.line !== "ops") return "location_ops_only";
  if (req.category === "marketing" && type !== "template") return "marketing_needs_template";
  if (req.category === "marketing" && !req.campaignId) return "marketing_needs_approved_campaign";
  if (req.msg.type === "text" && req.msg.text.body.length > 4096) return "text_too_long";
  if (req.msg.type === "interactive") {
    const body = (req.msg.interactive as { body?: { text?: string } }).body?.text ?? "";
    if (body.length > 1024) return "interactive_body_too_long";
  }
  return null;
}

export async function send(
  db: SupabaseClient,
  env: { KAPSO_BASE_URL: string; KAPSO_API_KEY: string; PHONE_NUMBER_ID_CUSTOMER: string; PHONE_NUMBER_ID_OPS: string },
  req: SendRequest,
): Promise<SendResult> {
  const local = preflight(req);
  if (local) return refuse(db, req, local);

  const isTemplate = req.msg.type === "template";
  // M1 (coordinator, 14 Nov): Meta can re-file a template as marketing after we submit it as utility. A template message goes out
  // only when wa_templates holds it as approved AND utility, for its name and language, whatever category the caller passed.
  // Unknown, unreadable, re-filed or not approved: refused, fail closed (invariant 17).
  if (req.msg.type === "template") {
    const t = await db.from("wa_templates").select("category, status, language").eq("name", req.msg.template.name).limit(1);
    if (t.error) return refuse(db, req, "gate_error");
    const row = ((t.data as { category: string; status: string; language: string }[] | null) ?? [])[0];
    if (!row || row.category !== "utility") return refuse(db, req, "template_not_utility");
    if (row.status !== "approved") return refuse(db, req, "template_not_approved");
    if (row.language !== req.msg.template.language.code) return refuse(db, req, "template_language_mismatch");
  }
  const gate = await db.rpc("can_send", { p_party: req.partyId, p_line: req.line, p_category: req.category, p_is_template: isTemplate });
  if (gate.error) return refuse(db, req, "gate_error");
  // A staging probe party (0063): everything below runs (outbox claim, mark, log) except the hand-off to Kapso.
  const sink = gate.data === "probe_sink";
  if (gate.data !== "ok" && !sink) return refuse(db, req, String(gate.data));

  if (req.category === "marketing") {
    const c = await db.from("campaigns").select("status, approved_by").eq("id", req.campaignId!).single();
    if (c.error || c.data.status !== "sending" || !c.data.approved_by) return refuse(db, req, "campaign_not_approved");
  }

  {
    // Fail closed. Only an explicit `true` from the database lets this message out.
    // An error, a timeout or any other answer means we do not know whether it was already sent, so we do not send.
    let claim: { data: unknown; error: unknown };
    try {
      claim = await withTimeout(db.rpc("outbox_claim", { p_key: req.dedupeKey, p_line: req.line, p_party: req.partyId, p_payload: req.msg }), CLAIM_TIMEOUT_MS);
    } catch (err) { throw new OutboxUnavailable(String(err).slice(0, 200)); }
    if (claim.error) throw new OutboxUnavailable(JSON.stringify(claim.error).slice(0, 200));
    if (claim.data === false) return { ok: true, wamid: "already_sent" };
    if (claim.data !== true) throw new OutboxUnavailable("unexpected_claim_result");
  }
  const phoneNumberId = req.line === "customer" ? env.PHONE_NUMBER_ID_CUSTOMER : env.PHONE_NUMBER_ID_OPS;
  let wamid: string;
  try { wamid = sink ? `sink:${req.dedupeKey}` : await kapsoSend(env, phoneNumberId, req.to, req.msg); }
  catch (err) {
    if (req.dedupeKey) await db.rpc("outbox_mark", { p_key: req.dedupeKey, p_wamid: null, p_error: String(err).slice(0, 300) });
    // This message can never go out as it is (Meta's code says so). Retrying the turn would fail the same way, three times,
    // and then hand a working conversation to a person. Record it and let the turn carry on (4.13).
    if (err instanceof KapsoSendError && err.permanent) return refuse(db, req, `kapso_${err.code}`);
    // Anything else (Kapso 5xx, 429, 402, a network error) means the message did not go out this time. That is the same
    // situation as an unavailable outbox: nothing sent, retry the whole turn. turn.ts already rethrows OutboxUnavailable so the
    // conversation object retries; before this, a passing Kapso error handed a working conversation to a person (found in 4.5).
    throw new SendNotDelivered(err);
  }
  // The message is out. From here nothing may throw: a throw would make the turn retry and, once the lease expires, send it twice.
  if (req.dedupeKey) {
    let marked = false;
    for (let i = 0; i < 3 && !marked; i++) {
      try { const m = await db.rpc("outbox_mark", { p_key: req.dedupeKey, p_wamid: wamid, p_error: null }); marked = !m.error; } catch { /* retry */ }
    }
    if (!marked) {
      console.error(JSON.stringify({ level: "error", event: "outbox_mark_failed_after_send", key: req.dedupeKey, wamid }));
      // G1-18: this message is out, the outbox does not know, and after the lease a retried turn would send it again. Tell a person
      // now. One Sentry issue (the fingerprint), the key and the message id beside it. The status webhook then marks the row sent
      // when it can (record_message_status, 0116); this event is for the cases where it cannot. No phone number, no text.
      try { Sentry.captureMessage("outbox_mark_failed_after_send", { level: "error", tags: { where: "gateway", line: req.line }, extra: { dedupeKey: req.dedupeKey, wamid }, fingerprint: ["outbox_mark_failed_after_send"] }); } catch { /* reporting must never throw here */ }
    }
  }
  try { await db.from("wa_messages").insert({
    line: req.line, direction: "outbound", party_id: req.partyId, wa_message_id: wamid, type: req.msg.type,
    body: req.msg.type === "text" ? req.msg.text.body : JSON.stringify(req.msg), category: req.category,
    template_name: req.msg.type === "template" ? req.msg.template.name : null, status: sink ? "sink" : "sent", order_id: req.orderId ?? null,
  }); } catch (err) { console.error(JSON.stringify({ level: "error", event: "wa_message_log_failed", wamid, err: String(err).slice(0, 200) })); }
  return { ok: true, wamid };
}

async function refuse(db: SupabaseClient, req: SendRequest, reason: string): Promise<SendResult> {
  await db.from("agent_runs").insert({ agent: "compliance_gateway", order_id: req.orderId ?? null, outcome: "refused", trace: { reason, line: req.line, category: req.category } });
  return { ok: false, refused: reason };
}
