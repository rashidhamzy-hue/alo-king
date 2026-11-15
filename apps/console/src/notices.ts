// D4b: the messages a customer gets when the console does what the ops line used to do (finish a pick, hand a job to a rider, call a
// delivery off). They are the same words, in the customer's language, on the customer line, through the gateway's send (invariants 1,
// 9 and 20): `sendCodeStarted` is packages/agents' own (24-hour window, then the event's approved utility template, otherwise
// nothing is sent and the refusal is returned). The builders below are copies of apps/gateway/src/ops-turn.ts (pickChangeText,
// substitutionQuestion); test/d4b-console.test.ts holds the two to the same output, so a change of wording on one side fails there.
// Nothing here is ever sent to the ops line: a person who uses the console needs no WhatsApp.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons } from "@ak/wa/kapso";
import { messages, productName, usd } from "@ak/agents/messages";
import { sendCodeStarted, type Built, type TemplateEvent } from "@ak/agents/messages/notify";
import type { Deps } from "./app";
import type { Db } from "./db";

export interface PickChanges { short_code: string; total_usd: number; fx_rate_lbp: number | null; payment_method: string;
  removed: { name: string; qty: number; line_total_usd: number }[]; substituted?: { name: string; by: string; qty: number; line_total_usd: number }[]; credit_usd: number }
export interface Offer { offer_id: string; order_id: string; short_code: string; customer_id: string; missing_name: string; substitute_name: string;
  missing_name_ar?: string | null; substitute_name_ar?: string | null; qty: number; replaced_total_usd: number; line_total_usd: number; diff_usd: number; answer_min: number }

/** What the customer hears when the shelf changed their order: what came off, what was swapped, the new total, any credit. Null: nothing changed. */
export function pickChangeNotice(c: PickChanges, lang?: string | null): Built | null {
  const m = messages(lang);
  const subs = c.substituted ?? [];
  if (!c.removed.length && !subs.length) return null;
  const removed = c.removed.map((r) => `${r.qty} × ${r.name}`);
  const lines = [m.shelf.ready(c.short_code)];
  if (removed.length) lines.push(m.shelf.notFound(removed));
  for (const x of subs) lines.push(m.shelf.swapped(x.name, String(x.qty), x.by, x.line_total_usd));
  const lbp = c.payment_method === "cod" && c.fx_rate_lbp ? Math.round((c.total_usd * c.fx_rate_lbp) / 1000) * 1000 : null;
  lines.push("", m.shelf.newTotal(c.total_usd, lbp));
  if (Number(c.credit_usd) > 0) lines.push("", m.shelf.credit(Number(c.credit_usd)));
  return { msg: { type: "text", text: { body: lines.join("\n") } },
           params: [c.short_code, m.shelf.summary(removed, subs.map((x) => ({ name: x.name, by: x.by }))), usd(c.total_usd)] };
}

/** The ids the customer's two buttons carry: the ops-turn parser (parseSubstitutionButton) reads them back. */
export const substitutionButtonId = (keep: boolean, offerId: string) => `sub:${keep ? "keep" : "remove"}:${offerId}`;

/** The customer's question about a substitute: what is missing, what we have instead, the price difference, the deadline. Facts only. */
export function substitutionNotice(o: Offer, lang?: string | null): Built {
  const m = messages(lang);
  const missing = productName({ name: o.missing_name, name_ar: o.missing_name_ar ?? null }, m.lang);
  const substitute = productName({ name: o.substitute_name, name_ar: o.substitute_name_ar ?? null }, m.lang);
  const body = m.sub.question(o.short_code, String(o.qty), missing, Number(o.replaced_total_usd), substitute, Number(o.line_total_usd), Number(o.diff_usd), o.answer_min);
  const ids = [substitutionButtonId(true, o.offer_id), substitutionButtonId(false, o.offer_id)];
  return { msg: buttons(body, [{ id: ids[0]!, title: m.sub.keep }, { id: ids[1]!, title: m.sub.remove }]),
           params: [o.short_code, `${o.qty} × ${missing}`, `${o.qty} × ${substitute}`, usd(o.line_total_usd), String(o.answer_min)], payloads: ids };
}

export const delayedNotice = (code: string) => (m: ReturnType<typeof messages>): Built => ({ msg: { type: "text", text: { body: m.notice.delayed(code) } }, params: [code] });
export const calledOffNotice = (code: string, credit: number) => (m: ReturnType<typeof messages>): Built =>
  ({ msg: { type: "text", text: { body: m.notice.calledOff(code, credit) } }, params: [code] });
export const onTheWayNotice = (code: string) => (m: ReturnType<typeof messages>): Built => ({ msg: { type: "text", text: { body: m.notice.onTheWay(code) } }, params: [code] });

/**
 * The Supabase client `sendCodeStarted` expects, over the console's two-verb database: rpc as it is, and the one table it writes
 * (the record of a template that could not go) caught here and put in the action log by the caller, so nothing is dropped in silence.
 */
function shim(db: Db, skipped: unknown[]): SupabaseClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      try { return { data: await db.rpc(fn, args), error: null }; }
      catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }; }
    },
    from: () => ({ insert: async (row: unknown) => { skipped.push(row); return { error: null }; } }),
  } as unknown as SupabaseClient;
}

export interface NoticeResult { sent: boolean; why?: string; skipped?: unknown[] }

/**
 * Tells one customer something about their order. Never throws: the action that came before it is already done and logged, so a message
 * that could not go is reported (the page says so; the action log keeps it) and the key is stable, so sending it again is safe.
 */
export async function tell(deps: Deps, partyId: string, event: TemplateEvent, build: (m: ReturnType<typeof messages>) => Built, key: string, orderId?: string): Promise<NoticeResult> {
  const skipped: unknown[] = [];
  try {
    const r = await sendCodeStarted({ db: shim(deps.db, skipped), send: deps.send }, partyId, event, (m) => build(m), key, orderId);
    return r.ok ? { sent: true } : { sent: false, why: r.refused, skipped };
  } catch (e) {
    return { sent: false, why: e instanceof Error ? e.message.slice(0, 120) : "send_failed", skipped };
  }
}
