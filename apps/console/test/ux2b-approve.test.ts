// UX2b: Approve, one card at a time. The cards post to the routes the older list pages already have (so every SQL function, role and refusal
// stands) and come back to the next card; the two-person rule is on the card; Undo is offered only for a name (the database can put the
// earlier name back); a label reading for allergens, halal or a warning asks for the tick that the person looked at the photo.
import { beforeAll, describe, expect, it } from "vitest";
import { deliver, flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rider: string;
let lead: Awaited<ReturnType<typeof who>>, admin: Awaited<ReturnType<typeof who>>, picker: Awaited<ReturnType<typeof who>>;
const who = async (role: "admin" | "ops_lead" | "picker", name: string) => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); return { ...w, b }; };
const path = (p: string, s: string) => `labels/${p}/2026-11-16/${s}.jpg`;
let n = 0;
const propose = async (product: string, kind: "open_food_facts" | "web_search" = "open_food_facts") => (await r.db.rpc("propose_product_image", {
  p_product: product, p_source_kind: kind, p_source_url: `https://images.example.test/${++n}.jpg`, p_page_url: `https://world.openfoodfacts.org/product/${n}`,
  p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
  p_media_path: `product_images/ux2b/${n}.jpg`, p_sha256: `ux2b-sha-${n}`, p_width: 1200, p_height: 900, p_bytes: 120000, p_vision: { keep: true, rank: n } })).image_id as string;
const tab = (html: string, name: string) => new RegExp(`href="/approve\\?tab=${name}"`).test(html);

beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rider });
  lead = await who("ops_lead", "Maya"); admin = await who("admin", "Rasheed"); picker = await who("picker", "Pia");
  // label readings: an allergen and a halal fact (group 1 and 2), a warning (group 3), a claim (group 5)
  const food = await r.db.all(`select id from products where is_active and category = 'Snacks & Candy' order by sku limit 3`);
  for (const x of [food[0].id, food[1].id]) for (const s of ["front", "back"]) await r.db.rpc("record_label_capture", { p_product: x, p_shot: s, p_media_path: path(x, s), p_by: lead.partyId });
  const scan = (p: string, reading: object) => r.db.rpc("record_label_scan", { p_product: p, p_photos: [path(p, "front"), path(p, "back")], p_model: "test", p_by: lead.partyId, p_reading: reading });
  await scan(food[0].id, { facts: [{ attribute: "milk", value: "contains", quote: "Contains milk" }, { attribute: "halal", value: "yes", quote: "Halal" }], fields: { warnings_as_printed: ["Contains caffeine."] } });
  await scan(food[1].id, { claims: [{ code: "high_protein", quote: "High protein" }] });
  // pictures
  const [p1, p2] = await r.db.all(`select id from products where is_active order by sku limit 2`);
  await propose(p1.id); await propose(p2.id, "web_search");
}, 180_000);

