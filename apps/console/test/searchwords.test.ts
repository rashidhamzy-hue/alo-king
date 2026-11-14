// 1.23 review list (session D3): B4's search-word job (0076) puts an item whose phrasings did not find it on search_word_reviews;
// the console lists them with what the planner did, a lead marks one done or builds the item's words again (0080), and the
// items whose job failed three times are listed beside them.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());

async function addProduct(sku: string, name: string, brand: string) {
  const p = await r.db.one(`insert into products(sku, name_en, brand, category, sub_type) values ($1, $2, $3, 'Beverages', 'juice') returning id`, [sku, name, brand]);
  await r.db.pg.query(`insert into offers(source_id, product_id, price_usd) values ($1, $2, 1.5)`, [r.source, p.id]);
  await r.db.pg.query(`insert into stock_levels(source_id, product_id, on_hand) values ($1, $2, 40)`, [r.source, p.id]);
  return p.id as string;
}

beforeAll(async () => {
  r = await rig();
  await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); update stock_levels set on_hand = 50;`);
}, 120_000);

describe("Search words review list", () => {
  it("lists a phrasing that did not find its item with what the planner did; a lead marks it done once", async () => {
    const id = await addProduct("AK-D301", "Hayat Mango Juice 1L", "Hayat");
    await r.db.rpc("save_search_words", { p_sku: "AK-D301", p_rows: [{ term: "عصير مانغا", level: "kind", lang: "ar" }, { term: "hayat mango", level: "exact", lang: "en" }], p_version: "t" });
    // what the job does after writing the words: the phrasings through the planner, no model
    const out = await r.db.rpc("check_search_words", { p_sku: "AK-D301", p_phrasings: ["hayat mango", "بدي عصير حياة"] });
    expect(out.ok).toBe(1);

    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get("/search-words")).text;
    expect(page).toContain("Phrasings that did not find their item (1)");
    expect(page).toContain(`<a href="/catalog/${id}">Hayat Mango Juice 1L</a>`);
    expect(page).toContain("بدي عصير حياة");
    expect(page).toContain("hayat mango <small>(exact, en)</small>");     // the item's words, to see what is missing
    expect(page).toMatch(/asked which one|found nothing|picked another item/);
    expect(page).not.toContain("<td>hayat mango</td>");                   // the phrasing that resolved is not listed

    const review = (await r.db.one(`select id from search_word_reviews where sku = 'AK-D301' and status = 'open'`)).id;
    expect(flashOf((await b.post(`/search-words/${review}/done`)).text)).toBe("Marked done.");
    expect(await r.db.one(`select status, resolved_by from search_word_reviews where id = $1`, [review])).toEqual({ status: "resolved", resolved_by: lead.partyId });
    expect(flashOf((await b.post(`/search-words/${review}/done`)).text)).toBe("Already done.");
    page = (await b.get("/search-words")).text;
    expect(page).toContain("Nothing to review.");
    expect(page).toMatch(/<td><a href="\/catalog\/[^"]+">Hayat Mango Juice 1L<\/a><\/td><td>بدي عصير حياة<\/td><td>Maya<\/td>/);
    expect(r.media.audit().some((a) => a.action === "search_word_review_done" && a.phase === "done" && a.ok && a.party_id === lead.partyId)).toBe(true);
  });

  it("builds an item's words again: its open phrasings close and a job is queued; a failed job is listed and retried", async () => {
    await addProduct("AK-D302", "Hayat Guava Juice 1L", "Hayat");
    await r.db.pg.exec(`update search_word_jobs set status = 'done' where sku = 'AK-D302'`);
    await r.db.rpc("check_search_words", { p_sku: "AK-D302", p_phrasings: ["بدي عصير حياة", "guava please"] });
    await addProduct("AK-D303", "Hayat Lemon Juice 1L", "Hayat");
    await r.db.pg.exec(`update search_word_jobs set status = 'failed', attempts = 3, done_at = now(), last_error = 'model gave no terms' where sku = 'AK-D303'`);

    const lead = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get("/search-words")).text;
    expect(page).toContain("Items whose words could not be built (1)");
    expect(page).toContain("model gave no terms");
    expect(page).toContain("Its words: none yet");
    // A phrasing that finds nothing lands here too (0080: it used to fail the whole job).
    expect(page).toContain("<td>guava please</td><td>found nothing</td>");

    let res = await b.post(`/search-words/item/AK-D302/rebuild`);
    expect(flashOf(res.text)).toBe("Queued: its words are built again within a few minutes. 2 phrasings closed.");
    expect(await r.db.one(`select reason, status, attempts from search_word_jobs where sku = 'AK-D302'`)).toEqual({ reason: "manual", status: "pending", attempts: 0 });
    expect(Number((await r.db.one(`select count(*) as n from search_word_reviews where sku = 'AK-D302' and status = 'open'`)).n)).toBe(0);

    res = await b.post(`/search-words/item/AK-D303/rebuild`);
    expect(flashOf(res.text)).toBe("Queued: its words are built again within a few minutes.");
    expect(await r.db.one(`select status, attempts, last_error from search_word_jobs where sku = 'AK-D303'`)).toEqual({ status: "pending", attempts: 0, last_error: null });
    page = (await b.get("/search-words")).text;
    expect(page).toContain("Items whose words could not be built (0)");
    expect(page).toContain("3 items waiting for words.");     // and AK-D301, queued when it was added

    // A job running right now is not queued twice.
    await r.db.pg.exec(`update search_word_jobs set status = 'running', started_at = now() where sku = 'AK-D303'`);
    expect(flashOf((await b.post(`/search-words/item/AK-D303/rebuild`)).text)).toBe("Its words are being built right now; nothing was queued twice.");
    // An item that is not on sale gets no words.
    await r.db.pg.exec(`update products set is_active = false where sku = 'AK-D303'`);
    expect(flashOf((await b.post(`/search-words/item/AK-D303/rebuild`)).text)).toBe("That item is not on sale (or has no SKU), so it gets no search words.");
    expect(flashOf((await b.post(`/search-words/item/${encodeURIComponent("AK D303<")}/rebuild`)).text)).toBe("That item is not valid.");
  });

  it("pickers cannot open it, and the database refuses them too", async () => {
    const picker = await r.staff("picker");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/search-words")).status).toBe(403);
    expect((await p.get("/")).text).not.toContain('href="/search-words"');
    await expect(r.db.rpc("rerun_search_words", { p_sku: "AK-D302", p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
    const review = await r.db.one(`select id from search_word_reviews limit 1`);
    await expect(r.db.rpc("resolve_search_word_review", { p_review: review.id, p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
