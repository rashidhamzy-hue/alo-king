// TEST1 (staging's friends' test; docs/DECISIONS.md, "TEST1"). Three pieces, all code, no model:
//   1. withTestLine / testLineSend: every message about a test order (its card, every status message, the feedback question) carries
//      one line, «🧪 طلب تجريبي: ما في توصيل ولا دفع» / "🧪 Test order: no delivery, no payment", in the customer's language. Added in
//      one place, around the gateway's send, so no builder can forget it. A template is sent as Meta approved it (never changed).
//   2. testOrderStep: the customer message of each step a test order takes by itself (the real messages, as a real order's).
//   3. testOrderTick: the minute cron's step: take each due step (SQL moves the status), send its message, mark it sent.
// Nothing here confirms an order (invariant 4): the walk starts only after the customer's own Confirm tap.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Outbound } from "@ak/wa/kapso";
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import { feedbackCard } from "./feedback";
import { asLang, messages, type Lang } from "./messages";

const TEXT_MAX = 4096, INTERACTIVE_MAX = 1024;

/** The message with the test line at its end (text body, or an interactive message's body). Already there: unchanged. */
export function withTestLine(msg: Outbound, lang: Lang): Outbound {
  const line = messages(lang).testMode.line;
  const add = (body: string, max: number) => (body.includes(line) ? body : `${body}\n\n${line}`.slice(0, max));
  if (msg.type === "text") return { ...msg, text: { ...msg.text, body: add(msg.text.body, TEXT_MAX) } };
  if (msg.type === "interactive") {
    const i = msg.interactive as { body?: { text: string } };
    if (i.body?.text !== undefined) return { ...msg, interactive: { ...msg.interactive, body: { ...i.body, text: add(i.body.text, INTERACTIVE_MAX) } } } as Outbound;
  }
  return msg;
}

/** Wraps the gateway's send: a customer-line message tied to a test order gets the test line. One lookup per order, kept for the Worker's life. */
export function testLineSend(db: SupabaseClient, send: (r: SendRequest) => Promise<SendResult>): (r: SendRequest) => Promise<SendResult> {
  const known = new Map<string, Lang | null>();
  return async (req) => {
    if (req.line !== "customer" || !req.orderId) return send(req);
    let lang = known.get(req.orderId);
    if (lang === undefined) {
      const { data, error } = await db.rpc("test_order_line", { p_order: req.orderId });
      if (error) throw new Error(`test_order_line: ${error.message}`);          // fail closed: the turn retries, nothing goes without its line
      lang = data ? asLang(data as string) : null;
      known.set(req.orderId, lang);
    }
    return send(lang ? { ...req, msg: withTestLine(req.msg, lang) } : req);
  };
}

export interface TestStepDue { order_id: string; short_code: string; customer_id: string; step: "preparing" | "on_the_way" | "at_door" | "delivered" | "feedback";
  resend: boolean; lang: string | null; food: boolean; place: string | null; eta_minutes: number | null }

/** The customer message of one step: the words a real order's customer gets at the same point (CX2's packs). */
export function testOrderStep(d: TestStepDue): Outbound {
  const lang = asLang(d.lang), m = messages(lang), code = d.short_code, eta = d.eta_minutes ?? null;
  const text = (body: string): Outbound => ({ type: "text", text: { body } });
  switch (d.step) {
    case "preparing": return text(d.food && d.place ? m.food.accepted(code, d.place, eta ?? 0) : m.answer.preparing(code, eta));
    case "on_the_way": return text(m.notice.onTheWay(code, null));
    case "at_door": return text(m.notice.riderAtDoor(code));
    case "delivered": return text(m.answer.delivered(code));
    case "feedback": return feedbackCard(d.order_id, code, lang);
  }
}

/** The cron's step (staging only: the gateway calls it when ENVIRONMENT is staging). Returns how many messages went. */
export async function testOrderTick(deps: { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult> },
                                    addressOf: (partyId: string) => Promise<string | null>): Promise<number> {
  const { data, error } = await deps.db.rpc("test_orders_due", { p_limit: 20 });
  if (error) throw new Error(`test_orders_due: ${error.message}`);
  let sent = 0;
  for (const d of (data as TestStepDue[] | null) ?? []) {
    const took = await deps.db.rpc("test_order_advance", { p_order: d.order_id, p_step: d.step });
    if (took.error) throw new Error(`test_order_advance: ${took.error.message}`);
    if (!took.data) continue;                                  // cancelled or cleared meanwhile
    const to = await addressOf(d.customer_id);
    // No address: nothing can be sent; the step is marked so the walk goes on (the console shows the order's status).
    const r = to ? await deps.send({ line: "customer", partyId: d.customer_id, to, msg: testOrderStep(d), category: "service", orderId: d.order_id,
                                     dedupeKey: `test:${d.step}:${d.order_id}` }) : { ok: false as const, refused: "no_address" };
    // Refused for good (no consent, the window): recorded as done, never retried every minute; a throw (outbox down) retries next minute.
    await deps.db.rpc("test_order_step_sent", { p_order: d.order_id, p_step: d.step });
    if (r.ok) sent++;
  }
  return sent;
}