describe("who sees Approve, and the tabs", () => {
  it("is for the ops lead and the admin; a picker is refused", async () => {
    expect((await picker.b.get("/approve")).status).toBe(403);
    expect((await lead.b.get("/approve")).status).toBe(200);
    expect((await admin.b.get("/approve")).status).toBe(200);
  });
  it("shows the four tabs with their counts, and the older list pages as links", async () => {
    const p = (await lead.b.get("/approve")).text;
    for (const t of ["names", "pictures", "labels", "money"]) expect(tab(p, t), t).toBe(true);
    expect(p).toMatch(/Names[\s\S]{0,200}99\+/);                                  // the count badge reads 99+ above 99
    expect(p).toContain('href="/label-queue"'); expect(p).toContain('href="/approvals"'); expect(p).toContain('href="/names"');
    expect(p).not.toMatch(/<script(?![^>]*\bsrc=)|<style|\sstyle="/);
  });
  it("opens on the first tab that has something waiting, and clamps the card number", async () => {
    const p = (await lead.b.get("/approve?tab=names&n=99999")).text;
    expect(p).toMatch(/Card 282 of 282/);
    expect((await lead.b.get("/approve?tab=nonsense")).status).toBe(200);
  });
});

describe("a name card", () => {
  it("shows the catalog's name beside the proposed one, saved-as, and approve, correct and reject with a reason", async () => {
    const p = (await lead.b.get("/approve?tab=names")).text;
    expect(p).toMatch(/Card 1 of 282/);
    expect(p).toContain("Will be saved as");
    expect(p).toMatch(/<form[^>]*action="\/names\/[0-9a-f-]{36}"/);
    expect(p).toContain('name="return_to" value="/approve?tab=names"');
    expect(p).toMatch(/name="note"[^>]*required|required[^>]*name="note"/);            // a reason is needed to reject
    expect(p).toContain('data-key="a"');
  });
  it("approving returns to the next card, and the toast carries an Undo that puts the earlier name back", async () => {
    const page = (await lead.b.get("/approve?tab=names")).text;
    const id = /action="\/names\/([0-9a-f-]{36})"/.exec(page)![1]!;
    const row = await r.db.one(`select sku, current_name_en from product_name_proposals where id = $1`, [id]);
    const res = await lead.b.post(`/names/${id}`, { decision: "approve", return_to: "/approve?tab=names" });
    expect(flashOf(res.text)).toMatch(/^Approved: /);
    expect(res.text).toMatch(/Card 1 of 281/);                                         // the next card
    expect(res.text).toMatch(/<form method="post" action="\/names\/[0-9a-f-]{36}">[\s\S]*name="decision" value="reject"[\s\S]*class="ak-toast-undo"/);
    expect((await r.db.one(`select status from product_name_proposals where id = $1`, [id])).status).toBe("approved");
    const undo = await lead.b.post(`/names/${id}`, { decision: "reject", note: "undone from the approve card", return_to: "/approve?tab=names" });
    expect(flashOf(undo.text)).toBe(`Undone: the earlier name of ${row.sku} is back.`);
    expect((await r.db.one(`select name_en from products where sku = $1`, [row.sku])).name_en).toBe(row.current_name_en);
    expect((await r.db.one(`select status from product_name_proposals where id = $1`, [id])).status).toBe("rejected");
  });
  it("a card posts back only to an address of the Approve page", async () => {
    const page = (await lead.b.get("/approve?tab=names&n=3")).text;
    const id = /action="\/names\/([0-9a-f-]{36})"/.exec(page)![1]!;
    for (const bad of ["https://evil.test/", "//evil.test", "/approve?tab=names&n=1&x=<script>", "/pictures"]) {
      const res = await lead.b.post(`/names/${id}`, { decision: "correct", name_en: "", name_ar: "", size_en: "", size_ar: "", return_to: bad }, { follow: false });
      expect(res.location, bad).not.toContain("evil");
      expect(res.location, bad).not.toBe(bad.startsWith("/") && !bad.startsWith("//") ? bad : "none");
    }
  });
});

describe("a picture card", () => {
  it("shows the picture's source and licence, the never-shown warning, no Undo; approving returns to the next card", async () => {
    const p = (await lead.b.get("/approve?tab=pictures")).text;
    expect(p).toMatch(/Card 1 of 2/);
    expect(p).toContain("https://media.test/product_images/ux2b/");
    expect(p).toContain("CC BY-SA (Open Food Facts): attribution must be shown");
    expect(p).toContain("cannot be undone from here");
    const id = /action="\/pictures\/([0-9a-f-]{36})"/.exec(p)![1]!;
    const res = await lead.b.post(`/pictures/${id}`, { decision: "approve", return_to: "/approve?tab=pictures" });
    expect(flashOf(res.text)).toMatch(/^Approved/);
    expect(res.text).toMatch(/Card 1 of 1/);
    expect(res.text).not.toContain("ak-toast-undo");
    expect(res.text).toContain("Never shown to customers");                             // the licence-unknown one is next
  });
});

describe("a label reading card", () => {
  it("goes in LB1's order: allergens first, with the tick that the person looked at the photo; the rest needs no tick", async () => {
    const first = (await lead.b.get("/approve?tab=labels")).text;
    expect(first).toContain('data-group="1"');
    expect(first).toMatch(/Group 1 of 5: Allergens/);
    expect(first).toMatch(/<input type="checkbox" name="looked" value="1" required>/);
    expect(first).toContain("Contains milk");
    expect(first).toContain("https://media.test/labels/");
    const total = Number(/Card 1 of (\d+)/.exec(first)![1]);
    const last = (await lead.b.get(`/approve?tab=labels&n=${total - 1}`)).text;
    expect(last).toMatch(/Group 5 of 5/);
    expect(last).not.toContain('name="looked"');
  });
  it("confirming goes through the same route and returns to the next card; the person is recorded", async () => {
    const page = (await lead.b.get("/approve?tab=labels")).text;
    const m = /action="\/label-queue\/(fact|field|claim|certificate)\/([0-9a-f-]{36})\/confirm"/.exec(page)!;
    const res = await lead.b.post(`/label-queue/${m[1]}/${m[2]}/confirm`, { value: "contains", return_to: "/approve?tab=labels" });
    expect(flashOf(res.text)).toBe("Confirmed against the pack and published.");
    expect(res.text).toMatch(/Card 1 of \d+/);
    expect(res.text).not.toContain(`/label-queue/${m[1]}/${m[2]}/confirm`);               // it left the queue
    expect(m[1]).toBe("fact");                                                              // group 1 is an allergen: a fact
    expect(Number((await r.db.one(`select count(*) as n from product_facts where approved_by = $1 and attribute = 'milk' and approved_at is not null`, [lead.partyId])).n)).toBe(1);
  });
  it("a picker cannot confirm it by posting to the route", async () => {
    const page = (await lead.b.get("/approve?tab=labels")).text;
    const m = /action="\/label-queue\/(fact|field|claim|certificate)\/([0-9a-f-]{36})\/confirm"/.exec(page)!;
    expect((await picker.b.post(`/label-queue/${m[1]}/${m[2]}/confirm`, {}, { follow: false })).status).toBe(403);
  });
});

describe("a second-approval card", () => {
  let refund: string, price: string, setting: string, fx: string;
  beforeAll(async () => {
    const o = await placeOrder(r.db, village, "cod", 40);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
    refund = (await r.db.rpc("refund_order", { p_order: o.id, p_by: lead.partyId, p_amount_usd: 25, p_charged_to: "goods", p_reason: "damaged", p_settle: "credit", p_ref: null, p_note: null, p_item: null, p_key: "ux2b-refund" })).approval_id;
    const p = (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
    const old = Number((await r.db.one(`select price_usd from offers where product_id = $1 and source_id = $2`, [p, r.source])).price_usd);
    price = (await r.db.rpc("set_offer", { p_product: p, p_price_usd: Math.round(old * 1.5 * 100) / 100, p_available: true, p_by: lead.partyId, p_reason: "new supplier list" })).approval_id;
    await r.db.rpc("set_fx_rate", { p_lbp_per_usd: 89500, p_by: admin.partyId });
    fx = (await r.db.rpc("set_fx_rate", { p_lbp_per_usd: 95000, p_by: admin.partyId })).approval_id;
    setting = (await r.db.rpc("change_setting", { p_key: "cash_cap", p_field: "hard_usd", p_value: "175", p_by: admin.partyId, p_reason: "the weekend rush" })).approval_id;
  }, 120_000);

  it("shows who asked and says the person who asked can never approve: no Approve button for the asker, only Withdraw", async () => {
    const mine = (await lead.b.get("/approve?tab=money")).text;                          // the oldest is Maya's own refund
    expect(mine).toMatch(/Refund[\s\S]*\$25\.00/);
    expect(mine).toContain("Asked by Maya");
    expect(mine).toContain("the person who asked can never approve");
    expect(mine).toContain("A refund above $10.00 needs a second person.");
    expect(mine).not.toContain(`action="/approvals/${refund}/approve"`);
    expect(mine).toContain(`action="/approvals/${refund}/reject"`);
    expect(mine).toContain("Withdraw my request");
  });
  it("the second person sees the Approve button and the rule, and approving makes the refund and returns to the next card", async () => {
    const p = (await admin.b.get("/approve?tab=money")).text;
    expect(p).toContain(`action="/approvals/${refund}/approve"`);
    expect(p).toContain("Needs you as the second person.");
    const res = await admin.b.post(`/approvals/${refund}/approve`, { return_to: "/approve?tab=money" });
    expect(flashOf(res.text)).toBe("Approved: the change is made.");
    expect(Number((await r.db.one(`select count(*) as n from refunds where order_id is not null`)).n)).toBeGreaterThan(0);
    expect(res.text).toMatch(/Card 1 of 3/);
  });
  it("shows a price change with its percentage, the LBP rate, and a settings change with its name and values", async () => {
    const p = (await admin.b.get("/approve?tab=money&n=0")).text;
    const all = [p, (await admin.b.get("/approve?tab=money&n=1")).text, (await admin.b.get("/approve?tab=money&n=2")).text].join("\n");
    expect(all).toMatch(/Price of[\s\S]*Leen Taanayel Labneh Premium[\s\S]*\(\+50\.\d%\)/);
    expect(all).toMatch(/Exchange rate[\s\S]*89,500[\s\S]*95,000/);
    expect(all).toContain("Any change to the LBP rate needs a second person.");
    expect(all).toMatch(/Hard cap: no new cash order above[\s\S]*175/);
    expect(all).toContain("A change to this rule needs a second person.");
    void price; void fx; void setting;
  });
  it("a second person's approval of a setting makes the change; a reject needs nothing more than the route", async () => {
    const res = await lead.b.post(`/approvals/${setting}/approve`, { return_to: "/approve?tab=money" });
    expect(flashOf(res.text)).toBe("Approved: the change is made.");
    expect((await r.db.one(`select setting('cash_cap') as v`)).v.hard_usd).toBe(175);
    const rej = await lead.b.post(`/approvals/${fx}/reject`, { note: "rate not final", return_to: "/approve?tab=money" });
    expect(flashOf(rej.text)).toBe("Rejected: nothing changes.");
  });
});

describe("Arabic", () => {
  it("the tabs, the card words and the two-person rule are in Arabic, right to left", async () => {
    const b = (await who("ops_lead", "Maya ar")).b; b.cookies.set("ak_lang", "ar");
    const p = (await b.get("/approve?tab=labels")).text;
    expect(p).toMatch(/<html lang="ar" dir="rtl">/);
    expect(p).toContain("الأسماء"); expect(p).toContain("قراءات الملصقات"); expect(p).toContain("الموافقات الثانية");
    expect(p).toContain("البطاقة 1 من"); expect(p).toContain("نظرت إلى صورة الملصق");
    const m = (await b.get("/approve?tab=money")).text;
    expect(m).toMatch(/طلبها|بانتظار|تحتاجك/);
  });
});
