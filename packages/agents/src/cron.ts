// The customer line's work in the minute cron (apps/gateway/src/index.ts, scheduled(), one call). Lane B owns what is in it, so
// a new customer-line job is added here, not in index.ts. Each step stands alone: one failing never stops the others.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import type { ModelClient } from "./concierge";
import { sendFeedbackRequests } from "./feedback";
import { runSearchWordJobs } from "./search-words";
import { buttons } from "@ak/wa/kapso";
import { KEPT_BUTTON } from "./order-card";
import { sendCodeStarted } from "./messages/notify";
import { sendWebCards } from "./web-orders";

export interface CronDeps { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult>; model: ModelClient; modelName: string }

/**
 * Audit item 4 (K1): an order kept after closing time is offered once when we open, with its one button, to a customer who wrote
 * within 23 hours. The send goes through the gateway with a stable key; a row is marked only once its message went out.
 */
export async function offerKeptOrders(deps: { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult> }): Promise<number> {
  const due = ((await deps.db.rpc("kept_orders_due", { p_limit: 20 })).data ?? []) as { id: string; party_id: string }[];
  let n = 0;
  for (const d of due) {
    // M1 (G1-23): in the customer's language; past 24 hours, the approved ak_kept_order_open template with the same button.
    const r = await sendCodeStarted(deps, d.party_id, "kept_order_open",
      (m) => ({ msg: buttons(m.fixed.keptOpen, [{ id: KEPT_BUTTON, title: m.fixed.keptButton }]), params: [], payloads: [KEPT_BUTTON] }), `kept:${d.id}`);
    if (r.ok) { await deps.db.rpc("mark_kept_offered", { p_id: d.id }); n++; }
  }
  return n;
}

export async function customerLineCron(deps: CronDeps, now = new Date()): Promise<{ feedback: number; searchWords: number; stale: number | null; kept: number; webCards: number }> {
  // WEB2: the card of an order placed on the website goes first: the customer is waiting on the page for it.
  const webCards = await sendWebCards(deps).catch((err) => { console.error("web_cards", String(err).slice(0, 200)); return 0; });
  const addressOf = async (partyId: string) => ((await deps.db.rpc("party_address", { p_party: partyId, p_line: "customer" })).data as string | null) ?? null;
  // 2.9: one tap after delivery, once per order.
  const feedback = await sendFeedbackRequests(deps, addressOf).catch(() => 0);
  // 1.23: once a night, queue items whose name, brand or size changed since their words were built; then a few jobs a minute.
  let stale: number | null = null;
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 41) stale = ((await deps.db.rpc("enqueue_stale_search_words")).data as number | null) ?? 0;
  const searchWords = (await runSearchWordJobs(deps, now).catch(() => [])).length;
  // Audit item 4: orders kept overnight, offered once when we open.
  const kept = await offerKeptOrders(deps).catch(() => 0);
  return { feedback, searchWords, stale, kept, webCards };
}
