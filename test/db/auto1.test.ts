// Session AUTO1 (approvals by rule, not by hand), migrations 0263 and 0264, on the real migrations. docs/DECISIONS.md, "AUTO1, 19 November 2026".
//   1 dishes        Safa's oddmenu text (a saved fixture: dish names and prices only): clean dishes whose every price is on their own line
//                   are approved by the rule; praise words dropped and cut-off descriptions trimmed first; a range, an unclear name and a
//                   price the source does not show stay for a person; the prices to confirm listed with the place's phone
//   2 second reading a photo and a PDF: approved only when a second reading gives the same price; a mismatch stays for a person
//   3 the stamp     stamped by the rule once nothing waits, once; visibility and approve_merchant stay a person's
//   4 undo          one tap: a dish back in the queue and off sale; never taken again by the rule; the stamp put back
//   5 switch        automation.dishes.enabled false: nothing is approved; the Settings page may change both switches
//   6 details       the place's hours and phone read from the source are proposed; a person applies them with one tap
//   7 photos        the database decides from the check's answer: approve, reject with the exact reason, or leave for a person; never with
//                   Hebrew text, a health claim, another shop's branding or a price tag; a re-check of approved pictures changes nothing
//   8 kill-gate     a weekly sample of 50; more than one wrong switches the rule off with its reason (Today reads it); a wrong one is undone
//   9 invariants    no write to orders, payments, stock or the ledger; the automation party passes no role check outside its own run
// Invented places' numbers and products only (the Safa text is its public menu: names and prices). USD 0.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb, type TestDb } from "./harness";

const SAFA_TEXT = readFileSync(new URL("../fixtures/menus/safa-oddmenu.txt", import.meta.url), "utf8");
const MODEL = "claude-haiku-5-5";
let db: TestDb; let lead: string; let admin: string; let picker: string; let reader: string; let auto: string; let place: string; let page: string;
const fails = async (p: Promise<unknown>, code: RegExp) => { await expect(p).rejects.toThrow(code); };
const dish = (name_ar: string | null, name_en: string | null, price: number | null, more: Record<string, unknown> = {}) =>
  ({ name_ar, name_en, translated: null, price, currency: "USD", price_text: price === null ? "" : `${price}`, sizes: [], options: [], addons: [], ...more });
const reading = (sections: [string, string, any[]][]) => ({ sections: sections.map(([ar, en, dishes]) => ({ name_ar: ar, name_en: en, dishes })) });
const status = async (name: string) => (await db.one(`select status, price_check, description from menu_dish_proposals where source_id = $1 and coalesce(name_en, name_ar) = $2 order by position desc limit 1`, [place, name]));

