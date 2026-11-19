// AUTO1: approvals by rule on the console, over the real migrations (0263, 0264). docs/DECISIONS.md, "AUTO1, 19 November 2026".
//   - Approvals shows what was approved automatically today, and the Auto-approvals list has Undo on each decision (one tap)
//   - the week's checks are cards in the Auto-approvals tab; more than one wrong switches the rule off, and Today says why
//   - the place's page lists the prices to confirm with its phone, and the hours and phone read from the menu, applied with one tap
//   - Settings shows both switches
// Invented numbers only; nothing is sent anywhere.
import { describe, expect, it } from "vitest";
import { flashOf, rig } from "./kit";

const SAFA = "safa-chicken-boqaata";
const dish = (name_ar: string | null, name_en: string, price: number | null, more: Record<string, unknown> = {}) =>
  ({ name_ar, name_en, translated: null, price, currency: "USD", price_text: price === null ? "" : `${price}`, sizes: [], options: [], addons: [], ...more });

async function setUp() {
  const r = await rig();
  await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500)`);
  const lead = await r.staff("ops_lead", "Example lead");
  const admin = await r.staff("admin", "Example admin");
  const b = r.browser(); await b.signIn(lead);
  const village = (await r.db.one(`select id from villages where name_en = 'Baqaata'`)).id as string;
  await b.post("/places/new", { listing: SAFA, name: "Safa Chicken", village_id: village, prep_minutes: 20, phone: "+96170000266" });
  const src = (await r.db.one(`select id from sources where listing_id = $1`, [SAFA])).id as string;
  const leadId = (await r.db.one(`select id from parties where role = 'ops_lead' limit 1`)).id;
  await r.db.rpc("add_menu_source", { p_place: src, p_kind: "text", p_by: leadId, p_detail: { body: "Grills\nShish taouk\n8\n$\nKebab\n9\n$\nHalf chicken\n6–11\n$" } });
  const pg = (await r.db.one(`select p.id from menu_source_pages p where p.source_id = $1`, [src])).id;
  await r.db.rpc("record_menu_page_reading", { p_page: pg, p_by: await r.db.rpc("menu_reader_party", {}), p_model: "test",
    p_reading: { place: null, sections: [{ name_ar: "مشاوي", name_en: "Grills", dishes: [dish("شيش طاووق", "Shish taouk", 8, { translated: "ar" }), dish("كباب", "Kebab", 9, { translated: "ar" }),
      dish("نص فروج", "Half chicken", null, { translated: "ar", price_text: "6–11", price_clear: false, flags: ["price_range"] })] }] } });
  await r.db.rpc("record_menu_place_details", { p_place: src, p_photo: null, p_page: pg, p_details: { open: "11:00", close: "22:00", days_off: ["mon"], hours_text: "11am to 10pm, closed Monday", phone: "+96170000267" }, p_by: await r.db.rpc("menu_reader_party", {}) });
  await r.db.rpc("automation_run_dishes", {});
  return { r, b, src, admin };
}

describe("approvals by rule on the console", () => {
  it("Approvals says what was approved automatically today; the list undoes one in one tap", async () => {
    const { r, b } = await setUp();
    let page = (await b.get("/approve")).text;
    expect(page).toContain("Approved automatically today");
    expect(page).toMatch(/2 dish\(es\), 0 picture\(s\) approved/);
    page = (await b.get("/approve?tab=auto&view=list")).text;
    expect(page).toContain("Approved by a rule a person approved");
    expect(page).toContain("Shish taouk");
    expect(page).toContain("menu-dish-1");
    const decision = (await r.db.one(`select a.id from automation_decisions a join menu_dish_proposals p on p.id = a.target_id where p.name_en = 'Kebab'`)).id;
    expect(page).toContain(`action="/automation/undo/${decision}"`);
    expect(flashOf((await b.post(`/automation/undo/${decision}`, {})).text)).toBe("Undone: the dish is back in the queue and off sale (or at its earlier price).");
    expect((await r.db.one(`select status from menu_dish_proposals where name_en = 'Kebab'`)).status).toBe("waiting");
    expect((await b.get("/approve?tab=auto&view=list")).text).toMatch(/undone \(<bdi>Example lead<\/bdi>\)/);
  });

  it("the week's checks are cards; two wrong switch the rule off and Today says why; Settings shows both switches", async () => {
    const { r, b, admin } = await setUp();
    await r.db.pg.exec(`update automation_decisions set created_at = created_at - interval '7 days'`);
    await r.db.rpc("automation_weekly_sample", {});
    let page = (await b.get("/approve?tab=auto")).text;
    expect(page).toContain('data-card="auto-week"');
    const checks = await r.db.all(`select id from automation_checks where kind = 'dish' order by id`);
    expect(checks).toHaveLength(2);
    expect(flashOf((await b.post(`/automation/check/${checks[0].id}`, { verdict: "wrong", note: "wrong price" })).text)).toBe("Marked wrong and undone.");
    expect(flashOf((await b.post(`/automation/check/${checks[1].id}`, { verdict: "wrong", note: "not on the menu" })).text))
      .toBe("Marked wrong and undone. That is more than one wrong this week: the rule is now off (Today says why).");
    page = (await b.get("/")).text;
    expect(page).toContain("Dishes are not approved by rule: every dish waits for a person");
    expect(page).toMatch(/2 of the 2 automatic dish decisions checked for the week of/);
    const ab = r.browser(); await ab.signIn(admin);
    const settings = (await ab.get("/settings")).text;
    expect(settings).toMatch(/Dishes approved by rule \(menu-dish-1\)/);
    expect(settings).toMatch(/Pictures decided by rule \(photo-vision-1\)/);
  });

  it("the place's page: prices to confirm with its phone; the hours and phone read from the menu, applied in one tap", async () => {
    const { r, b, src } = await setUp();
    const page = (await b.get(`/places/${src}`)).text;
    expect(page).toContain("Prices to confirm");
    expect(page).toContain("6–11");
    expect(page).toContain('href="tel:+96170000266"');
    expect(page).toContain("Read from the menu");
    expect(page).toContain("11:00–22:00");
    const pid = (await r.db.one(`select id from place_detail_proposals where source_id = $1`, [src])).id;
    expect(flashOf((await b.post(`/places/${src}/read-details/${pid}`, { use: "yes" })).text)).toBe("The hours and phone from the menu are now the place's.");
    expect((await r.db.one(`select hours from sources where id = $1`, [src])).hours).toEqual({ open: "11:00", close: "22:00", days_off: ["mon"] });
    expect((await r.db.one(`select phone_e164 from place_contacts where source_id = $1`, [src])).phone_e164).toBe("+96170000267");
    expect((await b.get(`/places/${src}`)).text).not.toContain("Read from the menu");
  });
});
