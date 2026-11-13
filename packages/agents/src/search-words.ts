// Build plan 1.23 (session B4): search words for every new product and menu item, written automatically. Runs from the minute
// cron (cron.ts): takes a few jobs from search_word_jobs (0076), asks the fast model for the item's words in Lebanese Arabic,
// Arabizi, English and French plus the generic words people use, and a few phrasings a customer might send; applies the
// 1.22 builder's rules (pack-rules.ts here, cross-product rules in save_search_words); then runs the phrasings through the
// planner. An item whose phrasings do not resolve to it goes on the review list instead of being guessed.
// The model only names products: it never states a food fact (invariant 15), and pack-rules.ts drops any word that does.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelClient } from "./concierge";
import { productRows, type Proposed } from "./pack-rules";

export interface SearchWordJob {
  sku: string; reason: string; name: string; name_ar: string | null; brand: string | null; category: string; sub_type: string | null;
  unit: string | null; merchant: string | null; shelf: { sku: string; name: string; brand: string | null; sub_type: string | null }[];
}
export interface Proposal extends Proposed { phrasings: { text: string; lang?: string }[] }

const SYSTEM = `You build the search vocabulary of a WhatsApp grocery and food delivery service in the Chouf, Lebanon. Customers write Lebanese Arabic (dialect, Arabic script), Arabizi (Latin letters, with 2 3 5 7 8 9 for Arabic sounds, many spellings), English and French, mixed freely. A search term is matched when all of its words appear in the customer's message (Arabic prefixes و ب ع ال are handled automatically), so terms must be short: one to four words.
You only name products. Never write anything about allergens, ingredients, health, diet suitability, halal, calories or nutrition, unless that word is printed in the product's own name.`;

const term = { type: "object", properties: { t: { type: "string" }, lang: { type: "string", enum: ["ar", "arabizi", "en", "fr"] } }, required: ["t", "lang"] };
const TOOL: Anthropic.Tool = {
  name: "search_words",
  description: "Record the search vocabulary for one product, and the test phrasings.",
  input_schema: { type: "object", properties: {
    kind: { type: "array", items: term }, brand: { type: "array", items: term }, exact: { type: "array", items: term },
    phrasings: { type: "array", items: { type: "object", properties: { text: { type: "string" }, lang: { type: "string" } }, required: ["text"] } },
  }, required: ["kind", "brand", "exact", "phrasings"] },
};

export function promptFor(job: SearchWordJob, phrasings: number): string {
  const line = (p: { sku: string; name: string; brand: string | null; sub_type: string | null }) => `${p.sku} | ${p.name} | brand: ${p.brand ?? "-"} | kind: ${p.sub_type ?? "-"}`;
  return `${job.merchant ? `Menu of ${job.merchant}` : `The shelf "${job.category}"`} also holds these products (one per line):\n` +
    (job.shelf.length ? job.shelf.map(line).join("\n") : "(none yet)") + "\n\n" +
    `Write the search vocabulary for this new product:\n${line(job)}${job.name_ar ? ` | Arabic label: ${job.name_ar}` : ""}${job.unit ? ` | sold: ${job.unit}` : ""}\n\n` +
    `Three lists, each entry with its language (ar = Arabic script, arabizi, en, fr):\n` +
    `- kind: what people call this kind of product when they do not name a brand: the everyday word, with and without the article, singular and plural, common containers said with it ("ربطة خبز", "كرتونة مي"), several Arabizi spellings, English and French. A word belongs here only if, said alone, people in the Chouf would mean this kind of product. Brand names used as generic words go here too (نسكافيه for instant coffee) when people use them that way.\n` +
    `- brand: the brand as people say and type it: Arabic script (with and without ال where people say it), Arabizi spellings, Latin. Empty for unbranded produce, meat and home-made dishes.\n` +
    `- exact: short phrases that fit this product and no other product listed above: the brand or kind with the size, flavour, colour, fat level as printed, count, pack, or a nickname. Every exact phrase must be impossible to read as one of the others.\n` +
    `Aim for 10 to 30 kind terms, 3 to 12 brand terms (none if unbranded) and 4 to 15 exact terms.\n` +
    `Then ${phrasings} phrasings: how different customers would ask for exactly this product in one WhatsApp message (Lebanese Arabic, Arabizi, English or French; with a quantity; naturally, not all the same shape). Each must name it clearly enough that a shop assistant would bring this one and not another product listed above.`;
}

