// Session FD1 (the friends' test food: places and menus), migrations 0245 to 0247, on the real migrations. Written before the migrations:
// with 0245 to 0247 moved aside every test below fails. docs/DECISIONS.md, "Founder decisions, 18 November 2026" (3) and "FD1, 18 November 2026".
//   1. A place is made by staff from an LV1 listing: name, village, its public phone (console only), hours, preparation time, visibility.
//      Public is refused unless the owner's claim or application is on file. The tester list (customer numbers) is a setting.
//   2. Menus from photos: a photo per page, one reading run proposes sections and dishes; every dish waits for a person; a "menu checked" stamp.
//   3. Prices as printed, LBP converted at today's rate; a food service fee setting, 0.
//   4. approve_merchant() makes a place orderable for its visibility; nothing is orderable before it (invariant 11).
// Invented people and numbers only.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let admin: string; let picker: string; let village: string;
const SAFA = "safa-chicken-boqaata";
let seq = 0;
const customer = async (phone: string) => {
  seq++;
  const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`FD1 customer ${seq}`])).id as string;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'customer', $2, $3)`, [party, `wa-fd1-${seq}`, phone]);
  return party;
};
const fails = async (p: Promise<unknown>, code: RegExp) => { await expect(p).rejects.toThrow(code); };
const otherListing = async (n = 0) => (await db.one(`select listing_id from listings where hidden_at is null and listing_id <> $1 order by listing_id offset $2 limit 1`, [SAFA, n])).listing_id as string;
const reading = {
  sections: [
    { name_ar: "سندويشات", name_en: "Sandwiches", dishes: [
      { name_ar: "شاورما دجاج", name_en: "Chicken shawarma", price: 450000, currency: "LBP", price_text: "450,000", translated: null,
        sizes: [{ name_ar: "عادي", name_en: "Regular", price: 450000, currency: "LBP" }, { name_ar: "كبير", name_en: "Large", price: 650000, currency: "LBP" }],
        options: [{ group_ar: "الخبز", group_en: "Bread", required: true, min: 1, max: 1, choices: [{ name_ar: "عربي", name_en: "Arabic", price_delta: 0 }, { name_ar: "Saj", name_en: null, price_delta: 50000 }] }],
        addons: [{ name_ar: "ثوم إضافي", name_en: "Extra garlic", price: 50000, currency: "LBP" }] },
      { name_ar: "طاووق", name_en: "Taouk", price: 5, currency: "USD", price_text: "$5", translated: "ar", sizes: [], options: [], addons: [] },
    ] },
    { name_ar: "مشاوي", name_en: "Grills", dishes: [
      { name_ar: null, name_en: "Healthy grilled plate", price: 9, currency: "USD", price_text: "9$", translated: null, sizes: [], options: [], addons: [] },
      { name_ar: "فروج", name_en: "Whole chicken", price: null, currency: null, price_text: "", translated: null, sizes: [], options: [], addons: [],
        allergens: [{ code: "milk", value: "free" }] },
    ] },
  ],
};

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead') returning id`)).id;
  admin = (await db.one(`insert into parties(role, display_name) values ('admin', 'Admin') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  village = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  await db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89500, now() - interval '1 day')`);
}, 120_000);

