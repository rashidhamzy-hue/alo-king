// MENU2: the Menus page's "Add a menu" box and the fast approval, over the real migrations (0259, 0260). docs/DECISIONS.md, "MENU2".
// One box takes photos, a PDF, a link, pasted text, a Word file, an Excel or CSV file; dishes are shown by section beside their source;
// "Approve all clean dishes in this section"; a flagged row one by one with its price typed; a re-import shows only what changed.
// Invented places, dishes and numbers only; nothing is sent anywhere.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { flashOf, rig, type Rig } from "./kit";

const SAFA = "safa-chicken-boqaata";
// the fixtures as bytes (this folder's declaration of readFileSync knows text only; at run time it is Node's)
const readBytes = readFileSync as unknown as (path: string) => Uint8Array;
const FIX = (f: string) => new Uint8Array(readBytes(fileURLToPath(new URL(`../../../test/fixtures/menus/files/${f}`, import.meta.url)))) as Uint8Array<ArrayBuffer>;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]) as Uint8Array<ArrayBuffer>;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function setUp() {
  const r = await rig();
  await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500)`);
  const lead = await r.staff("ops_lead", "Example lead");
  const b = r.browser(); await b.signIn(lead);
  const village = (await r.db.one(`select id from villages where name_en = 'Baqaata'`)).id as string;
  await b.post("/places/new", { listing: SAFA, name: "Safa Chicken", village_id: village, prep_minutes: 20 });
  const src = (await r.db.one(`select id from sources where listing_id = $1`, [SAFA])).id as string;
  return { r, b, lead, src };
}
const dish = (name_ar: string | null, name_en: string, price: number | null, more: Record<string, unknown> = {}) =>
  ({ name_ar, name_en, translated: null, price, currency: "USD", price_text: price === null ? "" : `${price}$`, sizes: [], options: [], addons: [], ...more });
async function readText(r: Rig, src: string, body: string, sections: [string, string, any[]][], full = false) {
  await r.db.rpc("add_menu_source", { p_place: src, p_kind: "text", p_by: (await r.db.one(`select id from parties where role = 'ops_lead' limit 1`)).id, p_detail: { body, full_menu: full } });
  const pg = (await r.db.one(`select p.id from menu_source_pages p join menu_sources m on m.id = p.menu_source_id where m.source_id = $1 and m.body = $2`, [src, body])).id;
  await r.db.rpc("record_menu_page_reading", { p_page: pg, p_by: await r.db.rpc("menu_reader_party", {}), p_model: "test",
    p_reading: { sections: sections.map(([ar, en, dishes]) => ({ name_ar: ar, name_en: en, dishes })) } });
  return pg as string;
}

describe("Add a menu: one box, every kind of source", () => {
  it("a link, pasted text, a PDF, a Word file, an Excel file, a CSV file and a photo; each stored privately and recorded; anything else refused", async () => {
    const { r, b, src } = await setUp();
    let page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain("Add a menu"); expect(page).toContain(`action="/menus/${src}/add"`); expect(page).toContain('name="link"'); expect(page).toContain('name="text"');
    expect(flashOf((await b.post(`/menus/${src}/add`, {})).text)).toBe("Choose a file, type a link or paste the text first.");
    expect(flashOf((await b.post(`/menus/${src}/add`, { link: "not a link" })).text)).toBe("Give the full address of a public web page (https://...).");
    expect(flashOf((await b.post(`/menus/${src}/add`, { link: "https://menus.example/p/example-grill", full_menu: "1" })).text)).toBe("Added 1. It waits for the reading run.");
    expect(flashOf((await b.post(`/menus/${src}/add`, { text: "حمص 3$\nمتبل 3.5$" })).text)).toBe("Added 1. It waits for the reading run.");
    for (const [name, type] of [["example-menu.pdf", "application/pdf"], ["example-menu.docx", DOCX], ["example-menu.xlsx", XLSX], ["example-menu.csv", "text/csv"]]) {
      expect(flashOf((await b.postFiles(`/menus/${src}/add`, { full_menu: "1" }, { file: { name: name!, type: type!, bytes: FIX(name!) } })).text)).toBe("Added 1. It waits for the reading run.");
    }
    expect(flashOf((await b.postFiles(`/menus/${src}/add`, {}, { file: { name: "example-menu.csv", type: "text/csv", bytes: FIX("example-menu.csv") } })).text)).toBe("Added 0. It waits for the reading run. 1 was already added.");
    expect(flashOf((await b.postFiles(`/menus/${src}/add`, {}, { file: { name: "menu.jpg", type: "image/jpeg", bytes: JPEG } })).text)).toBe("Added 1. It waits for the reading run.");
    expect(flashOf((await b.postFiles(`/menus/${src}/add`, {}, { file: { name: "menu.doc", type: "application/msword", bytes: JPEG } })).text))
      .toBe("A menu file is a photo, a PDF, a Word file (.docx), an Excel file (.xlsx) or a CSV file.");
    const kinds = (await r.db.all(`select kind, media_path, full_menu from menu_sources where source_id = $1 order by added_at`, [src])).map((x: any) => [x.kind, x.media_path?.replace(/[0-9a-f]{40}/, "H") ?? null, x.full_menu]);
    const day = new Date().toISOString().slice(0, 10);
    expect(kinds).toEqual([["link", null, true], ["text", null, false], ["pdf", `menus/${src}/src/${day}/H.pdf`, true], ["docx", `menus/${src}/src/${day}/H.docx`, true],
      ["sheet", `menus/${src}/src/${day}/H.xlsx`, true], ["sheet", `menus/${src}/src/${day}/H.csv`, true]]);
    expect([...r.media.objects.keys()].filter((k) => k.startsWith(`menus/${src}/`)).length).toBe(5);    // four files and the photo
    expect((await r.db.one(`select count(*)::int as n from menu_photos where source_id = $1`, [src])).n).toBe(1);
    page = (await b.get(`/menus/${src}`)).text;
    for (const w of ["Web page", "Pasted text", "PDF", "Word file", "Excel or CSV file", "whole menu", "https://menus.example/p/example-grill"]) expect(page).toContain(w);
    expect(page).toContain("item(s) wait for the reading run");
    expect((await r.actions()).filter((a) => a.phase === "done").map((a) => a.action)).toContain("menu_source_add");
  });
});

describe("approval made fast", () => {
  it("by section beside the source line; the clean rows in one press, each recorded; a flagged row one by one with its price typed; the source text", async () => {
    const { r, b, src, lead } = await setUp();
    const pg = await readText(r, src, "Starters\nHummus 3$\nMoutabal 3.5$\nFries small 2 / large 3.5\nFried kibbeh $", [["المقبلات", "Starters", [
      dish("حمص", "Hummus", 3, { source_text: "Hummus 3$" }), dish("متبل", "Moutabal", 3.5, { source_text: "Moutabal 3.5$" }),
      dish("بطاطا", "Fries", null, { sizes: [{ name_ar: "صغير", name_en: "Small", price: 2, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: 3.5, currency: "USD" }] }),
      dish("كبة مقلية", "Fried kibbeh", null, { price_clear: false, flags: ["unclear_price"], flag_note: "only a $ sign is printed", source_text: "Fried kibbeh $" })]]]);
    let page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain("Approve all 3 clean dish(es) in this section");
    expect(page).toContain("1 to approve one by one:");
    expect(page).toContain("Price to confirm: type it from the source"); expect(page).toContain("Price unclear"); expect(page).toContain("only a $ sign is printed");
    expect(page).toContain("Hummus 3$"); expect(page).toContain(`/menus/page/${pg}`);
    expect((await b.get(`/menus/page/${pg}`)).text).toContain("Fried kibbeh $");
    const ids = (await r.db.all(`select id from menu_dish_proposals where source_id = $1 and name_en in ('Hummus', 'Moutabal', 'Fries') order by position`, [src])).map((x: any) => x.id);
    expect(flashOf((await b.post(`/menus/${src}/section`, { ids: ids.join(",") })).text)).toBe("Approved 3.");
    expect((await r.db.all(`select reviewed_by from menu_dish_proposals where id = any($1::uuid[])`, [ids])).every((x: any) => x.reviewed_by === lead.partyId)).toBe(true);
    const kibbeh = (await r.db.one(`select id from menu_dish_proposals where name_en = 'Fried kibbeh'`)).id;
    expect(flashOf((await b.post(`/menus/${src}/section`, { ids: kibbeh })).text)).toBe("Approved 0. 1 changed since the page was shown: check them one by one.");
    expect(flashOf((await b.post(`/menus/dish/${kibbeh}`, { source: src, decision: "approve", name_ar: "كبة مقلية", name_en: "Fried kibbeh", section_en: "Starters", price: "", typed: "1", currency: "" })).text))
      .toBe("Type the price as printed and choose USD or LBP.");
    expect(flashOf((await b.post(`/menus/dish/${kibbeh}`, { source: src, decision: "approve", name_ar: "كبة مقلية", name_en: "Fried kibbeh", section_en: "Starters", price: "5", typed: "1", currency: "USD" })).text)).toBe("Approved at $5.00 today.");
    page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain("Nothing to check.");
    expect(flashOf((await b.post(`/menus/${src}/checked`)).text)).toMatch(/^Menu checked on /);
    expect((await r.actions()).filter((a) => a.phase === "done").map((a) => a.action)).toEqual(expect.arrayContaining(["menu_section_approve", "menu_dish_approve"]));
  });

  it("a re-import of the whole menu lists only what changed: a new price beside the old, a new dish, a dish gone (taken off sale on approval)", async () => {
    const { r, b, src } = await setUp();
    await readText(r, src, "Hummus 3$ Moutabal 3.5$ Fattoush 4$", [["", "Starters", [dish("حمص", "Hummus", 3), dish("متبل", "Moutabal", 3.5), dish("فتوش", "Fattoush", 4)]]]);
    const ids = (await r.db.all(`select id from menu_dish_proposals where source_id = $1`, [src])).map((x: any) => x.id);
    await b.post(`/menus/${src}/section`, { ids: ids.join(",") });
    await readText(r, src, "Hummus 3$ Moutabal 4$ Lentil soup 3$", [["", "Starters", [dish("حمص", "Hummus", 3), dish("متبل", "Moutabal", 4), dish("شوربة عدس", "Lentil soup", 3)]]], true);
    const page = (await b.get(`/menus/${src}`)).text;
    expect(page).toContain("only what changed is listed");
    expect(page).toContain("Price changed (was $3.50)"); expect(page).toContain("New"); expect(page).toContain("No longer in the menu");
    expect(page).toContain("1 dish(es) read again unchanged: nothing to do.");
    expect((await r.db.one(`select count(*)::int as n from menu_dish_proposals where name_en = 'Hummus' and status = 'waiting'`)).n).toBe(0);
    expect(page.split("Dishes to check")[1]!.split("On sale once")[0]).not.toContain("Hummus");
    const gone = (await r.db.one(`select id from menu_dish_proposals where change = 'removed'`)).id;
    expect(flashOf((await b.post(`/menus/dish/${gone}`, { source: src, decision: "approve" })).text)).toBe("Taken off sale.");
    expect((await r.db.one(`select o.is_available from offers o join products p on p.id = o.product_id where p.name_en = 'Fattoush'`)).is_available).toBe(false);
  });
});
