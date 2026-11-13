// The customer line's work in the minute cron (apps/gateway/src/index.ts, scheduled(), one call). Lane B owns what is in it, so
// a new customer-line job is added here, not in index.ts. Each step stands alone: one failing never stops the others.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import type { ModelClient } from "./concierge";
import { sendFeedbackRequests } from "./feedback";
import { runSearchWordJobs } from "./search-words";

export interface CronDeps { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult>; model: ModelClient; modelName: string }

export async function customerLineCron(deps: CronDeps, now = new Date()): Promise<{ feedback: number; searchWords: number; stale: number | null }> {
  const addressOf = async (partyId: string) => ((await deps.db.rpc("party_address", { p_party: partyId, p_line: "customer" })).data as string | null) ?? null;
  // 2.9: one tap after delivery, once per order.
  const feedback = await sendFeedbackRequests(deps, addressOf).catch(() => 0);
  // 1.23: once a night, queue items whose name, brand or size changed since their words were built; then a few jobs a minute.
  let stale: number | null = null;
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 41) stale = ((await deps.db.rpc("enqueue_stale_search_words")).data as number | null) ?? 0;
  const searchWords = (await runSearchWordJobs(deps, now).catch(() => [])).length;
  return { feedback, searchWords, stale };
}