describe("1 a place from a listing", () => {
  it("is made by an ops lead or admin only, from a visible listing, once; it starts off, closed, not approved", async () => {
    await fails(db.rpc("create_place_from_listing", { p_listing: SAFA, p_by: picker, p_details: { village_id: village } }), /NOT_AUTHORISED/);
    await fails(db.rpc("create_place_from_listing", { p_listing: "no-such-place", p_by: lead, p_details: { village_id: village } }), /LISTING_NOT_FOUND/);
    await fails(db.rpc("create_place_from_listing", { p_listing: SAFA, p_by: lead, p_details: {} }), /VILLAGE_REQUIRED/);
    await fails(db.rpc("create_place_from_listing", { p_listing: SAFA, p_by: lead, p_details: { village_id: village, phone: "call me" } }), /PHONE_INVALID/);
    const r = await db.rpc("create_place_from_listing", { p_listing: SAFA, p_by: lead,
      p_details: { village_id: village, phone: "+96170000201", hours: { open: "11:00", close: "22:00", days_off: ["mon"] }, prep_minutes: 25 } });
    const s = await db.one(`select kind::text, name, listing_id, village_id, visibility, buys_for_customer, is_open, approved_at, prep_minutes, hours, tier from sources where id = $1`, [r.source_id]);
    expect(s).toMatchObject({ kind: "merchant", name: "Safa Chicken", listing_id: SAFA, village_id: village, visibility: "off", buys_for_customer: true, is_open: false, approved_at: null, prep_minutes: 25, tier: "assisted" });
    expect(s.hours).toEqual({ open: "11:00", close: "22:00", days_off: ["mon"] });
    await fails(db.rpc("create_place_from_listing", { p_listing: SAFA, p_by: lead, p_details: { village_id: village } }), /PLACE_EXISTS/);
  });

  it("keeps the public phone off the sources row: it is read only by the console's places list", async () => {
    const cols = (await db.all(`select column_name from information_schema.columns where table_name = 'sources'`)).map((c: any) => c.column_name);
    expect(cols.some((c: string) => /phone/.test(c))).toBe(false);
    const list = await db.rpc("places_console", {});
    expect(list.find((p: any) => p.listing_id === SAFA)).toMatchObject({ name: "Safa Chicken", phone: "+96170000201", visibility: "off", approved: false, owner_on_file: false });
    // no client role can read the contacts table
    const grants = await db.all(`select grantee from information_schema.role_table_grants where table_name = 'place_contacts' and grantee in ('anon', 'authenticated', 'web_channel')`);
    expect(grants).toEqual([]);
  });

  it("details can change (name, village, phone, hours, preparation time), by staff, logged", async () => {
    const src = (await db.one(`select id from sources where listing_id = $1`, [SAFA])).id;
    await fails(db.rpc("set_place_details", { p_source: src, p_by: picker, p_details: { prep_minutes: 30 } }), /NOT_AUTHORISED/);
    await fails(db.rpc("set_place_details", { p_source: src, p_by: lead, p_details: { prep_minutes: 500 } }), /PREP_MINUTES/);
    await fails(db.rpc("set_place_details", { p_source: src, p_by: lead, p_details: { hours: { open: "25:00", close: "22:00" } } }), /HOURS_INVALID/);
    await db.rpc("set_place_details", { p_source: src, p_by: lead, p_details: { prep_minutes: 30, phone: "+96170000202" } });
    expect((await db.one(`select prep_minutes from sources where id = $1`, [src])).prep_minutes).toBe(30);
    expect((await db.rpc("places_console", {})).find((p: any) => p.source_id === src).phone).toBe("+96170000202");
    expect((await db.all(`select action from place_log where source_id = $1 order by id`, [src])).map((x: any) => x.action)).toEqual(["create", "details"]);
    await expect(db.pg.exec(`update place_log set action = 'x'`)).rejects.toThrow(/append-only/);
  });

  it("visibility: off, testers, public; public is refused until the owner's claim or application is on file, whatever the path", async () => {
    const src = (await db.one(`select id from sources where listing_id = $1`, [SAFA])).id;
    await fails(db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "everyone", p_reason: "test" }), /VISIBILITY_INVALID/);
    await fails(db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "testers", p_reason: "" }), /REASON_REQUIRED/);
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "testers", p_reason: "friends' test" });
    await fails(db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "public", p_reason: "owner said yes" }), /OWNER_NOT_ON_FILE/);
    await fails(db.pg.query(`update sources set visibility = 'public' where id = $1`, [src]), /OWNER_NOT_ON_FILE/);
    // the owner's claim arrives ("Claim <listing>" on the customer line, LV1)
    const owner = await customer("+96170000203");
    const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [owner])).id;
    await db.rpc("claim_listing", { p_party: owner, p_conversation: conv, p_text: `Claim ${SAFA}` });
    expect((await db.rpc("places_console", {})).find((p: any) => p.source_id === src).owner_on_file).toBe(true);
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "public", p_reason: "owner agreed in person" });
    expect((await db.one(`select visibility from sources where id = $1`, [src])).visibility).toBe("public");
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "testers", p_reason: "back to testers for the test" });
  });

  it("a vendor application for the listing counts as on file too", async () => {
    const l = await otherListing(0);
    const src = (await db.rpc("create_place_from_listing", { p_listing: l, p_by: admin, p_details: { village_id: village } })).source_id;
    await fails(db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "public", p_reason: "go public" }), /OWNER_NOT_ON_FILE/);
    const applicant = await customer("+96170000204");
    await db.pg.query(`insert into join_applications(kind, party_id, name, place_kind, listing_id) values ('vendor', $1, 'Example place', 'restaurant', $2)`, [applicant, l]);
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "public", p_reason: "owner applied" });
  });
});