/** One model call, forced to the search_words tool. Null when the answer does not fit the shape. */
export async function proposeSearchWords(model: ModelClient, modelName: string, job: SearchWordJob, phrasings = 4): Promise<{ proposal: Proposal | null; usage: { input: number; output: number } }> {
  const res = await model.messages.create({ model: modelName, max_tokens: 4096, system: SYSTEM, tools: [TOOL],
    tool_choice: { type: "tool", name: "search_words" }, messages: [{ role: "user", content: promptFor(job, phrasings) }] });
  const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "search_words");
  let input = call?.input as Record<string, unknown> | string | undefined;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = undefined; } }
  if (!input || typeof input !== "object") return { proposal: null, usage };
  const list = (x: unknown) => (Array.isArray(x) ? x : []).filter((t): t is { t: string; lang?: string } => !!t && typeof (t as { t?: unknown }).t === "string");
  const phr = (Array.isArray(input.phrasings) ? input.phrasings : []).map((p) => (typeof p === "string" ? { text: p } : p))
    .filter((p): p is { text: string; lang?: string } => !!p && typeof (p as { text?: unknown }).text === "string").slice(0, phrasings);
  return { proposal: { kind: list(input.kind), brand: list(input.brand), exact: list(input.exact), phrasings: phr }, usage };
}

export interface JobOutcome { sku: string; status: "done" | "review" | "failed"; written?: number; failed_phrasings?: number; error?: string }

/** Takes up to settings.search_words.per_tick jobs and runs each. Never throws: a failed job is recorded and retried (3 tries). */
export async function runSearchWordJobs(deps: { db: SupabaseClient; model: ModelClient; modelName: string }, now = new Date()): Promise<JobOutcome[]> {
  const { data: cfg } = await deps.db.rpc("setting", { p_key: "search_words" });
  const s = (cfg ?? {}) as { enabled?: boolean; phrasings?: number };
  if (s.enabled === false) return [];
  const { data, error } = await deps.db.rpc("claim_search_word_jobs", { p_limit: null });
  if (error) return [];
  const version = `auto-${now.toISOString().slice(0, 10)}`;
  const out: JobOutcome[] = [];
  for (const job of (data ?? []) as SearchWordJob[]) {
    try {
      const { proposal } = await proposeSearchWords(deps.model, deps.modelName, job, s.phrasings ?? 4);
      if (!proposal) throw new Error("no_usable_answer");
      const built = productRows(job.sku, { name: job.name, category: job.category }, proposal);
      const saved = await rpc<{ written: number; dropped: unknown }>(deps.db, "save_search_words", { p_sku: job.sku, p_rows: built.rows, p_version: version });
      const check = await rpc<{ ok: number; failed: unknown[] }>(deps.db, "check_search_words", { p_sku: job.sku, p_phrasings: proposal.phrasings.map((p) => p.text) });
      const status = check.failed.length > 0 || saved.written === 0 ? "review" : "done";
      await rpc(deps.db, "finish_search_word_job", { p_sku: job.sku, p_status: status, p_error: null,
        p_result: { written: saved.written, dropped: { ...(saved.dropped as object), food: built.dropped.food, brand_as_kind_own: built.dropped.brand_as_kind }, check } });
      out.push({ sku: job.sku, status, written: saved.written, failed_phrasings: check.failed.length });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 300);
      await deps.db.rpc("finish_search_word_job", { p_sku: job.sku, p_status: "failed", p_result: null, p_error: msg }).then(() => undefined, () => undefined);
      // Back to pending for the next tick, unless it has used its three tries.
      await deps.db.rpc("enqueue_search_words_retry", { p_sku: job.sku }).then(() => undefined, () => undefined);
      out.push({ sku: job.sku, status: "failed", error: msg });
    }
  }
  return out;
}

async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
