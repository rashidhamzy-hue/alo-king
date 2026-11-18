// FD1: the console's Places and Menus pages over the real migrations (0245 to 0247). Written before the pages.
// A place from its listing (the phone shown here only), visibility with the owner rule, the tester list, a menu photo stored and recorded,
// a dish checked and approved, the stamp, approve_merchant. Invented people and numbers only; nothing is sent anywhere.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";
import { handle } from "../src/app";
import { registry } from "../src/pages";

afterEach(() => vi.unstubAllGlobals());
const SAFA = "safa-chicken-boqaata";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]) as Uint8Array<ArrayBuffer>;

async function setUp() {
  const r = await rig();
  await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500)`);
  const lead = await r.staff("ops_lead", "Example lead");
  const b = r.browser(); await b.signIn(lead);
  const village = (await r.db.one(`select id from villages where name_en = 'Baqaata'`)).id as string;
  return { r, b, lead, village };
}
const placeOf = async (r: Rig) => (await r.db.one(`select id from sources where listing_id = $1`, [SAFA])).id as string;

describe("Places", () => {
  it("makes a place from its listing: the form proposes the listing's village; the phone is shown here; it starts off", async () => {
    const { r, b, village } = await setUp();
    const found = (await b.get("/places?tab=new&q=Safa")).text;
    expect(found).toContain("Safa Chicken");
    expect(found).toContain(`/places?tab=new&listing=${SAFA}`);
    const form = (await b.get(`/places?tab=new&listing=${SAFA}`)).text;
    expect(form).toMatch(new RegExp(`<option value="${village}" selected>`));          // Boqaata in the listing is Baqaata in the villages list
    const made = await b.post("/places/new", { listing: SAFA, name: "Safa Chicken", village_id: village, phone: "+96170000301", open: "11:00", close: "22:30", off_mon: "1", prep_minutes: 25 });
    expect(flashOf(made.text)).toBe("The place is made. It is off: photograph its menu next.");
    const src = await placeOf(r);
    expect(b.lastPath).toBe(`/places/${src}`);
    expect(made.text).toContain("+96170000301");
    expect(await r.db.one(`select visibility, is_open, prep_minutes, hours from sources where id = $1`, [src])).toEqual({ visibility: "off", is_open: false, prep_minutes: 25, hours: { open: "11:00", close: "22:30", days_off: ["mon"] } });
    const list = (await b.get("/places")).text;
    expect(list).toContain("Safa Chicken"); expect(list).toContain("No menu yet"); expect(list).toContain("+96170000301");
    expect(flashOf((await b.post("/places/new", { listing: SAFA, name: "Safa Chicken", village_id: village, prep_minutes: 20 })).text)).toBe("A place was already made from this listing.");
  });

  it("visibility: testers only is fine; public is refused without the owner's claim or application, in plain words", async () => {
    const { r, b, village } = await setUp();
    await b.post("/places/new", { listing: SAFA, name: "Safa Chicken", village_id: village, prep_minutes: 20 });
    const src = await placeOf(r);
    expect(flashOf((await b.post(`/places/${src}/visibility`, { visibility: "testers", reason: "friends' test" })).text)).toBe("Visibility: Testers only.");
    const pub = await b.post(`/places/${src}/visibility`, { visibility: "public", reason: "try" });
    expect(flashOf(pub.text)).toBe("A place is public only once its owner's claim or application is on file. Keep it on testers only.");
    expect((await r.db.one(`select visibility from sources where id = $1`, [src])).visibility).toBe("testers");
    expect(flashOf((await b.post(`/places/${src}/details`, { name: "Safa Chicken", village_id: village, phone: "+96170000302", open: "", close: "", prep_minutes: 30 })).text)).toBe("Saved.");
    expect((await r.db.one(`select prep_minutes from sources where id = $1`, [src])).prep_minutes).toBe(30);
  });

  it("the tester list: add and remove a customer number", async () => {
    const { r, b } = await setUp();
    expect(flashOf((await b.post("/places/testers", { phone: "+961 70 000 310", on: "1" })).text)).toBe("Added.");
    expect(flashOf((await b.post("/places/testers", { phone: "70000311", on: "1" })).text)).toBe("Type the number in full: + and the country code (+961...).");
    expect((await b.get("/places?tab=testers")).text).toContain("+96170000310");
    expect(flashOf((await b.post("/places/testers", { phone: "+96170000310", on: "0" })).text)).toBe("Removed.");
    expect((await r.db.one(`select value from settings where key = 'testers'`)).value).toEqual({ numbers: [] });
  });

  it("is closed to pickers", async () => {
    const r = await rig();
    const b = r.browser(); await b.signIn(await r.staff("picker"));
    expect((await b.get("/places")).status).toBe(403);
    expect((await b.get("/menus")).status).toBe(403);
  });
});

describe("Menus, then approval", () => {
  it("a photo is stored privately and recorded; a dish is checked and approved; the stamp; then approve_merchant opens it for testers", async () => {
    const { r, b, village, lead } = await setUp();
    await b.post("/places/new", { listing: SAFA, name: "Safa Chicken", village_id: village, prep_minutes: 20 });
    const src = await placeOf(r);
    let page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain('data-menu-upload'); expect(page).toContain('<script src="/menus.js" defer></script>');
    page = (await b.postFiles(`/menus/${src}/photo`, {}, { photo: { name: "menu.jpg", type: "image/jpeg", bytes: JPEG } })).text;
    expect(flashOf(page)).toBe("Saved. It waits for the reading run.");
    const stored = [...r.media.objects.keys()].filter((k) => k.startsWith(`menus/${src}/`));
    expect(stored).toHaveLength(1);
    expect(page).toContain("Waits for the reading run");
    expect(flashOf((await b.postFiles(`/menus/${src}/photo`, {}, { photo: { name: "menu.pdf", type: "application/pdf", bytes: JPEG } })).text)).toBe("Attach a photo (JPEG, PNG or WebP).");
    // the script's way: JSON back
    const fd = new FormData(); fd.set("_csrf", b.csrf); fd.set("_key", "k"); fd.set("photo", new File([JPEG], "menu.jpg", { type: "image/jpeg" }));
    const res = await handle(new Request(`https://console.test/menus/${src}/photo`, { method: "POST", body: fd, headers: { accept: "application/json", cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; "), referer: "https://console.test/menus" } }), r.deps, registry);
    expect(await res.json()).toEqual({ ok: true, message: "Saved already." });
    // the reading run (scripted here) proposes two dishes
    const photo = (await r.db.rpc("menu_reading_queue", { p_limit: 5 }))[0].photo_id;
    await r.db.rpc("record_menu_reading", { p_photo: photo, p_by: await r.db.rpc("menu_reader_party", {}), p_model: "test", p_reading: { sections: [{ name_ar: "سندويشات", name_en: "Sandwiches", dishes: [
      { name_ar: "شاورما دجاج", name_en: "Chicken shawarma", translated: null, price: 450000, currency: "LBP", price_text: "450,000", sizes: [], options: [], addons: [{ name_ar: "ثوم", name_en: "Garlic", price: 50000, currency: "LBP" }] },
      { name_ar: "أطيب طاووق", name_en: "Best taouk", translated: null, price: 5, currency: "USD", price_text: "$5", sizes: [], options: [], addons: [] }] }] } });
    page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain("Chicken shawarma"); expect(page).toContain("450,000"); expect(page).toContain("The name praises or makes a health claim: change it");
    const d = async (n: string) => (await r.db.one(`select id from menu_dish_proposals where name_en = $1`, [n])).id as string;
    expect(flashOf((await b.post(`/menus/dish/${await d("Chicken shawarma")}`, { source: src, decision: "approve", name_ar: "شاورما دجاج", name_en: "Chicken shawarma", section_en: "Sandwiches", price: "450000", currency: "LBP" })).text)).toBe("Approved at $5.03 today.");
    expect(flashOf((await b.post(`/menus/dish/${await d("Best taouk")}`, { source: src, decision: "approve", name_ar: "أطيب طاووق", name_en: "Best taouk", price: "5", currency: "USD" })).text))
      .toBe("A dish name says what it is, never how good or healthy it is. Change the name, then approve.");
    expect(flashOf((await b.post(`/menus/${src}/checked`)).text)).toBe("Approve or reject every dish first.");
    expect(flashOf((await b.post(`/menus/dish/${await d("Best taouk")}`, { source: src, decision: "approve", name_ar: "طاووق", name_en: "Taouk", price: "5", currency: "USD" })).text)).toBe("Approved at $5.00 today.");
    page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain("Not confirmed yet");
    expect(page).not.toMatch(/healthy|صحي/i);
    // approving before the stamp is refused; the stamp; then approval opens it for its visibility
    expect(flashOf((await b.post(`/places/${src}/approve`)).text)).toBe("Stamp the menu as checked first (Menus page).");
    expect(flashOf((await b.post(`/menus/${src}/checked`)).text)).toMatch(/^Menu checked on \d{4}-\d{2}-\d{2}\.$/);
    await b.post(`/places/${src}/visibility`, { visibility: "testers", reason: "friends' test" });
    expect(flashOf((await b.post(`/places/${src}/approve`)).text)).toBe("Approved: 2 dish(es), orderable for its visibility (testers).");
    expect(await r.db.one(`select approved_by, is_open, commission_pct::text as c from sources where id = $1`, [src])).toEqual({ approved_by: lead.partyId, is_open: true, c: "0.00" });
    expect((await b.get("/places")).text).toContain("Orderable");
    // every action went through the action log
    expect((await r.actions()).filter((a) => a.phase === "done").map((a) => a.action)).toEqual(expect.arrayContaining(["place_create", "menu_photo", "menu_dish_approve", "menu_checked", "place_visibility", "place_approve"]));
  });
});