describe("1 the tester list", () => {
  it("is a setting of customer numbers, changed by staff with a valid number, logged", async () => {
    expect((await db.one(`select value from settings where key = 'testers'`)).value).toEqual({ numbers: [] });
    await fails(db.rpc("set_tester", { p_by: picker, p_phone: "+96170000210", p_on: true }), /NOT_AUTHORISED/);
    await fails(db.rpc("set_tester", { p_by: lead, p_phone: "70000210", p_on: true }), /PHONE_INVALID/);
    await db.rpc("set_tester", { p_by: lead, p_phone: "+96170000210", p_on: true });
    await db.rpc("set_tester", { p_by: lead, p_phone: "+96170000210", p_on: true });
    await db.rpc("set_tester", { p_by: lead, p_phone: "+96170000211", p_on: true });
    expect((await db.one(`select value from settings where key = 'testers'`)).value).toEqual({ numbers: ["+96170000210", "+96170000211"] });
    await db.rpc("set_tester", { p_by: lead, p_phone: "+96170000211", p_on: false });
    expect((await db.one(`select value from settings where key = 'testers'`)).value).toEqual({ numbers: ["+96170000210"] });
    const t = await customer("+96170000210"); const n = await customer("+96170000212");
    expect(await db.rpc("is_tester", { p_party: t })).toBe(true);
    expect(await db.rpc("is_tester", { p_party: n })).toBe(false);
    expect((await db.all(`select action from place_log where source_id is null order by id`)).map((x: any) => x.action)).toEqual(["tester_add", "tester_add", "tester_add", "tester_remove"]);
  });
});

