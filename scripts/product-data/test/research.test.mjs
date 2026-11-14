// Session P2: the research loader against the real migrations (PGlite). The network, the storage bucket and the model are
// replaced; the SQL is the SQL that ships, and the picture path runs P1's own evaluate() and decide().
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";
import { readResearch, pictureCandidates, buildWebFacts, codesForName, clauseFor, per100, httpsUrl } from "../lib/research.mjs";
import { loadFile, plan, summarise, reportLines } from "../load-research.mjs";
import { proposeFromResearch } from "../../images/research-pictures.mjs";
import { Fatal } from "../../images/fetch-images.mjs";
import { customerUsable } from "../../images/lib/licence.mjs";

const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no", seen: "x" };
const PAGE = "https://shop.example.com/p/1";
const full = (sku, over = {}) => ({
  sku,
  matched: { brand: "Brand", product: "Thing", size: "200 g", barcode: "", confidence: "exact", note: "" },
  pictures: [
    { image_url: "https://cdn.example.com/a.jpg", page_url: PAGE, site: "Shop", site_kind: "retailer", looks: "one pack" },
    { image_url: "https://cdn.example.com/b.jpg", page_url: "https://brand.example.com/thing", site: "Brand", site_kind: "brand", looks: "one pack" },
  ],
  ingredients: { text: "Wheat flour, sugar, milk powder, hazelnuts 13%", language: "en", page_url: PAGE, market: "Lebanon" },
  allergens: { contains: ["wheat", "milk", "hazelnuts"], may_contain: ["soy"], quote: "Contains: wheat, milk, hazelnuts. May contain traces of soy.", page_url: PAGE },
  nutrition: { per: "100 g", energy_kcal: 530, fat_g: 30, saturated_fat_g: 10, carbohydrate_g: 57, sugars_g: 50, fibre_g: 3, protein_g: 6, salt_g: 0.1, sodium_mg: 40, page_url: PAGE },
  diet_labels: [{ label: "halal", basis: "Halal certified logo on the back of the pack", page_url: PAGE }],
  storage: { text: "Store in a cool, dry place.", page_url: PAGE },
  origin: { country: "Italy", page_url: PAGE },
  ...over,
});
const text = (f) => JSON.stringify(f, null, 2);

let db; let items; let lead; let uploads;
const state = async () => new Map((await db.rpc("research_load_state")).map((i) => [i.sku, i]));
const mk = (over = {}) => {
  const calls = { check: 0, download: 0 };
  const pd = {
    runId: "run-1", model: "fast-model", sharp: null,
    download: async (u) => { calls.download++; return Buffer.from(u); },
    measure: async () => ({ width: 1000, height: 1000, format: "jpeg" }),
    shrink: async (buf) => ({ data: buf, width: 1000, height: 1000, bytes: buf.length, sha256: Buffer.from(buf).toString("hex").slice(-40).padStart(64, "0") }),
    check: async () => { calls.check++; return GOOD; },
    store: { async rpc(fn, a) { return db.rpc(fn, a); }, async upload(path) { uploads.push(path); } },
    ...over };
  const d = { store: pd.store, runId: pd.runId, pictures: (item, c, meta) => proposeFromResearch(item, c, pd, meta) };
  return { d, calls };
};

beforeAll(async () => {
  db = await openTestDb();
  items = (await db.rpc("research_load_state")).filter((i) => i.barcode).slice(0, 14);
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead') returning id`)).id;
  uploads = [];
});

