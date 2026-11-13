// The Compliance Gateway. Nothing else in the codebase may call kapsoSend.
// It refuses anything that could get a number restricted, and it keeps the message bill predictable.
import type { SupabaseClient } from "@supabase/supabase-js";
import { kapsoSend, KapsoSendError, type Line, type Outbound } from "./kapso";

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
const withTimeout = <T>(p: PromiseLike<T>, ms: number): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export function preflight(req: SendRequest): string | null {
  const type = (req.msg as { type: string }).type;
  if (!ALLOWED_TYPES.has(type)) return "type_not_allowed";            // no audio, ever: no AI voice notes
  if (req.category === "marketing" && PILOT_MARKETING_LOCK) return "marketing_locked_pilot";
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
    throw err;
  }
  // The message is out. From here nothing may throw: a throw would make the turn retry and, once the lease expires, send it twice.
  if (req.dedupeKey) {
    let marked = false;
    for (let i = 0; i < 3 && !marked; i++) {
      try { const m = await db.rpc("outbox_mark", { p_key: req.dedupeKey, p_wamid: wamid, p_error: null }); marked = !m.error; } catch { /* retry */ }
    }
    if (!marked) console.error(JSON.stringify({ level: "error", event: "outbox_mark_failed_after_send", key: req.dedupeKey, wamid }));
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