describe("2 menus from photos", () => {
  let src: string;
  beforeAll(async () => { src = (await db.one(`select id from sources where listing_id = $1`, [SAFA])).id; });

  it("a photo is recorded once, by staff, for a place; it waits for the reading run", async () => {
    await fails(db.rpc("record_menu_photo", { p_source: src, p_media_path: `menus/${src}/2026-11-18/a.jpg`, p_by: picker }), /NOT_AUTHORISED/);
    await fails(db.rpc("record_menu_photo", { p_source: src, p_media_path: `labels/x/a.jpg`, p_by: lead }), /MENU_PATH/);
    const a = await db.rpc("record_menu_photo", { p_source: src, p_media_path: `menus/${src}/2026-11-18/a.jpg`, p_by: lead });
    const again = await db.rpc("record_menu_photo", { p_source: src, p_media_path: `menus/${src}/2026-11-18/a.jpg`, p_by: lead });
    expect(again).toMatchObject({ photo_id: a.photo_id, already: true });
    const q = await db.rpc("menu_reading_queue", { p_limit: 10 });
    expect(q).toEqual([{ photo_id: a.photo_id, source_id: src, place: "Safa Chicken", media_path: `menus/${src}/2026-11-18/a.jpg` }]);
  });

  it("a reading becomes dish proposals (names, prices as printed, sizes, options, add-ons); never a food fact; a failed reading stays queued", async () => {
    const photo = (await db.rpc("menu_reading_queue", { p_limit: 10 }))[0].photo_id;
    await fails(db.rpc("record_menu_reading", { p_photo: photo, p_reading: reading, p_model: "m", p_by: picker }), /NOT_AUTHORISED/);
    const reader = await db.rpc("menu_reader_party", {});
    await db.rpc("record_menu_reading", { p_photo: photo, p_reading: null, p_model: null, p_by: reader, p_reason: "unreadable" });
    expect((await db.rpc("menu_reading_queue", { p_limit: 10 })).length).toBe(1);
    const r = await db.rpc("record_menu_reading", { p_photo: photo, p_reading: reading, p_model: "claude-test", p_by: reader });
    expect(r).toMatchObject({ ok: true, dishes: 4 });
    expect(await db.rpc("menu_reading_queue", { p_limit: 10 })).toEqual([]);
    const rows = await db.all(`select section_en, name_ar, name_en, price::text, currency, status, sizes, addons, translated from menu_dish_proposals where source_id = $1 order by position`, [src]);
    expect(rows.map((x: any) => [x.section_en, x.name_en, x.price, x.currency, x.status])).toEqual([
      ["Sandwiches", "Chicken shawarma", "450000", "LBP", "waiting"], ["Sandwiches", "Taouk", "5", "USD", "waiting"],
      ["Grills", "Healthy grilled plate", "9", "USD", "waiting"], ["Grills", "Whole chicken", null, null, "waiting"]]);
    expect(rows[0].sizes).toHaveLength(2);
    // a Latin word read into the Arabic field (the dry run's "Regular", "Saj") goes to the English one; nothing Latin is kept as Arabic
    expect(rows[0].sizes[0]).toMatchObject({ name_ar: "عادي", name_en: "Regular" });
    expect(rows[1].translated).toBe("ar");
    const opts = (await db.one(`select options from menu_dish_proposals where name_en = 'Chicken shawarma'`)).options;
    expect(opts[0].choices[1]).toEqual({ name_ar: null, name_en: "Saj", price_delta: 50000 });
    // the model's allergen line is not kept anywhere: dish facts come only from the vendor
    expect(JSON.stringify(await db.all(`select * from menu_dish_proposals where source_id = $1`, [src]))).not.toMatch(/allergen/);
    expect(await db.all(`select 1 from product_facts f join products p on p.id = f.product_id where p.owner_source_id = $1`, [src])).toEqual([]);
  });

  it("a person approves a dish: product, offer at today's rate for LBP, sizes, options and add-ons as option groups", async () => {
    const d = (n: string) => db.one(`select id from menu_dish_proposals where source_id = $1 and name_en = $2`, [src, n]).then((x: any) => x.id as string);
    await fails(db.rpc("review_menu_dish", { p_dish: await d("Taouk"), p_by: picker, p_approve: true }), /NOT_AUTHORISED/);
    const r = await db.rpc("review_menu_dish", { p_dish: await d("Chicken shawarma"), p_by: lead, p_approve: true });
    const p = await db.one(`select p.name_en, p.name_ar, p.owner_source_id, p.category, o.price_usd::text as usd, o.is_available from products p join offers o on o.product_id = p.id and o.source_id = p.owner_source_id where p.id = $1`, [r.product_id]);
    expect(p).toMatchObject({ name_en: "Chicken shawarma", name_ar: "شاورما دجاج", owner_source_id: src, category: "Restaurant", usd: "5.03", is_available: true });
    const groups = await db.all(`select g.name_en, g.required, g.min_choices, g.max_choices, json_agg(json_build_object('n', o.name_en, 'd', o.price_delta_usd::text, 'pp', o.printed_price::text, 'pc', o.printed_currency) order by o.sort_order) as opts
                                   from dish_option_groups g join dish_options o on o.group_id = g.id where g.product_id = $1 group by g.id order by g.sort_order`, [r.product_id]);
    expect(groups).toEqual([
      { name_en: "Size", required: true, min_choices: 1, max_choices: 1, opts: [{ n: "Regular", d: "0.00", pp: "0", pc: "LBP" }, { n: "Large", d: "2.23", pp: "200000", pc: "LBP" }] },
      { name_en: "Bread", required: true, min_choices: 1, max_choices: 1, opts: [{ n: "Arabic", d: "0.00", pp: "0", pc: "LBP" }, { n: "Saj", d: "0.56", pp: "50000", pc: "LBP" }] },
      { name_en: "Add-ons", required: false, min_choices: 0, max_choices: 1, opts: [{ n: "Extra garlic", d: "0.56", pp: "50000", pc: "LBP" }] }]);
    await fails(db.rpc("review_menu_dish", { p_dish: await d("Chicken shawarma"), p_by: lead, p_approve: true }), /DISH_ALREADY_REVIEWED/);
    // USD as printed
    const t = await db.rpc("review_menu_dish", { p_dish: await d("Taouk"), p_by: lead, p_approve: true });
    expect((await db.one(`select price_usd::text as usd from offers where product_id = $1`, [t.product_id])).usd).toBe("5.00");
  });

  it("a dish name with a praise or health word is refused until a person edits it; a dish with no price needs one; reject needs a reason", async () => {
    const d = (n: string) => db.one(`select id from menu_dish_proposals where source_id = $1 and name_en = $2`, [src, n]).then((x: any) => x.id as string);
    await fails(db.rpc("review_menu_dish", { p_dish: await d("Healthy grilled plate"), p_by: lead, p_approve: true }), /DISH_NAME_CLAIM/);
    await db.rpc("review_menu_dish", { p_dish: await d("Healthy grilled plate"), p_by: lead, p_approve: true, p_edit: { name_en: "Grilled plate", name_ar: "صحن مشاوي" } });
    await fails(db.rpc("review_menu_dish", { p_dish: await d("Whole chicken"), p_by: lead, p_approve: true }), /PRICE_REQUIRED/);
    await fails(db.rpc("review_menu_dish", { p_dish: await d("Whole chicken"), p_by: lead, p_approve: false }), /REASON_REQUIRED/);
    await db.rpc("review_menu_dish", { p_dish: await d("Whole chicken"), p_by: lead, p_approve: false, p_note: "price not on the menu: ask at the counter" });
    expect((await db.one(`select status from menu_dish_proposals where id = $1`, [await d("Whole chicken")])).status).toBe("rejected");
  });

  it("an LBP price follows today's rate; a USD price does not move", async () => {
    await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (90000)`);
    const sh = (await db.one(`select o.price_usd::text as usd from offers o join products p on p.id = o.product_id where p.name_en = 'Chicken shawarma'`)).usd;
    expect(sh).toBe("5.00");
    expect((await db.one(`select o.price_delta_usd::text as d from dish_options o where o.name_en = 'Large'`)).d).toBe("2.22");
    expect((await db.one(`select o.price_usd::text as usd from offers o join products p on p.id = o.product_id where p.name_en = 'Taouk'`)).usd).toBe("5.00");
  });

  it("dish food facts are 'declared by the vendor' or 'not confirmed yet', never anything else", async () => {
    const dish = (await db.one(`select id from products where name_en = 'Taouk'`)).id;
    const facts = await db.rpc("dish_facts_status", { p_dish: dish });
    expect(facts.length).toBe(20);
    expect(new Set(facts.map((f: any) => f.status))).toEqual(new Set(["not_confirmed"]));
    expect(facts.find((f: any) => f.attribute === "milk")).toEqual({ attribute: "milk", status: "not_confirmed", value: null, declared_at: null });
  });

  it("the 'menu checked' stamp: refused while a dish or a photo waits; then it carries the day", async () => {
    await db.rpc("record_menu_photo", { p_source: src, p_media_path: `menus/${src}/2026-11-18/b.jpg`, p_by: lead });
    await fails(db.rpc("stamp_menu_checked", { p_source: src, p_by: lead }), /MENU_PHOTOS_UNREAD/);
    const photo = (await db.rpc("menu_reading_queue", { p_limit: 10 }))[0].photo_id;
    await db.rpc("record_menu_reading", { p_photo: photo, p_reading: { sections: [{ name_ar: "مقبلات", name_en: "Starters", dishes: [{ name_ar: "حمص", name_en: "Hummus", price: 3, currency: "USD", price_text: "3", translated: null, sizes: [], options: [], addons: [] }] }] }, p_model: "m", p_by: await db.rpc("menu_reader_party", {}) });
    await fails(db.rpc("stamp_menu_checked", { p_source: src, p_by: lead }), /MENU_DISHES_WAITING/);
    const h = (await db.one(`select id from menu_dish_proposals where name_en = 'Hummus'`)).id;
    await db.rpc("review_menu_dish", { p_dish: h, p_by: lead, p_approve: true });
    await fails(db.rpc("stamp_menu_checked", { p_source: src, p_by: picker }), /NOT_AUTHORISED/);
    const r = await db.rpc("stamp_menu_checked", { p_source: src, p_by: lead });
    expect(r.menu_checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await db.one(`select menu_checked_on::text as d, menu_checked_by from sources where id = $1`, [src]))).toMatchObject({ d: r.menu_checked_on, menu_checked_by: lead });
  });
});

describe("3 prices and the food service fee", () => {
  it("a food service fee setting, 0, editable by an admin within bounds", async () => {
    expect((await db.one(`select value from settings where key = 'food'`)).value).toMatchObject({ service_fee_usd: 0 });   // FD2 (0250) adds float_max_usd to the same setting
    expect(await db.one(`select kind, min_value::text as lo, max_value::text as hi, two_person from editable_settings where key = 'food' and field = 'service_fee_usd'`))
      .toEqual({ kind: "number", lo: "0", hi: "5", two_person: false });
  });
});

describe("4 approve_merchant makes a place orderable for its visibility, and nothing before it", () => {
  let src: string; let tester: string; let other: string; let dish: string;
  beforeAll(async () => {
    src = (await db.one(`select id from sources where listing_id = $1`, [SAFA])).id;
    tester = (await db.one(`select party_id from party_identities where phone_e164 = '+96170000210'`)).party_id;
    other = await customer("+96170000220");
    dish = (await db.one(`select id from products where name_en = 'Taouk'`)).id;
  });

  it("before approval nobody can order, tester or not; dishes stay out of every search", async () => {
    expect(await db.rpc("place_orderable_for", { p_source: src, p_party: tester })).toBe(false);
    expect(await db.rpc("product_orderable_for", { p_product: dish, p_party: tester })).toBe(false);
    expect(await db.rpc("product_orderable", { p_product: dish })).toBe(false);
    const s = await db.rpc("search_catalog", { p_query: "taouk" });
    expect(s.matches.filter((m: any) => m.product_id === dish)).toEqual([]);
  });

  it("an unchecked menu or a place with no approved dish cannot be approved; a place needs no commission (Alo King buys at the counter)", async () => {
    const bare = (await db.rpc("create_place_from_listing", { p_listing: await otherListing(1), p_by: lead, p_details: { village_id: village } })).source_id;
    await fails(db.rpc("approve_merchant", { p_source: bare, p_by: lead, p_commission_pct: null }), /NO_APPROVED_MENU/);
    await fails(db.rpc("approve_merchant", { p_source: src, p_by: picker, p_commission_pct: null }), /NOT_AUTHORISED/);
    await db.pg.query(`update sources set menu_checked_on = null where id = $1`, [src]);
    await fails(db.rpc("approve_merchant", { p_source: src, p_by: lead, p_commission_pct: null }), /MENU_NOT_CHECKED/);
    await db.rpc("stamp_menu_checked", { p_source: src, p_by: lead });
    const r = await db.rpc("approve_merchant", { p_source: src, p_by: lead, p_commission_pct: null });
    expect(r).toMatchObject({ ok: true, items: 4, visibility: "testers" });
    expect(await db.one(`select is_open, approved_by, commission_pct::text as c, terms_accepted_at from sources where id = $1`, [src])).toEqual({ is_open: true, approved_by: lead, c: "0.00", terms_accepted_at: null });
  });

  it("testers only: a tester can, anyone else cannot, and the dishes stay out of everyone's search", async () => {
    expect(await db.rpc("place_orderable_for", { p_source: src, p_party: tester })).toBe(true);
    expect(await db.rpc("product_orderable_for", { p_product: dish, p_party: tester })).toBe(true);
    expect(await db.rpc("place_orderable_for", { p_source: src, p_party: other })).toBe(false);
    expect(await db.rpc("product_orderable_for", { p_product: dish, p_party: other })).toBe(false);
    expect(await db.rpc("product_orderable", { p_product: dish })).toBe(false);
    expect((await db.rpc("search_catalog", { p_query: "taouk" })).matches.filter((m: any) => m.product_id === dish)).toEqual([]);
    expect(await db.rpc("search_catalog", { p_query: "taouk", p_source_hint: "Safa Chicken" })).toMatchObject({ matches: [], reason: "merchant_not_onboarded" });
    expect((await db.rpc("places_for", { p_party: tester })).map((p: any) => p.source_id)).toEqual([src]);
    expect(await db.rpc("places_for", { p_party: other })).toEqual([]);
  });

  it("off hides it from everyone at once; public (owner on file) opens it to everyone", async () => {
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "off", p_reason: "closed today" });
    expect(await db.rpc("place_orderable_for", { p_source: src, p_party: tester })).toBe(false);
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "public", p_reason: "owner agreed" });
    expect(await db.rpc("place_orderable_for", { p_source: src, p_party: other })).toBe(true);
    expect(await db.rpc("product_orderable", { p_product: dish })).toBe(true);
    await db.rpc("set_place_visibility", { p_source: src, p_by: lead, p_visibility: "testers", p_reason: "friends' test" });
  });

  it("a signed merchant (the older path) is unchanged: commission and terms, public by default", async () => {
    const m = (await db.one(`insert into sources(kind, name) values ('merchant', 'FD1 Example Kitchen') returning id, visibility, buys_for_customer`));
    expect(m).toMatchObject({ visibility: "public", buys_for_customer: false });
    const p = (await db.one(`insert into products(sku, owner_source_id, name_en, category) values ('FD1-X1', $1, 'Example dish', 'Restaurant') returning id`, [m.id])).id;
    await db.pg.query(`insert into offers(source_id, product_id, price_usd) values ($1, $2, 4)`, [m.id, p]);
    await fails(db.rpc("approve_merchant", { p_source: m.id, p_by: lead, p_commission_pct: null }), /COMMISSION_REQUIRED/);
    await db.rpc("approve_merchant", { p_source: m.id, p_by: lead, p_commission_pct: 8 });
    expect(await db.rpc("product_orderable", { p_product: p })).toBe(true);
    expect(await db.rpc("place_orderable_for", { p_source: m.id, p_party: other })).toBe(true);
  });

  it("no new function writes orders, payments, stock or the ledger (invariant 3)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["0245_places.sql", "0246_menus.sql", "0247_place_approval.sql"]) {
      const src = readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
      expect(src, f).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+(orders|order_items|payments|stock_levels|ledger_entries|listings)\b/i);
    }
  });
});