describe("reading a research file", () => {
  it("the file name and the sku inside must agree; anything else is not loaded", () => {
    expect(readResearch("AK-0001.json", text(full("AK-0001")))).toMatchObject({ ok: true, sku: "AK-0001" });
    expect(readResearch("AK-0001.json", text(full("AK-0002")))).toMatchObject({ ok: false, reason: "sku_does_not_match_file_name" });
    expect(readResearch("README.md", "{}")).toMatchObject({ ok: false });
    expect(readResearch("AK-0001.json", "{ not json")).toMatchObject({ ok: false, reason: "not_json" });
    expect(readResearch("AK-0001.json", "[]")).toMatchObject({ ok: false });
  });

  it("addresses must be https on a public host", () => {
    expect(httpsUrl("https://a.example.com/x.jpg")).toBe("https://a.example.com/x.jpg");
    for (const bad of ["http://a.example.com/x", "https://127.0.0.1/x", "https://localhost/x", "file:///etc/passwd", "https://a.internal/x", "javascript:alert(1)", "", null, 7]) expect(httpsUrl(bad)).toBeNull();
  });

  it("at most five pictures, each with its picture address and its page; the rest are dropped with a reason", () => {
    const pics = Array.from({ length: 7 }, (_, i) => ({ image_url: `https://cdn.example.com/${i}.jpg`, page_url: PAGE, site_kind: "retailer" }));
    pics[1] = { image_url: "https://cdn.example.com/1.jpg" };                       // no page
    pics[2] = { image_url: "http://cdn.example.com/2.jpg", page_url: PAGE };          // not https
    const { candidates, dropped } = pictureCandidates({ pictures: pics });
    expect(candidates.map((c) => c.imageUrl)).toEqual([0, 3, 4, 5, 6].map((i) => `https://cdn.example.com/${i}.jpg`));
    expect(candidates.every((c) => c.sourceKind === "public_page" && c.pageUrl === PAGE)).toBe(true);
    expect(dropped.map((x) => x.reason).sort()).toEqual(["no_https_page_address", "no_https_picture_address"]);
    expect(pictureCandidates({}).candidates).toEqual([]);
  });
});

