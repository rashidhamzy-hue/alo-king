// Build plan 2.9: one tap after delivery. The card asks whether the order arrived as it should; "a problem" hands the
// conversation to a person. Neutral by construction: it never asks for a rating of a product or a merchant (invariant 14).
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons, type Outbound } from "@ak/wa/kapso";
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import { claimOrderMessage } from "./messages/notify";
import { asLang, messages, type Lang } from "./messages";

// CX2: the words are in the message packs (messages/{ar,en,fr}.ts, `feedback`), in the customer's language.

export const feedbackButtonId = (orderId: string, verdict: "fine" | "problem") => `fb:${verdict}:${orderId}`;
export function parseFeedbackButton(id: string): { verdict: "fine" | "problem"; orderId: string } | null {
  const m = /^fb:(fine|problem):([0-9a-f-]{36})$/.exec(id);
  return m ? { verdict: m[1] as "fine" | "problem", orderId: m[2]! } : null;
}

export function feedbackCard(orderId: string, shortCode: string, lang: Lang = "ar"): Outbound {
  const F = messages(lang).feedback;
  return buttons(F.ask(shortCode), [
    { id: feedbackButtonId(orderId, "fine"), title: F.fineButton },
    { id: feedbackButtonId(orderId, "problem"), title: F.problemButton },
  ]);
}

/**
 * For the cron (apps/gateway/src/index.ts, scheduled()): ask every order that is due, once. The send goes through the gateway
 * with a stable key, so a crash between the send and the mark cannot ask twice; an order is marked only once its card went out.
 */
export async function sendFeedbackRequests(deps: { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult> },
                                           addressOf: (partyId: string) => Promise<string | null>): Promise<number> {
  const due = ((await deps.db.rpc("feedback_due", { p_limit: 20 })).data ?? []) as { order_id: string; short_code: string; customer_id: string }[];
  let n = 0;
  for (const d of due) {
    const to = await addressOf(d.customer_id);
    if (!to) continue;
    // CX1: the feedback card counts against the order's four messages; over the budget it is not sent, and not asked again.
    if (!(await claimOrderMessage(deps.db, d.order_id, "feedback", `feedback:${d.order_id}`, d.customer_id))) {
      await deps.db.rpc("mark_feedback_asked", { p_order: d.order_id }); continue;
    }
    // CX2: in the customer's language (customer_language, 0093), never Arabic for everyone (the founder's chat, 08:54).
    const lang = asLang(((await deps.db.rpc("customer_language", { p_party: d.customer_id })).data as string | null) ?? "ar");
    const r = await deps.send({ line: "customer", partyId: d.customer_id, to, msg: feedbackCard(d.order_id, d.short_code, lang), category: "service",
                                orderId: d.order_id, dedupeKey: `feedback:${d.order_id}` });
    if (r.ok) { await deps.db.rpc("mark_feedback_asked", { p_order: d.order_id }); n++; }
  }
  return n;
}
