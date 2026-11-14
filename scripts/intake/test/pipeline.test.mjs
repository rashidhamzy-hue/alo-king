// Session I1: the product intake pipeline against the real migrations (PGlite). The web search, the model, the picture download
// and the storage bucket are replaced; the SQL, P2's loader, P1's picture decision and the run's budget logic are the code that ships.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";
import { runIntake, summaryLines } from "../run.mjs";
import { proposeFromResearch } from "../../images/research-pictures.mjs";

const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no", seen: "x" };
const SHOP = "https://shop.example.com/nutella-350";
const BRAND = "https://www.nutella.com/lb/en/products/nutella-350g";
const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];
const STEPS = ["new_item", "identity", "search_words", "picture", "food_facts", "price_cost", "person_approves", "live"];

const fileFor = (sku) => ({
  sku,
  matched: { brand: "Nutella", product: "Hazelnut spread", size: "350 g", barcode: "3017620422003", confidence: "exact", note: "" },
  pictures: [{ image_url: "https://cdn.example.com/n350.jpg", page_url: BRAND, site: "Nutella", site_kind: "brand", looks: "one jar, white background" }],
  ingredients: { text: "Sugar, palm oil, hazelnuts 13%, skimmed milk powder 8.7%, fat-reduced cocoa 7.4%, emulsifier: lecithins (soya), vanillin", language: "en", page_url: SHOP, market: "Lebanon" },
  allergens: { contains: ["hazelnuts", "milk", "soya"], may_contain: [], quote: "Contains hazelnuts, milk, soya.", page_url: SHOP },
  nutrition: { per: "100 g", energy_kcal: 539, fat_g: 30.9, saturated_fat_g: 10.6, carbohydrate_g: 57.5, sugars_g: 56.3, protein_g: 6.3, salt_g: 0.107, page_url: SHOP },
  storage: { text: "Store in a cool dry place.", page_url: "https://not-searched.example.com/x" },      // a page the search never returned: dropped
  not_found: ["diet_labels"],
});
const searched = (urls) => ({ type: "web_search_tool_result", tool_use_id: "srv1", content: urls.map((url) => ({ type: "web_search_result", url, title: "t", encrypted_content: "e" })) });
const answer = (input, usage = { input_tokens: 6000, output_tokens: 900, server_tool_use: { web_search_requests: 3 } }) => ({
  stop_reason: "tool_use", usage,
  content: [{ type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "nutella 350 g" } }, searched([SHOP, BRAND]),
            { type: "tool_use", id: "t1", name: "record_research", input }] });

let db; let prices; let lead; let uploads;
const store = () => ({ rpc: (fn, a) => db.rpc(fn, a), upload: async (path) => { uploads.push(path); } });
const pd = (s) => ({
  runId: "pics", model: "claude-haiku-5-5", sharp: null, store: s,
  download: async (u) => Buffer.from(u), measure: async () => ({ width: 1200, height: 1200, format: "jpeg" }),
  shrink: async (buf) => ({ data: buf, width: 1000, height: 1000, bytes: buf.length, sha256: Buffer.from(buf).toString("hex").slice(-40).padStart(64, "0") }),
  check: async () => GOOD });
const deps = (runId, client, over = {}) => {
  const s = store();
  return { store: s, runId, model: "claude-haiku-5-5", prices, client, researchDir: null, pictures: (item, c, meta) => proposeFromResearch(item, c, { ...pd(s), runId }, meta), ...over };
};
const steps = async (sku) => Object.fromEntries((await db.all(`select j.step, j.status from product_intake_jobs j join products p on p.id = j.product_id where p.sku = $1`, [sku])).map((r) => [r.step, r.status]));
const newProduct = async (sku, over = {}) => {
  const cat = (await db.one(`select category from products where sku = 'AK-0042'`)).category;
  const p = { name_en: "Nutella Hazelnut Spread 350 g", brand: "Nutella", barcode: "3017620422003", ...over };
  return (await db.one(`insert into products(sku, name_en, brand, category, barcode, sell_unit) values ($1, $2, $3, $4, $5, 'each') returning id`, [sku, p.name_en, p.brand, cat, p.barcode])).id;
};

beforeAll(async () => {
  db = await openTestDb();
  prices = await db.rpc("intake_prices", { p_model: "claude-haiku-5-5" });
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead') returning id`)).id;
  uploads = [];
}, 120_000);