describe("facts from a file (no model, only what the file states)", () => {
  const build = (over, product = { sku: "AK-0001", barcode: null }) => buildWebFacts({ file: full("AK-0001", over), sha: "0".repeat(64), product, runId: "r", loadedAt: "2026-11-14T00:00:00Z" });
  const by = (r) => Object.fromEntries(r.facts.map((f) => [f.attribute, f]));

  it("every value carries its page address and its market", () => {
    const r = build({});
    expect(r.facts.map((f) => f.attribute).sort()).toEqual(["gluten", "halal", "ingredients", "milk", "nutrition", "origin", "soy", "storage", "tree_nuts"]);
    for (const f of r.facts) {
      expect(f.detail.page_url).toBe(PAGE);
      expect(f.detail.market).toBe("Lebanon");               // written on the ingredients block; the other blocks are on the same page
      expect(f.detail.source_text).toBeTruthy();
      expect(f.detail.fingerprint).toMatch(/^[0-9a-f]{24}$/);
      expect(f.detail.source_file).toBe("data/research/AK-0001.json");
    }
    const other = build({ nutrition: { per: "100 g", energy_kcal: 100, page_url: "https://other.example.com/x" } });
    expect(by(other).nutrition.detail.market).toBeNull();     // another page: its market is not assumed
  });

  it("allergens: only with the literal quote, only what the quote says, never free", () => {
    const f = by(build({}));
    expect(f.gluten).toMatchObject({ value: "contains", detail: { quote: "Contains: wheat, milk, hazelnuts", named_as: "wheat" } });
    expect(f.milk.value).toBe("contains");
    expect(f.tree_nuts.value).toBe("contains");
    expect(f.soy).toMatchObject({ value: "may_contain", detail: { quote: "May contain traces of soy" } });

    const noQuote = build({ allergens: { contains: ["milk"], may_contain: [], quote: "", page_url: PAGE } });
    expect(by(noQuote).milk).toBeUndefined();
    expect(noQuote.rejected).toContainEqual(expect.objectContaining({ kind: "allergen", reason: "no_literal_quote" }));

    // The file lists an allergen its quote does not mention, and files a "may contain" as "contains".
    const wrong = build({ allergens: { contains: ["milk", "eggs", "soy"], may_contain: [], quote: "Contains milk. May contain soy.", page_url: PAGE } });
    expect(Object.keys(by(wrong)).filter((k) => ["milk", "eggs", "soy"].includes(k))).toEqual(["milk"]);
    expect(wrong.rejected).toContainEqual(expect.objectContaining({ code: "eggs", reason: "quote_does_not_say_contains" }));
    expect(wrong.rejected).toContainEqual(expect.objectContaining({ code: "soy", reason: "quote_does_not_say_contains" }));

    // "Gluten free" in the quote is never read as gluten.
    const free = build({ allergens: { contains: ["gluten"], may_contain: [], quote: "Gluten free. Contains milk.", page_url: PAGE } });
    expect(by(free).gluten).toBeUndefined();
    expect(build({ allergens: { contains: ["coconut"], may_contain: [], quote: "Contains coconut.", page_url: PAGE } }).rejected)
      .toContainEqual(expect.objectContaining({ reason: "not_in_our_vocabulary" }));
    expect(r_values(build({}))).not.toContain("free");
  });
  const r_values = (r) => r.facts.map((f) => f.value);

  it("names map onto our fourteen codes by a fixed word list", () => {
    expect(codesForName("milk")).toEqual(["milk"]);
    expect(codesForName("Tree nuts")).toEqual(["tree_nuts"]);
    expect(codesForName("peanuts")).toEqual(["peanuts"]);
    expect(codesForName("wheat")).toEqual(["gluten"]);
    expect(codesForName("sugar")).toEqual([]);
    expect(clauseFor("milk", "contains", "May contain milk")).toBeNull();
    expect(clauseFor("milk", "may_contain", "Made in a facility that also handles milk")).toBeTruthy();
    expect(clauseFor("milk", "contains", "Does not contain milk")).toBeNull();
    expect(clauseFor("milk", "contains", "يحتوي على حليب")).toBeTruthy();
  });

  it("nutrition: the stated per-100 numbers; a per-serving panel is not converted, an implausible one is refused", () => {
    const n = by(build({})).nutrition.detail;
    expect(n).toMatchObject({ per: "100g", values: { energy_kcal: 530, fat: 30, saturated_fat: 10, carbohydrates: 57, sugars: 50, fiber: 3, proteins: 6, salt: 0.1, sodium_mg: 40 } });
    expect(per100("100 ml")).toBe("100ml");
    expect(per100("serving (30 g)")).toBeNull();
    const serving = build({ nutrition: { per: "serving (30 g)", energy_kcal: 150, page_url: PAGE } });
    expect(by(serving).nutrition).toBeUndefined();
    expect(serving.rejected).toContainEqual({ kind: "nutrition", reason: "per_serving_not_converted" });
    expect(build({ nutrition: { per: "100 g", energy_kcal: 530, fat_g: 130, page_url: PAGE } }).rejected).toContainEqual({ kind: "nutrition", reason: "implausible:fat" });
    expect(by(build({ nutrition: { per: "100 g", energy_kcal: null, fat_g: null, page_url: PAGE } })).nutrition).toBeUndefined();   // nulls are not zeros
  });

  it("diet labels: halal, vegetarian, vegan as the pack's own claim; free statements and organic are reported, not proposed", () => {
    const r = build({ diet_labels: [
      { label: "halal", basis: "Halal logo", page_url: PAGE }, { label: "vegan", basis: "Suitable for everyone", page_url: PAGE },
      { label: "vegetarian", basis: "", page_url: PAGE }, { label: "gluten_free", basis: "Gluten free", page_url: PAGE },
      { label: "organic", basis: "EU organic leaf", page_url: PAGE }, { label: "fasting", basis: "siyami", page_url: PAGE }, { label: "healthy", basis: "healthy", page_url: PAGE }] });
    const f = by(r);
    expect(f.halal).toMatchObject({ value: "yes", detail: { quote: "Halal logo", source_text: "Halal logo" } });
    expect(f.vegan).toBeUndefined(); expect(f.vegetarian).toBeUndefined(); expect(f.fasting).toBeUndefined();
    const why = Object.fromEntries(r.rejected.filter((x) => x.kind === "diet").map((x) => [x.label, x.reason]));
    expect(why).toMatchObject({ vegan: "basis_does_not_name_the_label", vegetarian: "no_basis", gluten_free: "free_statement_recorded_from_the_pack", organic: "no_such_attribute", fasting: "unknown_label", healthy: "unknown_label" });
  });

  it("an unsure match gives no facts; a value with no page gives none; the barcode comparison travels with the proposal", () => {
    expect(build({ matched: { confidence: "unsure" } }).facts).toEqual([]);
    expect(build({ matched: undefined }).facts).toEqual([]);
    const noPage = build({ storage: { text: "Keep cold", page_url: "" }, origin: { country: "Italy", page_url: "http://x.example.com" } });
    expect(by(noPage).storage).toBeUndefined(); expect(by(noPage).origin).toBeUndefined();
    const r = build({ matched: { confidence: "likely", barcode: "0 5281234 567890" } }, { sku: "AK-0001", barcode: "5281234567890" });
    expect(r.facts[0].detail.matched).toMatchObject({ confidence: "likely", barcode_matches_catalog: true });
    expect(build({ matched: { confidence: "exact", barcode: "111" } }, { sku: "AK-0001", barcode: "5281234567890" }).match.barcode_matches_catalog).toBe(false);
  });
});