// What the reader made of the Safa text (as MENU2's live run read it; Miranda Can misread on purpose: 1.75 where the page says 1.5).
const SAFA_READING = reading([
  ["شاورما", "SHAWARMA", [
    dish("ساندويش شاورما دجاج", "Chicken shawarma sandwich", null, { sizes: [{ name_ar: "صغير", name_en: "Small", price: 3.5, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: 5, currency: "USD" }] }),
    dish("شاورما دجاج مقطع", "Sliced chicken shawarma", 6, { translated: "en" }),
    dish("كيلو شاورما لحمة", "Kilo meat shawarma", 40, { translated: "en" }),
    dish("صحن شاورما دجاج", "Chicken shawarma plate", 7, { translated: "en" })]],
  ["برغرز", "BURGERS", [
    dish("ميني برغر", "Mini Burger", 7, { translated: "ar", description: "2mini burgers with potato" }),
    dish("برغر صفا الخاص", "Safa Special Burger", 7.5, { translated: "ar", description: "برغر مميز يتكون من قطعة لحم مشوي، طبقة من جبنة الموزاريلا" })]],
  [" ", "PIZZA & PASTA", [
    dish(null, "Supreme", 12, { description: "A loaded delight with pepperoni, beef, fresh veggies, and melted mozzarella on a crispy crust" }),
    dish(null, "Spicy Chicken Ranch", 12, { description: "Juicy grilled chicken, topped with cool ranch dressing, jalapeno, tomato and mushroom for a tantalizing", flags: ["cut_off"], flag_note: "the description ends mid-sentence" }),
    dish(null, "Margherita", 10, { description: "Creamy mozzarella cheese on a crispy crust" }),
    dish(null, "Vegeterian", 10, { description: "Fresh bell peppers, onions, mushrooms, and olives, perfectly complemented by tangy tomato sauce and melted cheese." }),
    dish(null, "Chicken Fettuccine Alfredo", 7.5, { description: "Tender pieces of grilled chicken, drenched in Alfredo sauce made with Parmesan cheese, butter, and", flags: ["cut_off"] })]],
  ["صحون", "PLATES", [dish("صحن سودة", "Liver plate", 8.5, { translated: "en", flags: ["unclear_name"], flag_note: "a stray 'غرام 2oo' line" })]],
  ["سفري", "TAKE-OUT/ DINE-IN", [
    dish("فروج فحم", "Charcoal chicken", null, { translated: "en", price_text: "11–17", price_clear: false, flags: ["price_range"] }),
    dish("نصف فروج فحم", "Half charcoal chicken", null, { translated: "en", price_text: "6–11", price_clear: false, flags: ["price_range"] })]],
  ["مشروبات", "COLD BEVERAGES", [
    dish(null, "Pepsi Can", 1.5), dish(null, "Miranda Can", 1.75), dish(null, "Pepsi Plastic", 1.11), dish(null, "Water", 0.28)]],
]);

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead AUTO1') returning id`)).id;
  admin = (await db.one(`insert into parties(role, display_name) values ('admin', 'Admin AUTO1') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker AUTO1') returning id`)).id;
  reader = await db.rpc("menu_reader_party", {});
  auto = await db.rpc("automation_party", {});
  const village = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  place = (await db.rpc("create_place_from_listing", { p_listing: "safa-chicken-boqaata", p_by: lead, p_details: { village_id: village, phone: "+96170000263" } })).source_id;
  await db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89500, now() - interval '1 day')`);
}, 120_000);

describe("0 the rule and its switch, as data", () => {
  it("the founder's decision: both rules on, each with its version, approved by a person", async () => {
    expect(await db.rpc("automation_on", { p_kind: "dish" })).toBe(true);
    expect(await db.rpc("automation_on", { p_kind: "photo" })).toBe(true);
    expect(await db.all(`select kind, version from automation_rules order by kind`)).toEqual([{ kind: "dish", version: "menu-dish-1" }, { kind: "photo", version: "photo-vision-1" }, { kind: "photo", version: "photo-vision-2" }]);
    expect(await db.rpc("automation_version", { p_kind: "photo" })).toBe("photo-vision-2");             // 0265: the marks read from evidence
    expect((await db.all(`select field from editable_settings where key = 'automation' order by field`)).map((r) => r.field)).toEqual(["dishes.enabled", "photos.enabled"]);
    expect(await db.one(`select is_blocked, display_name from parties where id = $1`, [auto])).toEqual({ is_blocked: true, display_name: "Automation (a rule a person approved)" });
    await fails(db.pg.query(`update parties set is_blocked = false where id = $1`, [auto]), /AUTOMATION_PARTY_LOCKED/);
  });
});

describe("1 dishes from a text source: Safa's oddmenu text", () => {
  it("the price is found on the dish's own line or block, never a neighbour's", async () => {
    const line = async (names: string[], price: number) => (await db.one(`select menu_price_line($1, $2::text[], $3) r`, [SAFA_TEXT, `{${names.map((n) => `"${n}"`).join(",")}}`, price])).r;
    expect(await line(["ساندويش شاورما دجاج"], 3.5)).toContain("صغير");
    expect(await line(["ساندويش شاورما دجاج"], 5)).toContain("كبير");
    expect(await line(["Pepsi Plastic"], 1.11)).toContain("1.11");            // "330ml" under the name is not a price
    expect(await line(["Mini Burger"], 7)).toContain("7");                     // "2mini burgers" is not a price line
    expect(await line(["Mini Burger"], 2)).toBeNull();
    expect(await line(["Pepsi"], 1.11)).toBeNull();                            // "Pepsi" is not "Pepsi Plastic"
    expect(await line(["Miranda Can"], 1.75)).toBeNull();                      // the page says 1.5
    expect(await line(["صحن سودة"], 200)).toBeNull();                          // a weight in the description is not its price
    expect(await line(["Shawarma"], 3.5)).toBeNull();
  });

  it("praise words dropped; cut-off text trimmed to the last whole phrase", async () => {
    const fix = async (t: string, cut: boolean) => (await db.one(`select menu_description_fixed($1, $2) r`, [t, cut])).r;
    expect(await fix("Juicy grilled chicken, topped with cool ranch dressing, jalapeno, tomato and mushroom for a tantalizing", true)).toBe("grilled chicken, topped with cool ranch dressing, jalapeno");
    expect(await fix("Tender pieces of grilled chicken, drenched in Alfredo sauce made with Parmesan cheese, butter, and", true)).toBe("Tender pieces of grilled chicken, drenched in Alfredo sauce made with Parmesan cheese, butter");
    expect(await fix("Fresh bell peppers, onions, mushrooms, and olives, perfectly complemented by tangy tomato sauce and melted cheese.", false))
      .toBe("Fresh bell peppers, onions, mushrooms, and olives, complemented by tangy tomato sauce and melted cheese.");
    expect(await fix("برغر مميز يتكون من قطعة لحم مشوي، طبقة من جبنة الموزاريلا", false)).toBe("برغر يتكون من قطعة لحم مشوي، طبقة من جبنة الموزاريلا");
    expect(await fix("Delicious", false)).toBeNull();
    for (const t of ["grilled chicken, jalapeno", "برغر يتكون من قطعة لحم مشوي"]) expect((await db.one(`select menu_text_claim($1) r`, [t])).r).toBe(false);
  });

  it("the run approves the clean, verified dishes as the automation party; the rest wait for a person", async () => {
    const src = await db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: lead, p_detail: { body: SAFA_TEXT, full_menu: true } });
    page = (await db.one(`select id from menu_source_pages where menu_source_id = $1`, [src.menu_source_id])).id;
    expect(await db.rpc("record_menu_page_reading", { p_page: page, p_reading: SAFA_READING, p_model: MODEL, p_by: reader })).toMatchObject({ ok: true, dishes: 18 });
    const preview = await db.rpc("menu_rule_preview", { p_place: place });
    expect(preview.filter((x: any) => x.eligible).length).toBe(14);
    const r = await db.rpc("automation_run_dishes", { p_place: place });
    expect(r).toMatchObject({ ok: true, enabled: true, version: "menu-dish-1", approved: 14, left_for_a_person: 4, errors: 0, stamped: 0 });
    for (const n of ["Chicken shawarma sandwich", "Sliced chicken shawarma", "Kilo meat shawarma", "Chicken shawarma plate", "Mini Burger", "Safa Special Burger", "Supreme",
                     "Spicy Chicken Ranch", "Margherita", "Vegeterian", "Chicken Fettuccine Alfredo", "Pepsi Can", "Pepsi Plastic", "Water"]) {
      expect((await status(n)).status, n).toBe("approved");
    }
    for (const n of ["Liver plate", "Charcoal chicken", "Half charcoal chicken", "Miranda Can"]) expect((await status(n)).status, n).toBe("waiting");
    // each approval recorded per dish: by the automation party, with the rule, its version and why
    const one = await db.one(`select p.reviewed_by, p.review_note, a.version, a.reason, l.by_party from menu_dish_proposals p join automation_decisions a on a.target_id = p.id
                               join place_log l on l.action = 'dish_approve' and l.detail->>'dish' = p.id::text where p.name_en = 'Pepsi Plastic'`);
    expect(one).toMatchObject({ reviewed_by: auto, version: "menu-dish-1", by_party: auto });
    expect(one.review_note).toMatch(/^automatic: rule menu-dish-1: found in the source: Pepsi Plastic … 1\.11/);
    // the sizes keep their printed prices; the dish is on sale at its database price
    const sz = await db.one(`select o.price_usd, (select jsonb_agg(d.printed_price order by d.sort_order) from dish_option_groups g join dish_options d on d.group_id = g.id where g.product_id = p.id) s
                               from menu_dish_proposals m join products p on p.id = m.product_id join offers o on o.product_id = p.id where m.name_en = 'Chicken shawarma sandwich'`);
    expect(Number(sz.price_usd)).toBe(3.5); expect(sz.s.map(Number)).toEqual([0, 1.5]);
    // descriptions fixed by rule, the printed one kept in the log
    expect((await status("Supreme")).description).toBe("A loaded with pepperoni, beef, fresh veggies, and melted mozzarella on a crispy crust");
    expect((await status("Spicy Chicken Ranch")).description).toBe("grilled chicken, topped with cool ranch dressing, jalapeno");
    expect((await db.one(`select a.detail->>'description_before' d from automation_decisions a join menu_dish_proposals p on p.id = a.target_id where p.name_en = 'Supreme'`)).d).toContain("delight");
    // why each one waits
    const why = Object.fromEntries((await db.rpc("menu_rule_preview", { p_place: place })).map((x: any) => [x.dish, x.reason]));
    expect(why["صحن سودة"]).toBe("flagged: unclear_name");
    expect(why["فروج فحم"]).toBe("price to confirm");
    expect(why["Miranda Can"]).toMatch(/price 1\.75 not found on the dish's line/);
  });

  it("prices to confirm: the dish, the range shown and the place's phone", async () => {
    const p = await db.rpc("menu_prices_to_confirm", { p_place: place });
    expect(p.phone).toBe("+96170000263");
    expect(p.dishes.map((d: any) => [d.name_ar, d.price_text])).toEqual([["فروج فحم", "11–17"], ["نصف فروج فحم", "6–11"]]);
  });
});

describe("2 a photo and a PDF: a second, independent reading", () => {
  let photo: string; let pdfPage: string;
  it("a photo's dish is approved only when the second reading gives the same price", async () => {
    photo = (await db.rpc("record_menu_photo", { p_source: place, p_media_path: `menus/${place}/2026-11-19/p1.jpg`, p_by: lead })).photo_id;
    await db.rpc("record_menu_reading", { p_photo: photo, p_reading: reading([["مقبلات", "Starters", [dish("فتوش", "Fattoush", 4), dish("حمص", "Hummus", 3)]]]), p_model: MODEL, p_by: reader });
    expect((await db.rpc("automation_run_dishes", { p_place: place })).approved).toBe(0);         // no second reading yet
    const s = await db.rpc("record_menu_second_reading", { p_photo: photo, p_page: null, p_items: [{ name_ar: "فتوش", name_en: "Fattoush", prices: [4] }, { name_ar: "حمص", name_en: "Hummus", prices: [3.5] }], p_model: MODEL, p_by: reader });
    expect(s).toMatchObject({ same: 1, mismatch: 1, not_found: 0 });
    expect((await db.rpc("automation_run_dishes", { p_place: place })).approved).toBe(1);
    expect((await status("Fattoush")).status).toBe("approved");
    expect(await status("Hummus")).toMatchObject({ status: "waiting", price_check: "mismatch" });
    expect((await db.one(`select price_check_note n from menu_dish_proposals where name_en = 'Hummus'`)).n).toBe("the second reading gave 3.5; the first 3");
  });
  it("a PDF is checked the same way (its text is not on the page)", async () => {
    const pdf = await db.rpc("add_menu_source", { p_place: place, p_kind: "pdf", p_by: lead, p_detail: { media_path: `menus/${place}/src/2026-11-19/a.pdf`, file_name: "menu.pdf" } });
    pdfPage = (await db.one(`select id from menu_source_pages where menu_source_id = $1`, [pdf.menu_source_id])).id;
    await db.rpc("record_menu_page_reading", { p_page: pdfPage, p_reading: reading([["مشاوي", "Grills", [dish("صحن كباب", "Kebab plate", 9, { page: 1 })]]]), p_model: MODEL, p_by: reader });
    expect((await db.rpc("automation_run_dishes", { p_place: place })).approved).toBe(0);
    await db.rpc("record_menu_second_reading", { p_photo: null, p_page: pdfPage, p_items: [{ name_ar: "صحن كباب", name_en: null, prices: ["9"] }], p_model: MODEL, p_by: reader });
    expect((await db.rpc("automation_run_dishes", { p_place: place })).approved).toBe(1);
  });
  it("only the reading party or staff record a second reading", async () => {
    await fails(db.rpc("record_menu_second_reading", { p_photo: photo, p_page: null, p_items: [], p_model: MODEL, p_by: picker }), /NOT_AUTHORISED/);
    await fails(db.rpc("record_menu_second_reading", { p_photo: photo, p_page: null, p_items: [], p_model: MODEL, p_by: auto }), /NOT_AUTHORISED/);
  });
});

describe("3 the stamp, and what stays a person's", () => {
  it("stamped by the rule once nothing waits, once; the place stays off and unapproved", async () => {
    // a person decides what the rule left (types the range's price after calling, rejects the rest)
    for (const n of ["Liver plate", "Half charcoal chicken", "Miranda Can", "Hummus"]) {
      const id = (await db.one(`select id from menu_dish_proposals where source_id = $1 and name_en = $2 and status = 'waiting'`, [place, n])).id;
      await db.rpc("review_menu_dish", { p_dish: id, p_by: lead, p_approve: false, p_edit: {}, p_note: "asked the place: not sold" });
    }
    const fr = (await db.one(`select id from menu_dish_proposals where name_en = 'Charcoal chicken'`)).id;
    await db.rpc("review_menu_dish", { p_dish: fr, p_by: lead, p_approve: true, p_edit: { price: 14 }, p_note: "the place said 14 for a whole one" });
    const r = await db.rpc("automation_run_dishes", { p_place: place });
    expect(r).toMatchObject({ approved: 0, stamped: 1 });
    expect(await db.one(`select menu_checked_by, visibility, approved_at from sources where id = $1`, [place])).toEqual({ menu_checked_by: auto, visibility: "off", approved_at: null });
    expect((await db.rpc("automation_run_dishes", { p_place: place })).stamped).toBe(0);
    // approving the place is never the rule's: the automation party passes no role check outside its own run
    await fails(db.rpc("approve_merchant", { p_source: place, p_by: auto, p_commission_pct: 0 }), /NOT_AUTHORISED|NOT_ALLOWED|ROLE|ADMIN/);
    expect(await db.rpc("place_staff_ok", { p_by: auto })).toBe(false);
  });
});

describe("4 undo, one tap", () => {
  it("a dish goes back to the queue and off sale; the rule never takes it again; a picker cannot undo", async () => {
    const a = await db.one(`select a.id, a.target_id, a.product_id from automation_decisions a join menu_dish_proposals p on p.id = a.target_id where p.name_en = 'Water'`);
    await fails(db.rpc("automation_undo", { p_decision: a.id, p_by: picker }), /NOT_AUTHORISED/);
    expect(await db.rpc("automation_undo", { p_decision: a.id, p_by: lead, p_note: "the water is 0.5 now" })).toMatchObject({ ok: true, what: "dish_back_in_the_queue" });
    expect(await db.one(`select status, reviewed_by from menu_dish_proposals where id = $1`, [a.target_id])).toEqual({ status: "waiting", reviewed_by: null });
    expect((await db.one(`select is_available from offers where product_id = $1`, [a.product_id])).is_available).toBe(false);
    expect((await db.rpc("automation_run_dishes", { p_place: place })).approved).toBe(0);
    expect((await db.rpc("menu_rule_preview", { p_place: place }))[0].reason).toMatch(/undone: a person decides/);
    expect(await db.rpc("automation_undo", { p_decision: a.id, p_by: lead })).toMatchObject({ already: true });
  });
  it("the stamp is put back as it was", async () => {
    const s = (await db.one(`select id from automation_decisions where kind = 'menu'`)).id;
    expect(await db.rpc("automation_undo", { p_decision: s, p_by: admin })).toMatchObject({ what: "stamp_put_back" });
    expect(await db.one(`select menu_checked_on, menu_checked_by from sources where id = $1`, [place])).toEqual({ menu_checked_on: null, menu_checked_by: null });
  });
});

describe("5 the switch", () => {
  it("off: nothing approved; the Settings page changes it (admin), logged", async () => {
    await db.rpc("change_setting_now", { p_key: "automation", p_field: "dishes.enabled", p_value: false, p_by: admin, p_reason: "test: off" });
    const photo = (await db.rpc("record_menu_photo", { p_source: place, p_media_path: `menus/${place}/2026-11-19/p2.jpg`, p_by: lead })).photo_id;
    await db.rpc("record_menu_reading", { p_photo: photo, p_reading: reading([["حلويات", "Sweets", [dish("كنافة", "Knefeh", 3)]]]), p_model: MODEL, p_by: reader });
    await db.rpc("record_menu_second_reading", { p_photo: photo, p_page: null, p_items: [{ name_ar: "كنافة", prices: [3] }], p_model: MODEL, p_by: reader });
    expect(await db.rpc("automation_run_dishes", { p_place: place })).toMatchObject({ enabled: false, approved: 0 });
    await db.rpc("change_setting_now", { p_key: "automation", p_field: "dishes.enabled", p_value: true, p_by: admin, p_reason: "test: on" });
    expect((await db.rpc("automation_run_dishes", { p_place: place })).approved).toBe(1);
    expect((await db.all(`select reason from config_changes where after->>'key' = 'automation'`)).length).toBe(2);
  });
});

describe("6 the place's hours and phone from the source", () => {
  it("proposed, never applied by the rule; a person applies them with one tap", async () => {
    const r = await db.rpc("record_menu_place_details", { p_place: place, p_photo: null, p_page: page, p_details: { hours_text: "Open daily 10am–11pm, closed Mondays", open: "10:00", close: "23:00", days_off: ["mon"], phone: "+96170000264", phone_text: "70 000 264" }, p_by: reader });
    expect(r).toMatchObject({ ok: true, proposed: true });
    expect((await db.one(`select hours from sources where id = $1`, [place])).hours).not.toMatchObject({ open: "10:00" });
    expect(await db.rpc("record_menu_place_details", { p_place: place, p_photo: null, p_page: page, p_details: { open: "10:00", close: "23:00", days_off: ["mon"], phone: "+96170000264" }, p_by: reader })).toMatchObject({ already: true });
    expect(await db.rpc("record_menu_place_details", { p_place: place, p_photo: null, p_page: page, p_details: { phone: "70 000 264", open: "25:00" }, p_by: reader })).toMatchObject({ proposed: false });
    const w = await db.rpc("place_detail_waiting", { p_place: place });
    expect(w).toHaveLength(1);
    await fails(db.rpc("use_place_detail_proposal", { p_id: w[0].id, p_by: auto }), /NOT_AUTHORISED/);
    expect(await db.rpc("use_place_detail_proposal", { p_id: w[0].id, p_by: lead })).toMatchObject({ status: "used" });
    expect((await db.one(`select hours from sources where id = $1`, [place])).hours).toEqual({ open: "10:00", close: "23:00", days_off: ["mon"] });
    expect((await db.one(`select phone_e164 from place_contacts where source_id = $1`, [place])).phone_e164).toBe("+96170000264");
  });
});

describe("7 photos: the database decides from the check's answer", () => {
  let p1: string; let p2: string; let p3: string; let p4: string; let p5: string;
  const img = async (product: string, n: number, status = "proposed") => (await db.one(
    `insert into product_images(product_id, status, source_kind, licence, media_path, sha256, width_px, height_px, bytes, source_note)
     values ($1, $2, 'founder_upload', 'founder_supplied', $3, $4, 1000, 1000, 50000, 'release pictures-test') returning id`, [product, status, `pictures/test/${n}.webp`, String(n).padStart(64, "0")])).id;
  const yes = (seen: string) => ({ seen, match: "yes" });
  beforeAll(async () => {
    const ps = await db.all(`select id from products where sku like 'AK-%' and is_active order by sku limit 5`);
    [p1, p2, p3, p4, p5] = ps.map((x) => x.id);
  });
  it("all four match with high confidence: approved by the automation party; the earlier picture superseded", async () => {
    const old = await img(p1, 1, "approved");
    const i = await img(p1, 2);
    const r = await db.rpc("record_photo_check", { p_image: i, p_mode: "decide", p_model: MODEL, p_result: { verdict: "match", confidence: 0.96, brand: yes("Nejmeh"), product_type: yes("water"), size: yes("1.5 L"), flavour: { seen: null, match: "n/a" }, marks: [], reason: "Nejmeh water 1.5 L, one bottle" } });
    expect(r).toMatchObject({ outcome: "approved" });
    expect(await db.one(`select status, reviewed_by from product_images where id = $1`, [i])).toEqual({ status: "approved", reviewed_by: auto });
    expect((await db.one(`select status from product_images where id = $1`, [old])).status).toBe("superseded");
    // undo: the earlier picture comes back, this one waits for a person
    const a = (await db.one(`select id from automation_decisions where target_id = $1`, [i])).id;
    expect(await db.rpc("automation_undo", { p_decision: a, p_by: lead })).toMatchObject({ what: "picture_back_in_the_queue" });
    expect((await db.one(`select status from product_images where id = $1`, [old])).status).toBe("approved");
    expect(await db.one(`select status, needs_review from product_images where id = $1`, [i])).toEqual({ status: "proposed", needs_review: true });
    expect(await db.rpc("photo_check_queue", { p_mode: "decide" })).not.toContainEqual(expect.objectContaining({ image_id: i }));
  });
  it("a confident mismatch is rejected with the exact reason; so is Hebrew text, a health claim, another shop's branding", async () => {
    const i = await img(p2, 3);
    expect(await db.rpc("record_photo_check", { p_image: i, p_mode: "decide", p_model: MODEL, p_result: { verdict: "mismatch", confidence: 0.95, brand: { seen: "Masafi", match: "no" }, product_type: yes("water"), size: yes("1.5 L"), flavour: { match: "n/a" }, marks: [], reason: "shows Masafi, not Nejmeh" } }))
      .toMatchObject({ outcome: "rejected", reason: "shows Masafi, not Nejmeh" });
    expect((await db.one(`select status, review_note from product_images where id = $1`, [i]))).toEqual({ status: "rejected", review_note: "automatic: rule photo-vision-2: shows Masafi, not Nejmeh" });
    // 0265 (photo-vision-2): a mark counts only with evidence, and leaves the picture for a person; it never rejects by itself
    const j = await img(p2, 4);
    expect(await db.rpc("record_photo_check", { p_image: j, p_mode: "decide", p_model: MODEL, p_result: { verdict: "match", confidence: 0.97, brand: yes("x"), product_type: yes("x"), size: yes("x"), flavour: yes("x"), marks: ["hebrew_text"], evidence: { hebrew: "مياه" }, reason: "the right can" } }))
      .toMatchObject({ outcome: "approved", marks: [] });                                                // Arabic is not Hebrew: no mark
    const j2 = await img(p4, 41);
    expect(await db.rpc("record_photo_check", { p_image: j2, p_mode: "decide", p_model: MODEL, p_result: { verdict: "match", confidence: 0.97, brand: yes("x"), product_type: yes("x"), size: yes("x"), flavour: yes("x"), marks: ["hebrew_text"], evidence: { hebrew: "מים מינרליים" }, reason: "the right bottle" } }))
      .toMatchObject({ outcome: "left", marks: ["hebrew_text"] });
    expect((await db.one(`select status from product_images where id = $1`, [j2])).status).toBe("proposed");
    expect((await db.one(`select menu_text_claim('x') is not null r`)).r).toBe(true);
    // the brand's own printed claim is no mark; an overlay's is; "organic" on an item that is not
    const cnt = async (m: string[], ev: Record<string, unknown>, name = "Uno Juice Mango 1 L") => (await db.one(`select photo_marks_counted($1::text[], $2::jsonb, $3, 'Uno') r`, [`{${m.join(",")}}`, JSON.stringify(ev), name])).r;
    expect(await cnt(["health_claim"], { claim: "No preservatives", claim_where: "pack" })).toEqual([]);
    expect(await cnt(["health_claim"], { claim: "Boosts immunity!", claim_where: "overlay" })).toEqual(["health_claim"]);
    expect(await cnt(["health_claim"], { claim: "Organic", claim_where: "pack" })).toEqual(["health_claim"]);
    expect(await cnt(["health_claim"], { claim: "Organic", claim_where: "pack" }, "Organic mango juice")).toEqual([]);
    expect(await cnt(["other_shop_branding", "price_tag"], { shop: "Uno", price: "" })).toEqual([]);
    expect(await cnt(["other_shop_branding", "price_tag"], { shop: "Spinneys", price: "3.5$" })).toEqual(["other_shop_branding", "price_tag"]);
    const k = await img(p3, 5);
    expect(await db.rpc("record_photo_check", { p_image: k, p_mode: "decide", p_model: MODEL, p_result: { verdict: "mismatch", confidence: 0.93, brand: yes("Pepsi"), product_type: yes("cola"), size: { seen: "24-can tray", match: "no" }, flavour: { match: "n/a" }, marks: [], reason: "24-can tray, product is one can" } }))
      .toMatchObject({ outcome: "rejected", reason: "24-can tray, product is one can" });
  });
  it("anything uncertain stays for a person, marked needs review with the check's words", async () => {
    const i = await img(p5, 6);
    expect(await db.rpc("record_photo_check", { p_image: i, p_mode: "decide", p_model: MODEL, p_result: { verdict: "match", confidence: 0.7, brand: yes("x"), product_type: yes("x"), size: { seen: null, match: "unsure" }, flavour: { match: "n/a" }, marks: [], reason: "the size is not readable" } }))
      .toMatchObject({ outcome: "left" });
    expect(await db.one(`select status, needs_review, check_notes from product_images where id = $1`, [i])).toEqual({ status: "proposed", needs_review: true, check_notes: ["vision check: the size is not readable"] });
    // a confident "match" with a field it could not see is not enough either
    expect((await db.rpc("record_photo_check", { p_image: i, p_mode: "decide", p_model: MODEL, p_result: { verdict: "match", confidence: 0.99, brand: yes("x"), product_type: { match: "n/a" }, size: yes("x"), flavour: { match: "n/a" }, reason: "ok" } })).outcome).toBe("left");
  });
  it("the re-check of approved pictures changes nothing and lists the disagreements", async () => {
    const approved = await db.all(`select id from product_images where status = 'approved' order by id`);
    const q = await db.rpc("photo_check_queue", { p_mode: "recheck" });
    expect(q.map((x: any) => x.image_id).sort()).toEqual(approved.map((x) => x.id).sort());
    await db.rpc("record_photo_check", { p_image: approved[0].id, p_mode: "recheck", p_model: MODEL, p_result: { verdict: "mismatch", confidence: 0.94, brand: { seen: "Masafi", match: "no" }, product_type: yes("water"), size: yes("1.5 L"), flavour: { match: "n/a" }, reason: "shows Masafi, not Nejmeh" } });
    expect((await db.one(`select status from product_images where id = $1`, [approved[0].id])).status).toBe("approved");
    const rep = await db.rpc("photo_recheck_report", {});
    expect(rep).toMatchObject({ checked: 1, disagrees: 1, rows: [{ reason: "shows Masafi, not Nejmeh", still_approved: true }] });
    expect(await db.rpc("photo_check_queue", { p_mode: "recheck" })).toHaveLength(approved.length - 1);
  });
  it("switched off: the answer is kept, nothing is decided", async () => {
    await db.rpc("change_setting_now", { p_key: "automation", p_field: "photos.enabled", p_value: false, p_by: admin, p_reason: "test" });
    const i = await img(p3, 7);
    expect((await db.rpc("record_photo_check", { p_image: i, p_mode: "decide", p_model: MODEL, p_result: { verdict: "match", confidence: 0.99, brand: yes("x"), product_type: yes("x"), size: yes("x"), flavour: yes("x"), reason: "ok" } })).outcome).toBe("off");
    expect((await db.one(`select status from product_images where id = $1`, [i])).status).toBe("proposed");
    await db.rpc("change_setting_now", { p_key: "automation", p_field: "photos.enabled", p_value: true, p_by: admin, p_reason: "test" });
  });
  it("a label day front photo is queued once as our own photo", async () => {
    const prod = (await db.one(`select p.id from products p where p.is_active and not exists (select 1 from product_images i where i.product_id = p.id) order by sku limit 1`)).id;
    await db.rpc("record_label_capture", { p_product: prod, p_shot: "front", p_media_path: `labels/${prod}/front-1.jpg`, p_by: picker });
    const q = await db.rpc("photo_front_queue", {});
    const c = q.find((x: any) => x.product_id === prod);
    const r = await db.rpc("propose_front_photo", { p_capture: c.capture_id, p_sha256: "a".repeat(64), p_width: 1200, p_height: 1600, p_bytes: 200000 });
    expect(await db.one(`select source_kind, licence, status, media_path from product_images where id = $1`, [r.image_id])).toEqual({ source_kind: "intake_photo", licence: "own_photo", status: "proposed", media_path: `labels/${prod}/front-1.jpg` });
    expect((await db.rpc("photo_front_queue", {})).find((x: any) => x.product_id === prod)).toBeUndefined();
  });
});

describe("8 the day's list and the weekly kill-gate", () => {
  it("today's list: every automatic decision, with undo state; read only", async () => {
    const t = await db.rpc("automation_today", {});
    expect(t.counts).toMatchObject({ dishes_approved: 17, photos_approved: 2, photos_rejected: 2, menus_stamped: 1, undone: 3 });
    expect(t.decisions.find((d: any) => d.title.startsWith("Water"))).toMatchObject({ undone: true, undone_by: "Lead AUTO1" });
  });
  it("a sample of last week's decisions; more than one wrong switches the rule off with its reason; each wrong one undone", async () => {
    await db.pg.exec(`update automation_decisions set created_at = created_at - interval '7 days'`);
    const s = await db.rpc("automation_weekly_sample", {});
    expect(s.find((x: any) => x.kind === "dish")).toMatchObject({ decisions: 17, sampled: 16 });   // one was undone (Water)
    expect(await db.rpc("automation_weekly_sample", {})).toEqual([]);
    const checks = (await db.rpc("automation_overview", {})).checks.filter((c: any) => c.kind === "dish");
    await fails(db.rpc("record_automation_check", { p_check: checks[0].check_id, p_by: lead, p_verdict: "wrong" }), /CHECK_NOTE_REQUIRED/);
    expect(await db.rpc("record_automation_check", { p_check: checks[0].check_id, p_by: lead, p_verdict: "correct" })).toMatchObject({ status: "correct" });
    expect(await db.rpc("record_automation_check", { p_check: checks[1].check_id, p_by: lead, p_verdict: "wrong", p_note: "wrong price" })).toMatchObject({ switched_off: false });
    expect(await db.rpc("automation_on", { p_kind: "dish" })).toBe(true);
    expect(await db.rpc("record_automation_check", { p_check: checks[2].check_id, p_by: lead, p_verdict: "wrong", p_note: "not on the menu" })).toMatchObject({ switched_off: true });
    expect(await db.rpc("automation_on", { p_kind: "dish" })).toBe(false);
    const o = await db.rpc("automation_overview", {});
    expect(o.rules.dish.off_reason).toMatch(/^2 of the 16 automatic dish decisions checked for the week of .* were wrong \(the most allowed is 1\); the last: not on the menu$/);
    expect(o.rules.photo.enabled).toBe(true);
    expect((await db.one(`select changed_by from config_changes where reason like 'the weekly check:%'`)).changed_by).toBe(auto);
    expect((await db.one(`select undone_at is not null u from automation_decisions where id = $1`, [checks[2].decision_id])).u).toBe(true);
    // only a person switches it on again
    await db.rpc("change_setting_now", { p_key: "automation", p_field: "dishes.enabled", p_value: true, p_by: admin, p_reason: "fixed the rule" });
    expect(await db.rpc("automation_on", { p_kind: "dish" })).toBe(true);
  });
});

describe("9 invariants", () => {
  it("no write to orders, payments, stock or the ledger in either migration", () => {
    for (const f of ["0263_auto_dishes.sql", "0264_auto_photos.sql"]) {
      const sql = readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8");
      expect(sql).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+(orders|order_items|payments|stock_levels|stock_movements|ledger_entries)\b/i);
      expect(sql).not.toMatch(/(perform|select)\s+approve_merchant\s*\(/i);
    }
  });
  it("no client role reads the new tables", async () => {
    const grants = await db.all(`select grantee, table_name from information_schema.role_table_grants where table_name in ('automation_rules', 'automation_decisions', 'automation_checks', 'automation_sample_weeks', 'product_image_checks', 'place_detail_proposals') and grantee in ('anon', 'authenticated', 'web_channel')`);
    expect(grants).toEqual([]);
  });
});