describe("the queue", () => {
  it("the 291 catalog items are enqueued once, eight steps each, and a second backfill adds nothing", async () => {
    const n = await db.one(`select count(distinct product_id)::int as items, count(*)::int as rows from product_intake_jobs`);
    expect(n).toEqual({ items: 291, rows: 291 * 8 });
    expect(await db.rpc("intake_enqueue_existing")).toMatchObject({ already: true });
    const any = (await db.one(`select id from products where sku = 'AK-0042'`)).id;
    expect(await db.rpc("enqueue_product_intake", { p_product: any, p_origin: "backfill" })).toBe(0);
    expect((await db.one(`select count(*)::int as n from product_intake_jobs`)).n).toBe(291 * 8);
    expect(await steps("AK-0042")).toMatchObject({ new_item: "done", identity: "ready", picture: "waiting", food_facts: "waiting" });
    // The 291 have research files from sessions R1-R3: for these tests their identity step is treated as done.
    await db.pg.exec(`update product_intake_jobs set status = 'done' where step = 'identity'`);
  });

  it("price and cost are never moved by code: they wait for a person on every item", async () => {
    await db.rpc("intake_advance", {});
    const r = await db.one(`select count(*) filter (where status = 'needs_person')::int as person, count(*)::int as n from product_intake_jobs j
                              join products p on p.id = j.product_id where step = 'price_cost' and not exists (select 1 from stock_levels l where l.product_id = p.id and l.avg_cost_usd is not null)`);
    expect(r.person).toBe(r.n);
  });
});