describe("the loader against the real migrations", () => {
  it("a full file: the first passing picture is proposed as public_page with both addresses, and every fact is a web_page proposal", async () => {
    const it0 = items[0]; const { d, calls } = mk();
    const r = await loadFile(`${it0.sku}.json`, text(full(it0.sku)), await state(), d);
    expect(r).toMatchObject({ sku: it0.sku, picture: { outcome: "proposed" }, facts: { outcome: "proposed" } });
    expect(calls.check).toBe(1);                                                   // best first: the second candidate is never fetched
    const img = await db.one(`select * from product_images where product_id = $1`, [it0.product_id]);
    expect(img).toMatchObject({ status: "proposed", source_kind: "public_page", licence: "public_page", source_url: "https://cdn.example.com/a.jpg", page_url: PAGE, reviewed_by: null });
    expect(img.media_path).toBe(uploads.at(-1));
    expect(img.vision).toMatchObject({ site_kind: "retailer", source_file: `data/research/${it0.sku}.json`, model: "fast-model" });
    expect(await db.rpc("product_image_for_customer", { p_product: it0.product_id })).toBeNull();          // proposed: no customer sees it
    expect(customerUsable("public_page")).toBe(true);

    const facts = await db.all(`select * from product_facts where product_id = $1 and source = 'web_page'`, [it0.product_id]);
    expect(facts.map((f) => f.attribute).sort()).toEqual(["gluten", "halal", "ingredients", "milk", "nutrition", "origin", "soy", "storage", "tree_nuts"]);
    for (const f of facts) {
      expect(f).toMatchObject({ status: "partial", source: "web_page", approved_at: null, approved_by: null, proposed_by: null });
      expect(f.detail).toMatchObject({ page_url: PAGE, market: "Lebanon", proposal_only: true });
    }
    expect(facts.find((f) => f.attribute === "origin").detail.text).toBe("Italy");
    expect(await db.rpc("product_food_facts", { p_product: it0.product_id })).toEqual([]);                  // nothing may be said to a customer
    const meets = await db.rpc("product_meets_restrictions", { p_product: it0.product_id, p_restrictions: ["halal", "milk"] });
    expect(meets.meets).toBe(false);
    expect(meets.checks.every((c) => c.result === "unknown")).toBe(true);                                   // a proposal decides nothing
    expect((await db.rpc("food_fact_review_queue")).find((x) => x.product_id === it0.product_id)).toMatchObject({ from_web_page: 9, from_staff: 0 });
  });

  it("nothing from a web page can be approved, by the function or by hand; a person approves a picture", async () => {
    const it0 = items[0];
    const f = await db.one(`select id from product_facts where product_id = $1 and source = 'web_page' and attribute = 'milk'`, [it0.product_id]);
    await expect(db.rpc("approve_product_fact", { p_fact: f.id, p_by: lead })).rejects.toThrow(/product_facts_web_page_never_approved/);
    await expect(db.pg.query(`update product_facts set approved_at = now(), approved_by = $2 where id = $1`, [f.id, lead])).rejects.toThrow(/never_approved/);
    await expect(db.pg.query(`update product_facts set status = 'declared' where id = $1`, [f.id])).rejects.toThrow(/never_approved/);
    expect((await db.rpc("research_load_coverage")).approved_from_web_page).toBe(0);

    const img = await db.one(`select id from product_images where product_id = $1 and status = 'proposed'`, [it0.product_id]);
    expect(await db.rpc("review_product_image", { p_image: img.id, p_by: lead, p_decision: "approve" })).toMatchObject({ status: "approved", customer_visible: true });
    expect(await db.rpc("product_image_for_customer", { p_product: it0.product_id })).toMatchObject({ image_id: img.id, licence: "public_page", source_url: "https://cdn.example.com/a.jpg" });
    // Withdrawn at once when someone objects.
    await db.rpc("review_product_image", { p_image: img.id, p_by: lead, p_decision: "reject", p_note: "rights holder objected" });
    expect(await db.rpc("product_image_for_customer", { p_product: it0.product_id })).toBeNull();
  });

  it("the database refuses a web fact that breaks a rule, and a public-page picture without its page", async () => {
    const p = items[1].product_id;
    const ok = { page_url: PAGE, market: null, source_text: "Contains milk", quote: "Contains milk", fingerprint: "fp" };
    const tryOne = (attribute, value, detail) => db.rpc("propose_web_facts", { p_product: p, p_run: "r", p_facts: [{ attribute, value, detail }] });
    await expect(tryOne("milk", "free", ok)).rejects.toThrow(/WEB_NEVER_SAYS_FREE/);
    await expect(tryOne("milk", "contains", { ...ok, quote: "Contains eggs" })).rejects.toThrow(/QUOTE_NOT_IN_SOURCE/);
    await expect(tryOne("milk", "contains", { ...ok, page_url: "http://x.example.com" })).rejects.toThrow(/WEB_NO_PAGE_ADDRESS/);
    await expect(tryOne("milk", "contains", { page_url: PAGE, source_text: "Contains milk", quote: "Contains milk", fingerprint: "fp" })).rejects.toThrow(/WEB_NO_MARKET_FIELD/);
    await expect(tryOne("halal", "no", ok)).rejects.toThrow(/WEB_DIET_VALUE/);
    await expect(tryOne("fasting", "yes", ok)).rejects.toThrow(/WEB_NEVER_SAYS_FASTING/);
    await expect(tryOne("ingredients", "yes", ok)).rejects.toThrow(/WEB_VALUE_NOT_ALLOWED/);
    await expect(tryOne("ingredients", null, { ...ok, source_text: " " })).rejects.toThrow(/WEB_NO_SOURCE_TEXT/);
    // One bad fact saves nothing for that product.
    await expect(db.rpc("propose_web_facts", { p_product: p, p_run: "r", p_facts: [{ attribute: "milk", value: "contains", detail: ok }, { attribute: "eggs", value: "free", detail: ok }] })).rejects.toThrow();
    expect((await db.one(`select count(*)::int as n from product_facts where product_id = $1 and source = 'web_page'`, [p])).n).toBe(0);

    const pic = { p_product: p, p_source_kind: "public_page", p_source_url: "https://cdn.example.com/x.jpg", p_page_url: null, p_attribution: null,
      p_media_path: "product_images/x/1.jpg", p_sha256: "s1", p_width: 1000, p_height: 1000, p_bytes: 1000 };
    await expect(db.rpc("propose_product_image", pic)).rejects.toThrow(/PUBLIC_PAGE_NEEDS_ADDRESSES/);
    await expect(db.pg.query(`insert into product_images(product_id, source_kind, licence, source_url, media_path, sha256, width_px, height_px, bytes)
      values ($1, 'public_page', 'public_page', 'https://cdn.example.com/x.jpg', 'm', 's', 1, 1, 1)`, [p])).rejects.toThrow(/public_page_has_page/);
    // The source still decides the licence: a search result cannot be filed as a public page, and unknown is still not shown.
    await expect(db.pg.query(`insert into product_images(product_id, source_kind, licence, source_url, page_url, media_path, sha256, width_px, height_px, bytes)
      values ($1, 'web_search', 'public_page', 'https://a.example.com/x', 'https://a.example.com/p', 'm', 's', 1, 1, 1)`, [p])).rejects.toThrow(/source_licence/);
    expect(await db.one(`select product_image_licence_usable('unknown') as u, product_image_licence_usable('public_page') as p`)).toEqual({ u: false, p: true });
  });

  it("a second run of the same file does nothing: no download, no model call, no new row", async () => {
    const it2 = items[2]; const first = mk();
    await loadFile(`${it2.sku}.json`, text(full(it2.sku)), await state(), first.d);
    const before = await db.one(`select (select count(*)::int from product_facts where product_id = $1) as facts, (select count(*)::int from product_images where product_id = $1) as pics`, [it2.product_id]);
    const again = mk();
    const r = await loadFile(`${it2.sku}.json`, text(full(it2.sku)), await state(), again.d);
    expect(r).toMatchObject({ picture: { outcome: "skip:has_picture" }, facts: { outcome: "skip:loaded_proposed" } });
    expect(again.calls).toEqual({ check: 0, download: 0 });
    expect(await db.one(`select (select count(*)::int from product_facts where product_id = $1) as facts, (select count(*)::int from product_images where product_id = $1) as pics`, [it2.product_id])).toEqual(before);
  });

  it("an edited file is loaded again: unchanged values are not re-proposed, a changed one replaces its proposal and keeps the old", async () => {
    const it2 = items[2]; const { d } = mk();
    const edited = full(it2.sku, { storage: { text: "Refrigerate after opening.", page_url: PAGE }, origin: undefined });
    const r = await loadFile(`${it2.sku}.json`, text(edited), await state(), d);
    expect(r.facts).toMatchObject({ outcome: "proposed", proposed: ["storage"] });
    const rows = await db.all(`select detail->>'text' as t, superseded_at is not null as old, superseded_by is not null as linked from product_facts where product_id = $1 and attribute = 'storage' order by proposed_at, id`, [it2.product_id]);
    expect(rows).toEqual([{ t: "Store in a cool, dry place.", old: true, linked: true }, { t: "Refrigerate after opening.", old: false, linked: false }]);
    expect((await db.one(`select count(*)::int as n from product_facts where product_id = $1 and attribute = 'origin' and superseded_at is null`, [it2.product_id])).n).toBe(1);   // leaving a block out withdraws nothing
  });

  it("a proposal a person set aside is not proposed again from the same reading; an approved fact is never touched", async () => {
    const it3 = items[3]; const { d } = mk();
    await loadFile(`${it3.sku}.json`, text(full(it3.sku)), await state(), d);
    const milk = await db.one(`select id from product_facts where product_id = $1 and attribute = 'milk' and source = 'web_page'`, [it3.product_id]);
    await db.rpc("review_proposed_fact", { p_fact: milk.id, p_by: lead, p_decision: "reject", p_note: "not on the pack" });
    // The lead records halal from the pack itself (label photo as evidence): that fact is approved and is the pack's.
    const ev = await db.rpc("add_evidence_document", { p_product: it3.product_id, p_kind: "label_photo", p_media_path: "label_scans/x.jpg", p_by: lead });
    const halal = await db.one(`select id from product_facts where product_id = $1 and attribute = 'halal' and source = 'web_page'`, [it3.product_id]);
    const confirmed = await db.rpc("review_proposed_fact", { p_fact: halal.id, p_by: lead, p_decision: "confirm", p_value: "yes", p_status: "declared", p_evidence: ev });
    expect((await db.one(`select source, approved_at is not null as approved from product_facts where id = $1`, [confirmed.fact_id]))).toEqual({ source: "label", approved: true });

    const r = await loadFile(`${it3.sku}.json`, text(full(it3.sku, { storage: { text: "Keep dry.", page_url: PAGE } })), await state(), mk().d);
    expect(r.facts.proposed).toEqual(["storage"]);
    const load = await db.one(`select detail from research_loads where product_id = $1 and part = 'facts' order by created_at desc, id desc limit 1`, [it3.product_id]);
    expect(load.detail.skipped).toMatchObject({ milk: "unchanged", halal: "approved_exists" });
    expect((await db.one(`select count(*)::int as n from product_facts where product_id = $1 and attribute = 'milk' and superseded_at is null`, [it3.product_id])).n).toBe(0);
    expect((await db.one(`select count(*)::int as n from product_facts where source = 'web_page' and approved_at is not null`)).n).toBe(0);
  });

  it("pictures: a failing candidate is passed over for the next; none passing is recorded and not asked again; a rejected picture is never re-proposed", async () => {
    const a = items[4]; uploads = [];
    const second = mk({ check: async (_i, jpeg) => (jpeg.toString().includes("a.jpg") ? { ...GOOD, price_tag_or_shop_logo: "yes" } : GOOD) });
    expect((await loadFile(`${a.sku}.json`, text(full(a.sku)), await state(), second.d)).picture).toMatchObject({ outcome: "proposed", reasons: ["price_or_logo"] });
    expect((await db.one(`select source_url, page_url from product_images where product_id = $1`, [a.product_id]))).toEqual({ source_url: "https://cdn.example.com/b.jpg", page_url: "https://brand.example.com/thing" });

    const b = items[5];
    const none = mk({ check: async () => ({ ...GOOD, same_size: "cannot_tell" }) });
    expect((await loadFile(`${b.sku}.json`, text(full(b.sku)), await state(), none.d)).picture).toMatchObject({ outcome: "none_passed", reasons: ["size", "size"] });
    const again = mk();
    expect((await loadFile(`${b.sku}.json`, text(full(b.sku)), await state(), again.d)).picture.outcome).toBe("skip:loaded_none_passed");
    expect(again.calls.check).toBe(0);
    expect(await db.one(`select count(*)::int as n from product_images where product_id = $1`, [b.product_id])).toEqual({ n: 0 });

    // A person rejects the proposed picture: the next run offers the next candidate, never the rejected one.
    const c = items[6]; const run1 = mk();
    await loadFile(`${c.sku}.json`, text(full(c.sku)), await state(), run1.d);
    const img = await db.one(`select id from product_images where product_id = $1 and status = 'proposed'`, [c.product_id]);
    await db.rpc("review_product_image", { p_image: img.id, p_by: lead, p_decision: "reject", p_note: "shop logo" });
    expect((await loadFile(`${c.sku}.json`, text(full(c.sku)), await state(), mk().d)).picture.outcome).toBe("proposed");
    const rows = await db.all(`select source_url, status from product_images where product_id = $1 order by fetched_at, id`, [c.product_id]);
    expect(rows.map((x) => [x.source_url.slice(-5), x.status])).toEqual([["a.jpg", "rejected"], ["b.jpg", "proposed"]]);
    const img2 = await db.one(`select id from product_images where product_id = $1 and status = 'proposed'`, [c.product_id]);
    await db.rpc("review_product_image", { p_image: img2.id, p_by: lead, p_decision: "reject" });
    expect((await loadFile(`${c.sku}.json`, text(full(c.sku)), await state(), mk().d)).picture.outcome).toBe("skipped_rejected");
    expect((await loadFile(`${c.sku}.json`, text(full(c.sku)), await state(), mk().d)).picture.outcome).toBe("skip:loaded_skipped_rejected");
  });

  it("a picture that cannot be fetched is an error and is tried again; a narrow one is refused without the model; a refused key stops the run", async () => {
    const a = items[7];
    const down = mk({ download: async () => { throw new Error("download_403"); } });
    const r = await loadFile(`${a.sku}.json`, text(full(a.sku)), await state(), down.d);
    expect(r.picture).toMatchObject({ outcome: "error" });
    expect(r.facts.outcome).toBe("proposed");                                        // the facts do not wait for the picture
    expect(plan((await state()).get(a.sku), readResearch(`${a.sku}.json`, text(full(a.sku))).sha)).toEqual({ picture: "run", facts: "skip:loaded_proposed" });

    const b = items[8];
    const narrow = mk({ measure: async () => ({ width: 640, height: 640, format: "jpeg" }) });
    expect((await loadFile(`${b.sku}.json`, text(full(b.sku)), await state(), narrow.d)).picture).toMatchObject({ outcome: "none_passed", reasons: ["narrow", "narrow"] });
    expect(narrow.calls.check).toBe(0);

    const c = items[9];
    const refused = mk({ check: async () => { throw new Error("vision_http_401"); } });
    await expect(loadFile(`${c.sku}.json`, text(full(c.sku)), await state(), refused.d)).rejects.toBeInstanceOf(Fatal);
  });

  it("an item that already has a usable picture is not given another; a picture-only file and an unsure match are recorded as such", async () => {
    const a = items[10];
    await db.rpc("propose_product_image", { p_product: a.product_id, p_source_kind: "open_food_facts", p_source_url: "https://images.openfoodfacts.org/x.jpg", p_page_url: null,
      p_attribution: "Open Food Facts contributors, CC BY-SA 3.0", p_media_path: "product_images/x/off.jpg", p_sha256: "off", p_width: 1000, p_height: 1000, p_bytes: 1000 });
    const has = mk();
    expect((await loadFile(`${a.sku}.json`, text(full(a.sku)), await state(), has.d)).picture.outcome).toBe("skip:has_picture");
    expect(has.calls.download).toBe(0);

    const b = items[11];
    const produce = { sku: b.sku, matched: { confidence: "likely" }, pictures: full(b.sku).pictures, not_found: ["ingredients", "nutrition"] };
    expect(await loadFile(`${b.sku}.json`, text(produce), await state(), mk().d)).toMatchObject({ picture: { outcome: "proposed" }, facts: { outcome: "no_facts_in_file" } });

    const c = items[12];
    const unsure = full(c.sku, { matched: { confidence: "unsure", note: "another size" }, pictures: [] });
    expect(await loadFile(`${c.sku}.json`, text(unsure), await state(), mk().d)).toMatchObject({ picture: { outcome: "no_candidates" }, facts: { outcome: "unsure_match" } });
    expect((await db.one(`select count(*)::int as n from product_facts where product_id = $1 and source = 'web_page'`, [c.product_id])).n).toBe(0);

    expect(await loadFile("AK-9999.json", text(full("AK-9999")), await state(), mk().d)).toEqual({ sku: "AK-9999", invalid: "not_an_active_catalog_item" });
    expect(await loadFile("AK-0001.json", "nope", await state(), mk().d)).toEqual({ file: "AK-0001.json", invalid: "not_json" });
  });

  it("the report counts items with a proposed picture and facts of each kind, and lists the items with no picture and why", async () => {
    const c = await db.rpc("research_load_coverage");
    expect(c.items).toBe((await state()).size);
    expect(c.approved_from_web_page).toBe(0);
    expect(c.pictures.proposed + c.pictures.approved + c.pictures.none).toBeGreaterThanOrEqual(c.items);
    expect(c.pictures.proposed_public_page).toBeGreaterThanOrEqual(4);
    expect(c.items_with_proposed).toMatchObject({ ingredients: expect.any(Number), allergen_any: expect.any(Number), nutrition: expect.any(Number), halal: expect.any(Number), storage: expect.any(Number), origin: expect.any(Number) });
    expect(c.items_with_proposed.ingredients).toBeGreaterThanOrEqual(5);
    expect(c.no_picture.length).toBe(c.pictures.none);
    const why = Object.fromEntries(c.no_picture.map((x) => [x.sku, x.reason]));
    expect(why[items[5].sku]).toBe("no_candidate_passed_the_check");
    expect(why[items[6].sku]).toBe("rejected_by_a_person");
    expect(why[items[12].sku]).toBe("research_found_no_picture");
    expect(why[items[13].sku]).toBe("no_research_file_loaded");
    expect(why[items[2].sku]).toBeUndefined();

    const s = summarise([
      { sku: "AK-0001", picture: { outcome: "proposed", reasons: ["size"] }, facts: { outcome: "proposed", not_proposed: [{ kind: "diet", reason: "no_such_attribute" }] } },
      { sku: "AK-0002", picture: { outcome: "error", error: "x", reasons: ["error:download_403"] }, facts: { outcome: "skip:loaded_proposed" } },
      { file: "AK-0003.json", invalid: "not_json" }]);
    expect(s).toMatchObject({ files: 3, invalid: { not_json: 1 }, picture: { proposed: 1, error: 1 }, facts: { proposed: 1 }, picture_reasons: { size: 1, "error:download_403": 1 }, facts_not_proposed: { "diet:no_such_attribute": 1 } });
    const lines = reportLines("r", s, c).join("\n");
    expect(lines).toContain("items with no picture");
    expect(lines).toContain(items[13].sku);
  });
});
