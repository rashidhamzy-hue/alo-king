// Build plan 1.23 (session B4): search words for every new product, automatically. On the real schema (every migration and the
// catalog seeds), the real job code, a scripted model in place of the fast model.
// Test (build plan): adding a product creates its words, a colliding word is dropped, and a failed phrasing lands on the review list.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";
import { runSearchWordJobs } from "@ak/agents/search-words";
import { customerLineCron } from "@ak/agents/cron";

let db: TestDb;
beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); update stock_levels set on_hand = 50;`);
}, 60_000);
afterAll(async () => { await db?.pg.close(); });

/** A new hub product with a price and stock, as the console or intake would add it. */
async function addProduct(sku: string, name: string, brand: string, category = "Beverages", subType = "juice") {
  const p = await db.one(`insert into products(sku, name_en, brand, category, sub_type) values ($1, $2, $3, $4, $5) returning id`, [sku, name, brand, category, subType]);
  const hub = (await db.one(`select id from sources where kind = 'dark_store' limit 1`)).id;
  await db.pg.query(`insert into offers(source_id, product_id, price_usd) values ($1, $2, 1.5)`, [hub, p.id]);
  await db.pg.query(`insert into stock_levels(source_id, product_id, on_hand) values ($1, $2, 40)`, [hub, p.id]);
  return p.id as string;
}

function model(answers: Record<string, unknown>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return { calls, client: { messages: { create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(body);
    const sku = /new product:\n(AK-[0-9A-Z-]+)/.exec(String(body.messages[0]!.content))?.[1] ?? "";
    return { id: "m", type: "message", role: "assistant", model: "fast", stop_reason: "tool_use", stop_sequence: null,
             content: [{ type: "tool_use", id: "t", name: "search_words", input: answers[sku] ?? {} }], usage: { input_tokens: 900, output_tokens: 300 } } as unknown as Anthropic.Message;
  } } } };
}
const deps = (m: ReturnType<typeof model>) => ({ db: supabaseOver(db).client, model: m.client, modelName: "fast" });
const terms = async (sku: string) => db.all<{ term: string; level: string }>(`select term, level from language_pack where sku = $1 order by level, term`, [sku]);

describe("search words for new items (1.23)", () => {
  it("the 291 seeded products, which have the 1.22 pack, get no job; a new product gets one", async () => {
    expect((await db.one(`select count(*)::int n from search_word_jobs`)).n).toBe(0);
    expect((await db.one(`select count(*)::int n from search_word_state`)).n).toBeGreaterThan(250);
    await addProduct("AK-T001", "Hayat Pomegranate Juice 1L", "Hayat");
    expect(await db.one(`select reason, status from search_word_jobs where sku = 'AK-T001'`)).toEqual({ reason: "new", status: "pending" });
  });

  it("the job writes the words, drops a food word not in the name, and the phrasings resolve: done", async () => {
    const m = model({ "AK-T001": {
      kind: [{ t: "عصير رمان", lang: "ar" }, { t: "3asir rimmen", lang: "arabizi" }, { t: "pomegranate juice", lang: "en" }, { t: "jus de grenade", lang: "fr" }],
      brand: [{ t: "حياة", lang: "ar" }, { t: "hayat", lang: "arabizi" }],
      exact: [{ t: "عصير رمان حياة", lang: "ar" }, { t: "hayat rimmen", lang: "arabizi" }, { t: "hayat pomegranate", lang: "en" },
              { t: "عصير رمان صحي", lang: "ar" }],                                  // «healthy»: a food claim, not printed in the name
      phrasings: [{ text: "بدي قنينة عصير رمان حياة" }, { text: "baddi 2 hayat rimmen" }, { text: "one hayat pomegranate juice please" }] } });
    const out = await runSearchWordJobs(deps(m));
    expect(out).toEqual([{ sku: "AK-T001", status: "done", written: 9, failed_phrasings: 0 }]);
    expect(m.calls[0]!.tool_choice).toEqual({ type: "tool", name: "search_words" });
    expect(String(m.calls[0]!.messages[0]!.content)).toContain("Beverages");      // the shelf it sits on, so exact words fit only it
    const t = await terms("AK-T001");
    expect(t.map((x) => x.term)).toContain("عصير رمان حياة");
    expect(t.map((x) => x.term)).not.toContain("عصير رمان صحي");
    const job = await db.one(`select status, result from search_word_jobs where sku = 'AK-T001'`);
    expect(job.status).toBe("done");
    expect(job.result.dropped.food).toEqual([{ term: "عصير رمان صحي", food: "healthy" }]);
    // searchable at once: the planner finds it from a customer's words
    const plan = await db.rpc("plan_order_core", { p_party: null, p_intent: { intent: "order", _message: "عصير رمان حياة",
      lines: [{ raw: "عصير رمان حياة", query: "عصير رمان حياة", qty: 1, unit: "each", modifiers: [], confidence: 0.9 }] }, p_village: null, p_choices: {} });
    expect(plan.lines[0].chosen?.name).toBe("Hayat Pomegranate Juice 1L");
  }, 60_000);

  it("a colliding exact word is dropped for both products; a kind word that is a brand is dropped", async () => {
    await addProduct("AK-T002", "Hayat Pomegranate Juice 250ml", "Hayat");
    const m = model({ "AK-T002": {
      kind: [{ t: "عصير رمان", lang: "ar" }, { t: "hayat", lang: "arabizi" }],                  // a brand is not a kind
      brand: [{ t: "hayat", lang: "arabizi" }],
      exact: [{ t: "hayat rimmen", lang: "arabizi" }, { t: "hayat rimmen zghir", lang: "arabizi" }, { t: "hayat 250", lang: "arabizi" }],
      phrasings: [{ text: "hayat rimmen zghir" }] } });
    const [o] = await runSearchWordJobs(deps(m));
    expect(o).toMatchObject({ sku: "AK-T002", status: "done" });
    const r = (await db.one(`select result from search_word_jobs where sku = 'AK-T002'`)).result;
    expect(r.dropped.collision).toEqual([{ term: "hayat rimmen", also: ["AK-T001"] }]);
    expect(r.dropped.brand_as_kind_own).toEqual(["hayat"]);
    expect((await terms("AK-T001")).map((x) => x.term)).not.toContain("hayat rimmen");    // it names neither now
    expect((await terms("AK-T002")).map((x) => x.term)).not.toContain("hayat rimmen");
  }, 60_000);

  it("a phrasing that does not resolve to the item puts it on the review list instead of a guess", async () => {
    await addProduct("AK-T003", "Hayat Mango Juice 1L", "Hayat");
    const m = model({ "AK-T003": {
      kind: [{ t: "عصير مانغا", lang: "ar" }, { t: "mango juice", lang: "en" }], brand: [{ t: "hayat", lang: "arabizi" }], exact: [{ t: "hayat mango", lang: "en" }],
      phrasings: [{ text: "hayat mango juice" }, { text: "بدي عصير حياة" }] } });                 // «Hayat juice»: which one? a question
    const [o] = await runSearchWordJobs(deps(m));
    expect(o).toMatchObject({ sku: "AK-T003", status: "review", failed_phrasings: 1 });
    const open = await db.rpc("search_word_reviews_open");
    expect(open.find((x: any) => x.sku === "AK-T003")).toMatchObject({ phrasing: "بدي عصير حياة", name: "Hayat Mango Juice 1L" });
  }, 60_000);

  it("a renamed product is queued again; the nightly pass finds what changed; a model with no usable answer fails and retries", async () => {
    await db.pg.query(`update products set name_en = 'Hayat Mango Juice 1.5L' where sku = 'AK-T003'`);
    expect(await db.one(`select reason, status from search_word_jobs where sku = 'AK-T003'`)).toEqual({ reason: "changed", status: "pending" });
    const [o] = await runSearchWordJobs(deps(model({})));
    expect(o).toMatchObject({ sku: "AK-T003", status: "failed" });
    expect(await db.one(`select status, attempts from search_word_jobs where sku = 'AK-T003'`)).toEqual({ status: "pending", attempts: 1 });
    // a change the trigger did not see (written while it was off): the nightly pass compares what the words were built from
    await db.pg.exec(`alter table products disable trigger products_search_words;
                      update products set brand = 'Hayat Juices' where sku = 'AK-T001';
                      alter table products enable trigger products_search_words;`);
    expect(await db.rpc("enqueue_stale_search_words")).toBe(1);
    expect(await db.one(`select reason from search_word_jobs where sku = 'AK-T001'`)).toEqual({ reason: "nightly" });
  }, 60_000);

  it("the customer-line cron runs the jobs (and the feedback cards) in one call", async () => {
    await db.pg.exec(`update search_word_jobs set status = 'done'`);
    await addProduct("AK-T004", "Hayat Apple Juice 1L", "Hayat");
    const m = model({ "AK-T004": { kind: [{ t: "عصير تفاح", lang: "ar" }], brand: [], exact: [{ t: "hayat apple", lang: "en" }], phrasings: [{ text: "hayat apple" }] } });
    const r = await customerLineCron({ ...deps(m), send: async () => ({ ok: true as const, wamid: "w" }) }, new Date("2026-11-14T10:00:00Z"));
    expect(r).toMatchObject({ searchWords: 1, stale: null });
    expect(await db.one(`select status from search_word_jobs where sku = 'AK-T004'`)).toEqual({ status: "done" });
  }, 60_000);
});