describe("a new product walks all eight steps", () => {
  it("is enqueued by the trigger, researched, its picture and facts proposed, and goes live once people approve", async () => {
    const pid = await newProduct("AK-0999");
    expect(await steps("AK-0999")).toEqual({ new_item: "done", identity: "ready", search_words: "waiting", picture: "waiting", food_facts: "waiting",
      price_cost: "waiting", person_approves: "waiting", live: "waiting" });

    let calls = 0;
    const client = { messages: { create: async (body) => {
      calls++;
      expect(body.model).toBe("claude-haiku-5-5");
      expect(body.tools.map((t) => t.name)).toEqual(["web_search", "record_research"]);
      expect(body.tools[0].type).toBe("web_search_20250305");
      expect(body.system).toContain("Missing is correct; guessed is a defect");          // the README's own rules
      return answer(fileFor("AK-0999"));
    } } };
    const run = await runIntake(deps("run-a", client), { maxJobs: 15, maxSpend: 0.75 });
    expect(calls).toBe(1);
    expect(run.jobs.map((j) => `${j.step}:${j.outcome}`)).toEqual(["identity:done", "picture:done", "food_facts:done"]);
    expect(run.spend_usd).toBeCloseTo((6000 * 0.1 + 900 * 0.5) / 1e6 + 3 * 0.01, 6);
    expect(await steps("AK-0999")).toMatchObject({ identity: "done", picture: "done", food_facts: "done", price_cost: "needs_person", person_approves: "needs_person" });

    // The research file is stored as written, with what code dropped; P2's loader filed it.
    const res = await db.one(`select file, dropped, web_searches, cost_usd from intake_research where product_id = $1`, [pid]);
    expect(res.file.storage).toBeUndefined();
    expect(res.dropped).toEqual([expect.objectContaining({ block: "storage", reason: "page_not_returned_by_the_search" })]);
    expect(res.web_searches).toBe(3);
    const img = await db.one(`select id, status, source_kind, licence, page_url from product_images where product_id = $1`, [pid]);
    expect(img).toMatchObject({ status: "proposed", source_kind: "public_page", licence: "public_page", page_url: BRAND });
    const facts = (await db.all(`select attribute, value, source, approved_at from product_facts where product_id = $1 order by attribute`, [pid]));
    expect(facts.map((f) => f.attribute)).toEqual(["ingredients", "milk", "nutrition", "soy", "tree_nuts"]);
    expect(facts.every((f) => f.source === "web_page" && f.approved_at === null)).toBe(true);
    // A picture from a page is never approved by a rule, whatever the rules say.
    await db.pg.exec(`update auto_approval_rules set enabled = true, first_passed_at = now()`);
    const t = await db.rpc("try_auto_approve", { p_kind: "picture", p_proposal: img.id });
    expect(t).toMatchObject({ approved: false, reason: "checks_failed" });
    expect(t.failed).toEqual(expect.arrayContaining(["not_a_shop_page", "source_is_open_food_facts_brand_or_own_photo"]));
    await db.pg.exec(`update auto_approval_rules set enabled = false, first_passed_at = null`);

    // 3 search words: the Worker builds them (0076; simulated here) and every phrasing resolves.
    await db.pg.query(`insert into language_pack(sku, term, level, lang, version, tokens, forms) values ('AK-0999', 'nutella', 'exact', 'en', 'test', array['nutella'], array['nutella'])`);
    await db.pg.query(`update search_word_jobs set status = 'done' where sku = 'AK-0999'`);
    await db.pg.query(`insert into search_word_state(sku, name_key, version) select sku, product_name_key(p), 'test' from products p where sku = 'AK-0999'`);
    // 6 a person enters the price and the cost; 7 a person approves the picture and the facts from the pack.
    await db.pg.query(`insert into offers(source_id, product_id, price_usd) select id, $1, 4.50 from sources where kind = 'dark_store' limit 1`, [pid]);
    await db.pg.query(`insert into stock_levels(source_id, product_id, avg_cost_usd) select id, $1, 3.10 from sources where kind = 'dark_store' limit 1`, [pid]);
    await db.pg.query(`insert into catalog_placements(sku, category_code, subgroup_code, sort_in_category) select 'AK-0999', category_code, subgroup_code, 999 from catalog_placements limit 1`);
    await db.rpc("review_product_image", { p_image: img.id, p_by: lead, p_decision: "approve" });
    for (const attr of ["ingredients", ...ALLERGENS]) {
      await db.pg.query(`insert into product_facts(product_id, attribute, value, detail, status, source, proposed_by, approved_by, approved_at)
        values ($1, $2, $3, $4, 'declared', 'label', $5, $5, now())`, [pid, attr, attr === "ingredients" ? null : (["tree_nuts", "milk", "soy"].includes(attr) ? "contains" : "free"),
        attr === "ingredients" ? JSON.stringify({ text: "Sugar, palm oil, hazelnuts" }) : "{}", lead]);
    }
    const run2 = await runIntake(deps("run-b", client), { maxJobs: 15, maxSpend: 0.75 });
    expect(run2.jobs).toEqual([]);
    expect(await steps("AK-0999")).toEqual(Object.fromEntries(STEPS.map((s) => [s, "done"])));
    const live = await db.one(`select j.result from product_intake_jobs j where j.product_id = $1 and j.step = 'live'`, [pid]);
    expect(live.result).toMatchObject({ orderable: true, in_catalog: true });
    // The approved picture reaches the public catalog bucket through A5's single path, and through nothing else.
    expect((await db.all(`select image_id from catalog_public_expected() where product_id = $1`, [pid])).map((r) => r.image_id)).toEqual([img.id]);
    expect(summaryLines(run).join("\n")).toMatch(/minutes \(this script\): [\d.]+; model spend: 0\.03\d+ USD/);
    expect((await db.one(`select spend_usd, jobs_taken from intake_runs where run_id = 'run-a'`))).toMatchObject({ jobs_taken: 3 });
  });

  it("an earlier session's research file is used as it is, without a model call", async () => {
    await newProduct("AK-0997", { name_en: "Nutella 350 g copy" });
    const text = JSON.stringify(fileFor("AK-0997"), null, 2);
    const client = { messages: { create: async () => { throw new Error("must not be called"); } } };
    const run = await runIntake(deps("run-file", client, { researchDir: "fake", readFile: (p) => { if (p !== "fake/AK-0997.json") throw new Error("no"); return text; } }), { maxJobs: 1 });
    expect(run.jobs).toEqual([expect.objectContaining({ sku: "AK-0997", step: "identity", outcome: "done", cost_usd: 0 })]);
    expect((await db.one(`select model, cost_usd from intake_research r join products p on p.id = r.product_id where p.sku = 'AK-0997'`))).toMatchObject({ model: "file:fake/AK-0997.json" });
    await db.pg.exec(`update product_intake_jobs set status = 'done' where product_id = (select id from products where sku = 'AK-0997')`);
  });
});

describe("failures, the review list and the budget", () => {
  it("a failed step is tried again on the next run, three times, then listed with the reason; a person can put it back", async () => {
    await newProduct("AK-0998", { name_en: "Thing 200 g", brand: "Thing", barcode: "6221234567890" });
    const client = { messages: { create: async () => { throw Object.assign(new Error("overloaded"), { status: 529 }); } } };
    for (const [i, want] of [[1, "ready"], [2, "ready"], [3, "listed"]]) {
      const run = await runIntake(deps(`run-f${i}`, client), { maxJobs: 15 });
      expect(run.jobs).toHaveLength(1);                                  // a job that failed in this run is not taken again in it
      expect(run.jobs[0]).toMatchObject({ sku: "AK-0998", step: "identity", outcome: "failed", status: want });
    }
    const list = await db.rpc("intake_review_list", {});
    expect(list).toEqual([expect.objectContaining({ sku: "AK-0998", step: "identity", attempts: 3, reason: "overloaded" })]);
    expect((await runIntake(deps("run-f4", client), { maxJobs: 15 })).jobs).toEqual([]);
    await expect(db.rpc("retry_intake_job", { p_job: list[0].job_id, p_by: (await db.one(`insert into parties(role) values ('picker') returning id`)).id })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await db.rpc("retry_intake_job", { p_job: list[0].job_id, p_by: lead })).toMatchObject({ ok: true, step: "identity" });
    expect(await steps("AK-0998")).toMatchObject({ identity: "ready" });
    await db.pg.exec(`update product_intake_jobs set status = 'done' where product_id = (select id from products where sku = 'AK-0998') and step = 'identity'`);
  });

  it("a model answer with no research file, or a file for another item, is a failure, never a guess", async () => {
    await newProduct("AK-0996", { name_en: "Other 100 g", brand: "Other", barcode: "6229999999990" });
    const client = { messages: { create: async () => answer(fileFor("AK-0001")) } };
    const run = await runIntake(deps("run-x", client), { maxJobs: 1 });
    expect(run.jobs[0]).toMatchObject({ outcome: "failed", error: "research: sku_does_not_match" });
    await db.pg.exec(`update product_intake_jobs set status = 'done' where product_id = (select id from products where sku = 'AK-0996') and step = 'identity'`);
  });

  it("stops taking jobs once the run's spend passes the cap, takes at most max-jobs, and records minutes and spend", async () => {
    for (let i = 0; i < 5; i++) await newProduct(`AK-099${i}`, { name_en: `Item ${i} 100 g`, brand: "Item", barcode: `622000000000${i}` });
    const dear = { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 30 } };     // 0.30 USD a call
    const client = { messages: { create: async (body) => answer(fileFor(/"sku": "(AK-\d{4})"/.exec(body.messages[0].content)[1]), dear) } };
    const run = await runIntake(deps("run-cap", client), { maxJobs: 15, maxSpend: 0.75 });
    expect(run.jobs.map((j) => j.step)).toEqual(["identity", "identity", "identity"]);
    expect(run.spend_usd).toBeCloseTo(0.9, 6);
    expect(run.stopped).toMatch(/^spend_cap/);
    expect(await db.one(`select spend_usd::float as s, jobs_taken, stopped from intake_runs where run_id = 'run-cap'`)).toMatchObject({ s: 0.9, jobs_taken: 3 });
    const cheap = { messages: { create: async (body) => answer(fileFor(/"sku": "(AK-\d{4})"/.exec(body.messages[0].content)[1])) } };
    expect((await runIntake(deps("run-two", cheap), { maxJobs: 2 })).jobs).toHaveLength(2);
  });

  it("a refused key stops the run at once and costs the job no attempt", async () => {
    await db.pg.exec(`update product_intake_jobs set status = 'done' where status = 'ready'`);
    await newProduct("AK-0989", { name_en: "Key 100 g", brand: "Key", barcode: "6221111111110" });
    const client = { messages: { create: async () => { throw Object.assign(new Error("invalid x-api-key"), { status: 401 }); } } };
    const run = await runIntake(deps("run-401", client), { maxJobs: 15 });
    expect(run.stopped).toMatch(/^fatal: model_http_401/);
    expect(run.jobs).toEqual([expect.objectContaining({ outcome: "released" })]);
    const j = await db.one(`select status, attempts from product_intake_jobs where step = 'identity' and status = 'ready' order by updated_at desc limit 1`);
    expect(j).toMatchObject({ status: "ready", attempts: 0 });
  });
});
